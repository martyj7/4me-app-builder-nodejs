'use strict';

const runzeroClient = require('./runzero_client');
const DiscoveryMutationHelper = require('./discovery_mutation_helper');
const ReferenceHelper = require('./references_helper');
const TimeHelper = require('../../../library/helpers/time_helper');
const LoggedError = require('../../../library/helpers/errors/logged_error');
const Js4meAuthorizationError = require('../../../library/helpers/errors/js_4me_authorization_error');
const runzeroAuthorizationError = require('./errors/runzero_authorization_error')
const runzeroAPIError = require('./errors/runzero_api_error');
const ResultHelper = require('../../../library/helpers/result_helper');

class runzeroIntegration {
  constructor(clientId, clientSecret, url, orgname, CredOption, customer4meHelper) {
    this.runzeroClient = new runzeroClient(clientId, clientSecret, url, orgname, CredOption);
    this.customer4meHelper = customer4meHelper;
    this.referenceHelper = new ReferenceHelper(customer4meHelper);
    this.resultHelper = new ResultHelper();
    this.SitesReferences = [];
    this.SoftwareReferences = [];
  }

  async validateCredentials() {
    const orgId = await this.runzeroClient.getOrgID();
    console.info(`Validated runzero access. Can access OrgID: ${orgId}`);
    const accessToken = await this.customer4meHelper.getToken();
    console.info('Validated 4me customer account access.');
    return true;
  }

  async processAll(configAssetTypes, generateLabels, siteFilter, siteNames, sitesAssetsOnly) {

    // Create/update sites first
    let siteList;
    try {
      siteList = await this.runzeroClient.getSites(siteFilter, siteNames, sitesAssetsOnly);
      //console.log(siteList); // to remove
    } catch (error) {
      if (error instanceof runzeroAPIError) {
        return {error: error.message};
      }
      throw error;
    }

    let assetTypes = null;
      if (configAssetTypes) {
        const allAssetTypes = await this.runzeroClient.getAssetTypes();
        if (allAssetTypes.error) {
          siteError = allAssetTypes.error;
        } else {
          assetTypes = configAssetTypes.filter(at => allAssetTypes.indexOf(at) > -1);
        }
    }
    const result = { uploadCounts: {}, info: {}, errors: {} };
    console.log('processing sites');
    let siteCounts = 0;
    let siteErrors = {};
    for (const site of siteList) {
      //console.log(site.name); //to remove
      const siteResult = await this.sendSitesto4me(site);
      if (siteResult.errors.length > 0) {
        siteErrors[site.name] = siteResult.errors;
      } 
      siteCounts += 1;
    }
    result.uploadCounts["Sites"] = siteCounts;
    console.log(`Site error length: ${Object.keys(siteErrors).length}`); // to remove
    if (Object.keys(siteErrors).length > 0) {
        result.errors["Sites"] = siteErrors;
    }

    // create/update software CIs next
    const softwareResult = await this.processSoftware(generateLabels, assetTypes);
    result.uploadCounts['Software'] = softwareResult.uploadCount;
      if (softwareResult.errors) {
        result.errors['Software'] = softwareResult.errors;
    }
    
    // create/update assets last
    const assetResult = await this.processAssets(generateLabels, assetTypes);
    result.uploadCounts['Assets'] = assetResult.uploadCount;
      if (assetResult.errors) {
        result.errors['Assets'] = assetResult.errors;
      }
    
    // return the results
    return this.resultHelper.cleanupResult(result);
  }

  async processAssets(generateLabels, assetTypes) {
    console.log('processing assets');
    const itemsHandler = async items => await this.sendAssetsTo4me(items, generateLabels);
    const sendResults = await this.runzeroClient.getAssets(itemsHandler, assetTypes);
    const jsonResults = await this.downloadResults(sendResults.map(r => r.mutationResult));
    const overallResult = this.reduceResults(sendResults, jsonResults);
    console.log(`Upload count: ${overallResult.uploadCount}, error count: ${overallResult.errors ? overallResult.errors.length : 0}`); 
    
    return overallResult;
  }

  async processSoftware(generateLabels, assetTypes) {
    console.log('processing software');
    const itemsHandler = async items => await this.sendSoftwareto4me(items, generateLabels);
    const sendResults = await this.runzeroClient.getSoftware(itemsHandler, assetTypes);
    const jsonResults = await this.downloadResults(sendResults.map(r => r.mutationResult));
    const overallResult = this.reduceResults(sendResults, jsonResults);
    console.log(`Upload count: ${overallResult.uploadCount}, error count: ${overallResult.errors ? overallResult.errors.length : 0}`); 
    
    return overallResult;
  }

