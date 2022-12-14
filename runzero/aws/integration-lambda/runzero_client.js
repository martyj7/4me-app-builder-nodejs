'use strict';

const runZeroApiHelper = require('./runzero_api_helper');
const runzeroHelper = require('./runzero_helper');
const LoggedError = require('../../../library/helpers/errors/logged_error');
const runzeroAuthorizationError = require('./errors/runzero_authorization_error');
const runzeroAPIError = require('./errors/runzero_api_error');

class runzeroClient {
  constructor(clientId, clientSecret, refreshToken) {
    this.apiHelper = new runZeroApiHelper(clientId, clientSecret, refreshToken);
    this.helper = new runzeroHelper();
  }

  async getSiteIds(sitesAssetsOnly) {
    return (await this.getSites(sitesAssetsOnly)).map(s => s.id);
  }

  async getSiteName(id) {
    return (await this.getSites()).find(s => s.id === id).name;
  }

  async getSites(siteNames, sitesAssetsOnly) {
    if (!this.sites) {
      this.sites = [];
      const result = await this.apiHelper.getRESTQuery('runzero sites', 'site');
      if (result.error) {
        console.info(`Unable to query sites: ${result.error}`);
        throw new runzeroAPIError(result.error);
      } else {
        if (!result || result.length === 0) {
          console.error('No sites in runzero response, got:\n%j', result);
          throw new runzeroAuthorizationError('No sites returned in response');
        }
       result.forEach(function (checksite) {
          if (sitesAssetsOnly){
            if (checksite.asset_count > 0) {
              this.sites.push(checksite);
            }
          } else if (siteNames) {
            
          }
          else {
            this.sites.push(checksite);
         }
        });
      }
    }
    return this.sites;
  }

  async getAssetTypes(siteId) {
    const query = `query getAssetTypes($siteId: ID!) {
      site(id: $siteId) {
        id
        assetTypes
      }
    }`;

    const result = await this.apiHelper.getRESTQuery('asset types',
                                                        query,
                                                        {siteId: siteId});
    if (result.error) {
      return result;
    } else {
      return result.site.assetTypes;
    }
  }

  async getAllInstallationNames() {
    const installationsPerSite = await this.getInstallationsPerSite();
    return [...installationsPerSite.values()]
      .reduce((memo, i) => memo.concat(i))
      .map(i => i.name);
  }

  async getInstallationsPerSite() {
    const result = new Map();
    for (const site of (await this.getSites())) {
      const siteId = site.id;
      const allForSite = await this.getAllInstallations(siteId);
      if (allForSite.error) {
        console.error(`Error querying installations for ${site.name}/${siteId}`);
        return allForSite;
      } else {
        result.set(siteId, allForSite);
      }
    }
    return result;
  }

  async getAllInstallations(siteId) {
    if (!this.installationsBySiteId) {
      this.installationsBySiteId = new Map();
    }
    if (this.installationsBySiteId.has(siteId)) {
      return this.installationsBySiteId.get(siteId);
    }

    // the 'id' returned for each installation can be used to filter assets based on their 'installKey' field.
    const query = `query getInstallations($siteId: ID!) {
      site(id: $siteId) {
        allInstallations {
          id
          siteId
          name
          fqdn
          description
          unlinkedOn
          unlinkedBy
          linkStatus
          installationDate
          type
          totalAssets
          syncServerStatus
          lastAvailable
          version
          syncServer
        }
      }
    }`;

    const result = await this.apiHelper.getRESTQuery('all installations',
                                                        query,
                                                        {siteId: siteId});
    if (result.error) {
      return result;
    } else {
      const allForSite = result.site.allInstallations;
      this.installationsBySiteId.set(siteId, allForSite);
      return allForSite;
    }
  }

  async getAssetsPaged(siteId, assetCutOffDate, itemsHandler, withIP, installKey, assetTypes) {
    let retrieved = 0;
    let results = [];

    let firstPage = await this.getFirstAssetPage(siteId, assetCutOffDate, withIP, installKey, assetTypes);
    if (firstPage.error) {
      return [firstPage];
    }

    let total = firstPage.total;
    if (firstPage.items) {
      retrieved += firstPage.items.length;
      console.log(`retrieved first ${retrieved} of ${total}`);

      const itemResults = await itemsHandler(firstPage.items);
      firstPage.items = null; // allow garbage collection
      results = [...results, ...itemResults];

      let next = firstPage.pagination.next;
      while (next && retrieved < total) {
        let nextPage = await this.getNextAssetPage(siteId, assetCutOffDate, next, withIP, installKey, assetTypes);
        if (nextPage.error) {
          results = [...results, nextPage];
          break;
        }

        total = nextPage.total;
        if (nextPage.items && nextPage.items.length > 0) {
          retrieved += nextPage.items.length;
          console.log(`retrieved first ${retrieved} of ${total}`);

          const itemResults = await itemsHandler(nextPage.items);
          nextPage.items = null; // allow garbage collection
          results = [...results, ...itemResults];
        }
        next = nextPage.pagination.next
      }
    }
    return results;
  }

