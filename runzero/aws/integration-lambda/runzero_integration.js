'use strict';

const runzeroClient = require('./runzero_client');
const DiscoveryMutationHelper = require('./discovery_mutation_helper');
const ReferenceHelper = require('./references_helper');
const TimeHelper = require('../../../library/helpers/time_helper');
const LoggedError = require('../../../library/helpers/errors/logged_error');
const Js4meAuthorizationError = require('../../../library/helpers/errors/js_4me_authorization_error');
const runzeroAPIError = require('./errors/runzero_api_error');
const ResultHelper = require('../../../library/helpers/result_helper');

class runzeroIntegration {
  constructor(clientId, clientSecret, refreshToken, customer4meHelper) {
    this.runzeroClient = new runzeroClient(clientId, clientSecret, refreshToken);
    this.customer4meHelper = customer4meHelper;
    this.referenceHelper = new ReferenceHelper(customer4meHelper);
    this.resultHelper = new ResultHelper();
  }

  async validateCredentials() {
    const siteIds = await this.runzeroClient.getSiteIds();
    console.info(`Validated runzero access. Can access sites: ${siteIds.length}`);
    const accessToken = await this.customer4meHelper.getToken();
    console.info('Validated 4me customer account access.');
    return true;
  }

  async processSites(networkedAssetsOnly, configAssetTypes, generateLabels, siteFilter, siteNames, sitesAssetsOnly) {
    let siteIds;
    try {
      siteIds = await this.runzeroClient.getSites(siteNames, sitesAssetsOnly);
    } catch (error) {
      if (error instanceof runzeroAPIError) {
        return {error: error.message};
      }
      throw error;
    }

    const allInstallationNames = await this.runzeroClient.getAllInstallationNames();
    if (allInstallationNames.error) {
      return allInstallationNames;
    }
    const installationNames = [...new Set([...allInstallationNames, ...extraInstallations])];

    const result = {uploadCounts: {}, info: {}, errors: {}};
    for (const siteId of siteIds) {
      const siteName = await this.runzeroClient.getSiteName(siteId);
      let siteError = null;

      let assetTypes = null;
      if (configAssetTypes) {
        const allAssetTypes = await this.runzeroClient.getAssetTypes(siteId);
        if (allAssetTypes.error) {
          siteError = allAssetTypes.error;
        } else {
          assetTypes = configAssetTypes.filter(at => allAssetTypes.indexOf(at) > -1);
        }
      }

      if (!siteError) {
        const installations = await this.runzeroClient.getAllInstallations(siteId);
        if (installations.error) {
          siteError = installations.error;
        } else {
          const selectedInstallations = installations.filter(i => siteFilter(i.name));
          if (selectedInstallations.length === 0) {
            result.info[siteName] = 'No installations in this site matched selection';
          } else {
            if (selectedInstallations.length > 1) {
              console.log('Will process the following installations: %j', selectedInstallations.map(i => i.name));
            }
            for (const installation of selectedInstallations) {
              const installationResult = await this.processSite(siteId,
                                                                networkedAssetsOnly,
                                                                generateLabels,
                                                                installation,
                                                                installationNames,
                                                                assetTypes);
              result.uploadCounts[siteName] = result.uploadCounts[siteName] || {};
              result.uploadCounts[siteName][installation.name] = installationResult.uploadCount;
              if (installationResult.errors) {
                result.errors[siteName] = result.errors[siteName] || {};
                result.errors[siteName][installation.name] = installationResult.errors;
              }
            }
          }
        }
      }
      if (siteError) {
        result.errors[siteName] = siteError;
      }
    }
    if (this.referenceHelper.peopleFound.size > 0 || this.referenceHelper.peopleNotFound.length > 0) {
      console.log(`User lookup: found ${this.referenceHelper.peopleFound.size} people (not found ${this.referenceHelper.peopleNotFound.length})`);
    }
    return this.resultHelper.cleanupResult(result);
  }

  async processSite(siteId, networkedAssetsOnly, generateLabels, installation, installationNames, assetTypes) {
    const siteName = await this.runzeroClient.getSiteName(siteId);
    const installationName = installation.name;
    console.log(`processing site ${siteName}, installation ${installationName}. NetworkedAssetsOnly: ${networkedAssetsOnly}.${generateLabels ? ' Using asset name as label.' : ''}`);
    const itemsHandler = async items => await this.sendAssetsTo4me(items, networkedAssetsOnly, generateLabels, installationName, installationNames);
    const sendResults = await this.runzeroClient.getAssetsPaged(siteId, this.assetSeenCutOffDate(), itemsHandler, networkedAssetsOnly, installation.id, assetTypes);
    const jsonResults = await this.downloadResults(sendResults.map(r => r.mutationResult));
    const overallResult = this.reduceResults(sendResults, jsonResults);
    console.log(`processed site ${siteName}, installation ${installationName}. Upload count: ${overallResult.uploadCount}, error count: ${overallResult.errors ? overallResult.errors.length : 0}`);

    return overallResult;
  }

