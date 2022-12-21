'use strict';

const runZeroApiHelper = require('./runzero_api_helper');
const runzeroHelper = require('./runzero_helper');
const LoggedError = require('../../../library/helpers/errors/logged_error');
const runzeroAuthorizationError = require('./errors/runzero_authorization_error');
const runzeroAPIError = require('./errors/runzero_api_error');

class runzeroClient {
  constructor(clientId, clientSecret, url, orgname, CredOption) {
    this.apiHelper = new runZeroApiHelper(clientId, clientSecret, url, orgname, CredOption);
    this.CredOption = CredOption;
    this.helper = new runzeroHelper();
  }

  async getSiteIds(sitesAssetsOnly) {
    return (await this.getSites(sitesAssetsOnly)).map(s => s.id);
  }

  async getSiteName(id) {
    return (await this.getSites()).find(s => s.id === id).name;
  }

  async getOrgID() {
    const result = await this.apiHelper.getRESTQuery('runZero Organisation', 'org');
    if (result.error) {
      console.info(`Unable to get Org ID: ${result.error}`);
      throw new runzeroAPIError(result.error);
    } else {
      if (!result || result.length === 0) {
        console.error('No OrgID in runzero response, got:\n%j', result);
        throw new runzeroAuthorizationError('No OrgID returned in response');
      }
      if (this.CredOption = 'export_token') {
        return result[0].organization_id
      }
      return result.id
    }

  }
  async getSites(siteFilter, siteNames, sitesAssetsOnly) {
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
          } else if (siteFilter) {
             if (siteNames.includes(checksite.name)) {
              this.sites.push(checksite);
            }
          }
          else {
            this.sites.push(checksite);
         }
        });
      }
    }
    return this.sites;
  }

  async getAssetTypes() {
    const result = await this.apiHelper.getRESTQuery('asset types', 'assettype');
    if (result.error) {
      return result;
    } else {
      let typeArray = [];
      result.forEach(function result(key, value) { typeArray.push(key.type.toLowerCase()) })   
      return myarray.filter((v,i,a)=>a.indexOf(v)==i);
    }
  }

  async getAssets(itemsHandler, assetTypes) {
    let itemResults = [];
    if (assetTypes) {
      let filter = "&search=";
      assetTypes.forEach(element => {
        filter += `type:'${element}' or `;
      });
      var result = await this.apiHelper.getRESTQuery('Site assets', asset, filter.slice(0, -3));
    } else {
      var result = await this.apiHelper.getRESTQuery('Site assets', asset);
    }

    if (result.error) {
      console.error(`Error Getting assets: ${result.error}`)
    } else {
      itemResults = await itemsHandler(result);
    }

    return itemResults;
  }

   async getSoftware(itemsHandler, assetTypes) {
    let itemResults = [];
    if (assetTypes) {
      let filter = "&search=";
      assetTypes.forEach(element => {
        filter += `type:'${element}' or `;
      });
      var result = await this.apiHelper.getRESTQuery('Site assets', asset, filter.slice(0, -3));
    } else {
      var result = await this.apiHelper.getRESTQuery('Site assets', asset);
    }

    if (result.error) {
      console.error(`Error Getting assets: ${result.error}`)
    } else {
      itemResults = await itemsHandler(result);
    }

    return itemResults;
  }
}

module.exports = runzeroClient;