  async getFirstAssetPage(siteId, assetCutOffDate, withIP, installKey, assetTypes) {
    return await this.getAssetPage(siteId, {limit: runzeroClient.pageSize, page: "FIRST"}, withIP, assetCutOffDate, installKey, assetTypes);
  }

  async getNextAssetPage(siteId, assetCutOffDate, next, withIP, installKey, assetTypes) {
    return await this.getAssetPage(siteId, {limit: runzeroClient.pageSize, page: "NEXT", cursor: next}, withIP, assetCutOffDate, installKey, assetTypes);
  }

  async getAssetPage(siteId, pagination, withIP, assetCutOffDate, installKey, assetTypes) {
    const filters = this.getFilters(withIP, assetCutOffDate, installKey, assetTypes);
    const fields = runzeroClient.topLevelFields.split(' ');

    runzeroClient.basicInfoFields
      .split(' ')
      .forEach(field => fields.push(`assetBasicInfo.${field}`));

    runzeroClient.assetCustomFields
      .split(' ')
      .forEach(field => fields.push(`assetCustom.${field}`));

    runzeroClient.operatingSystemFields
      .split(' ')
      .forEach(field => fields.push(`operatingSystem.${field}`));

    runzeroClient.usersFields
      .split(' ')
      .forEach(field => fields.push(`users.${field}`));

    runzeroClient.softwaresFields
      .split(' ')
      .forEach(field => fields.push(`softwares.${field}`));

    const query = `query getAssetResources($siteId: ID!, $pagination: AssetsPaginationInputValidated, $fields: [String!]!) {
      site(id: $siteId) {
        assetResources(assetPagination: $pagination, fields: $fields, filters: ${filters}) {
          total
          pagination {
            next
          }
          items
        }
      }
    }`;

    const result = await this.apiHelper.getRESTQuery('asset page',
                                                        query,
                                                        {siteId: siteId, pagination: pagination, fields: fields});
    if (result.error) {
      return result;
    } else {
      return result.site.assetResources;
    }
  }

  async startExport(siteId, assetCutOffDate, installKey) {
    const filters = this.getFilters(true, assetCutOffDate, installKey);
    const query = `
      mutation export($siteId: ID!) {
        site(id: $siteId) {
          exportFilteredAssets(filters: ${filters}) {
            assetBasicInfo {${runzeroClient.basicInfoFields}}
            assetCustom {${runzeroClient.assetCustomFields}}
            operatingSystem {${runzeroClient.operatingSystemFields}}
            users {${runzeroClient.usersFields}}
            softwares {${runzeroClient.softwaresFields}}
            ${runzeroClient.topLevelFields}
            exportId
          }
        }
      }`;
    const response = await this.apiHelper.executeAPIMutation('start export',
                                                                 query,
                                                                 {siteId: siteId});
    if (response.error) {
      return response;
    } else {
      return response.exportFilteredAssets.exportId;
    }
  }

  async getExportStatus(siteId, exportId) {
    const query = `
      query exportStatus($siteId: ID!, $exportId: ID!) {
        site(id: $siteId) {
          exportStatus(exportId: $exportId) { progress url }
        }
      }`;

    const result = await this.apiHelper.getRESTQuery('export status',
                                                        query,
                                                        {siteId: siteId, exportId: exportId});
    if (result.error) {
      return result;
    } else {
      return result.site.exportStatus;
    }
  }

  getFilters(withIP, assetCutOffDate, installKey, assetTypes = null) {
    let conditions = '';

    if (assetTypes) {
      let assetTypesRegEx = this.helper.arrayToRegExValue(assetTypes);
      conditions = `{operator: REGEXP, path: "assetBasicInfo.type", value: "${assetTypesRegEx}"}`;
    } else {
      if (withIP !== undefined) {
        conditions = `{operator: EXISTS, path: "assetBasicInfo.ipAddress", value: "${withIP}"}`;
      }
    }

    if (installKey !== undefined) {
      conditions = `${conditions}\n{operator: EQUAL, path: "installKey", value: "${installKey}"}`;
    }

    return `{conjunction: OR, groups: [
      { conditions: [ 
        ${conditions}
        { operator: GREATER_THAN, path: "assetBasicInfo.lastSeen", value: "${assetCutOffDate.toISOString()}" }
        ]}
      { conditions: [ 
        ${conditions}
        { operator: EXISTS, path: "assetBasicInfo.lastSeen", value: "false" }
        ]}
      ]}`;
  }
}

runzeroClient.pageSize = parseInt(process.env.runzero_PAGE_SIZE, 10) || 100;
runzeroClient.topLevelFields = '_id key url';
runzeroClient.basicInfoFields = 'name type description ipAddress firstSeen lastSeen lastChanged userName userDomain';
runzeroClient.assetCustomFields = 'model manufacturer stateName purchaseDate warrantyDate serialNumber sku';
runzeroClient.usersFields = 'name email fullName';
runzeroClient.softwaresFields = 'name';
runzeroClient.operatingSystemFields = 'caption';

module.exports = runzeroClient;