  async sendAssetsTo4me(assets, networkedAssetsOnly = false, generateLabels = false, installation = null, installations = []) {
    const errors = [];
    const result = {uploadCount: 0, errors: errors};
    if (assets.length !== 0) {
      let assetsToProcess = this.removeAssetsNotSeenRecently(assets);
      if (networkedAssetsOnly) {
        // runzero bug: empty IP address is returned from API call for discovered monitors
        assetsToProcess = this.removeAssetsWithoutIP(assets);
      }
      if (assetsToProcess.length !== 0) {
        try {
          const referenceData = await this.referenceHelper.lookup4meReferences(assetsToProcess);
          const discoveryHelper = new DiscoveryMutationHelper(referenceData, generateLabels, installations);
          const input = discoveryHelper.toDiscoveryUploadInput(installation, assetsToProcess);
          const mutationResult = await this.uploadTo4me(input);

          if (mutationResult.error) {
            errors.push(mutationResult.error);
          } else if (mutationResult.errors) {
            errors.push(...this.mapErrors(mutationResult.errors));
          } else {
            result.mutationResult = mutationResult;
          }
        } catch (e) {
          if (e instanceof Js4meAuthorizationError) {
            // no need to keep process going
            throw e;
          }
          console.error(e);
          errors.push(`Unable to upload assets to 4me.`);
        }
      }
    }
    return [result];
  }

  removeAssetsNotSeenRecently(assets) {
    const recentCutOff = this.assetSeenCutOffDate().getTime();
    const recentAssets = assets.filter(asset => !asset.assetBasicInfo.lastSeen || (Date.parse(asset.assetBasicInfo.lastSeen) > recentCutOff));
    if (recentAssets.length < assets.length) {
      console.info(`Skipping ${assets.length - recentAssets.length} assets that have not been seen in ${runzeroIntegration.LAST_SEEN_DAYS} days.`)
    }
    return recentAssets;
  }

  assetSeenCutOffDate() {
    return new Date(new TimeHelper().getMsSinceEpoch() - runzeroIntegration.LAST_SEEN_DAYS * 24 * 60 * 60 * 1000);
  }

  removeAssetsWithoutIP(assets) {
    const assetsWithIP = assets.filter(asset => !!asset.assetBasicInfo.ipAddress);
    if (assetsWithIP.length < assets.length) {
      console.info(`Skipping ${assets.length - assetsWithIP.length} assets that have no IP address.`)
    }
    return assetsWithIP;
  }

  async downloadResults(mutationResultsToRetrieve) {
    const jsonResults = new Map();
    if (mutationResultsToRetrieve.length === 0) {
      console.log('No asynchronous queries results to retrieve');
    } else {
      console.log('Downloading all asynchronous query results');
      const jsonRetrievalCalls = mutationResultsToRetrieve
        .filter(r => !!r)
        .map(async r => jsonResults.set(r, await this.downloadResult(r)));
      await Promise.all(jsonRetrievalCalls);
    }
    return jsonResults;
  }

  async downloadResult(mutationResult) {
    const descr = `discovered CIs result ${mutationResult.asyncQuery.id}`;
    try {
      const helper = this.customer4meHelper;
      return await helper.getAsyncMutationResult(descr, mutationResult, runzeroIntegration.ASYNC_TIMEOUT);
    } catch (e) {
      return {error: e.message};
    }
  }

  reduceResults(sendResults, jsonResults) {
    const overallResult = {uploadCount: 0, errors: []};
    sendResults.forEach(sendResult => {
      if (sendResult.mutationResult) {
        const json = jsonResults.get(sendResult.mutationResult);
        if (json.error) {
          sendResult.errors.push(json.error);
        } else if (json.errors) {
          sendResult.errors.push(...this.mapErrors(json.errors));
        }
        if (json.configurationItems) {
          sendResult.uploadCount = json.configurationItems.length;
        }
      }
      if (sendResult.errors) {
        // 4me errors
        overallResult.errors.push(...sendResult.errors);
      }
      if (sendResult.error) {
        // runzero errors
        overallResult.errors.push(sendResult.error);
      }
      if (sendResult.uploadCount) {
        overallResult.uploadCount = overallResult.uploadCount + sendResult.uploadCount;
      }
    });
    return this.resultHelper.cleanupResult(overallResult);
  }

  mapErrors(errors) {
    return errors.map(e => e.message || e);
  }

  async uploadTo4me(input) {
    const query = runzeroIntegration.graphQL4meMutation('id sourceID');
    const accessToken = await this.customer4meHelper.getToken();
    const result = await this.customer4meHelper.executeAPIMutation('discovered CIs',
                                                                       accessToken,
                                                                       query,
                                                                       {input: input});
    if (result.error) {
      console.error('Error uploading:\n%j', result);
      throw new LoggedError('Unable to upload to 4me');
    } else {
      return result;
    }
  }
}

runzeroIntegration.graphQL4meMutation = (ciResponseFields) => {
  return `
      mutation($input: DiscoveredConfigurationItemsInput!) {
        discoveredConfigurationItems(input: $input) {
          errors { path message }
          configurationItems { ${ciResponseFields} }
          asyncQuery { id errorCount resultUrl resultCount }
        }
      }`;
}
runzeroIntegration.ASYNC_TIMEOUT = parseInt(process.env.DOWNLOAD_RESULT_TIMEOUT, 10) || 300000;
runzeroIntegration.LAST_SEEN_DAYS = parseInt(process.env.LAST_SEEN_DAYS, 10) || 30;

module.exports = runzeroIntegration;