  async sendSitesto4me(site) {
    const errors = [];
    const result = { uploadCount: 0, errors: errors };
    try {
      const referenceData = await this.referenceHelper.lookup4meSiteReferences(site);
      let input = {
        "name": site.name,
        "remarks": "Created by runZero, SiteID: " + site.id
      };
      let discoType = 'siteCreate'
      //console.log(referenceData); //to remove
      if (referenceData) {
        this.SitesReferences.push(referenceData);
        input.id = referenceData.id
        discoType = 'siteUpdate'
      }
      const mutationResult = await this.uploadSiteTo4me(input, discoType);

      if (mutationResult.error) {
          errors.push(mutationResult.error);
        } else if (mutationResult.errors) {
          errors.push(...this.mapErrors(mutationResult.errors));
        } else {
          result.uploadCount = 1;
        }
      } catch (e) {
        if (e instanceof Js4meAuthorizationError) {
          // no need to keep process going
          throw e;
        }
        console.error(e);
        errors.push(`Unable to upload site to 4me.`);
    }
    
      return result;
  }

  async sendSoftwareto4me(softwares, generateLabels = false) {
    //console.log(softwares); // to remove
    const errors = [];
    const result = {uploadCount: 0, errors: errors};
    if (softwares.length !== 0) {
      //let assetsToProcess = this.removeAssetsNotSeenRecently(assets);
      let assetsToProcess = softwares;
      if (assetsToProcess.length !== 0) {
        try {
          const referenceData = await this.referenceHelper.lookup4meSoftwareReferences();
          const discoveryHelper = new DiscoveryMutationHelper(referenceData, generateLabels, this.SitesReferences, this.SoftwareReferences);
          const input = discoveryHelper.toDiscoverySWUploadInput(assetsToProcess);
          this.SoftwareReferences = assetsToProcess;
          //console.log(assetsToProcess); // to remove
          //console.log(input.physicalAssets); // to remove
          const mutationResult = await this.uploadSWTo4me(input);

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
          errors.push(`Unable to upload software to 4me.`);
        }
      }
    }
    //console.log(result); // to remove
    return [result];
  }

  async sendAssetsTo4me(assets, generateLabels = false) {
    //console.log(assets); // to remove
    const errors = [];
    const result = {uploadCount: 0, errors: errors};
    if (assets.length !== 0) {
      //let assetsToProcess = this.removeAssetsNotSeenRecently(assets);
      let assetsToProcess = assets;
      if (assetsToProcess.length !== 0) {
        try {
          const referenceData = await this.referenceHelper.lookup4meReferences(assetsToProcess);
          const discoveryHelper = new DiscoveryMutationHelper(referenceData, generateLabels, this.SitesReferences, this.SoftwareReferences);
          const input = discoveryHelper.toDiscoveryUploadInput(assetsToProcess);
          //console.log(input.products); // to remove
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
    const recentAssets = assets.filter(asset => !asset.last_seen || (Date.parse(asset.last_seen) > recentCutOff));
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
    //console.log(query); // to remove
    const result = await this.customer4meHelper.executeGraphQLMutation('discovered CIs',
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

  async uploadSWTo4me(input) {
    const results = [];
    const query = `
      mutation($input: ConfigurationItemCreateInput!) {
        configurationItemCreate(input: $input) {
          errors { path message }
        }
      }`;
    console.log(input.physicalAssets); //to remove
    console.log(input.physicalAssets[0].products[0]); //to remove
    const accessToken = await this.customer4meHelper.getToken();
    input.forEach(s => {
      const result = this.customer4meHelper.executeGraphQLMutation('discovered Softwares',
                                                                       accessToken,
                                                                       query,
                                                                       {input: s});
      if (result.error) {
        console.error('Error uploading:\n%j', result);
        throw new LoggedError('Unable to upload to 4me');
      } else {
        results.push(result);
      }
    });
    return results;
  }

  async uploadSiteTo4me(input, discoType) {
    const fields = (discoType == 'siteCreate') ? 'name remarks' : 'id name remarks';
    const inputType = (discoType == 'siteCreate') ? 'SiteCreateInput' : 'SiteUpdateInput';
    const query =  `
      mutation($input: ${inputType}!) {
        ${discoType}(input: $input) {
          errors { path message }
          site { ${fields} }
        }
      }`;
    const accessToken = await this.customer4meHelper.getToken();
    const result = await this.customer4meHelper.executeGraphQLMutation('discovered sites',
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
