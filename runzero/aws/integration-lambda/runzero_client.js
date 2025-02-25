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

  async setOrgID() {
    const orgSet = await this.apiHelper.getOrgID();
    if (orgSet.error) {
      throw new runzeroAPIError(orgSet.error);
    } else if (orgSet.authError) {
      throw new runzeroAuthorizationError(orgSet.authError);
    }
    return orgSet;
  }

  async getSites(siteFilter, siteNames, sitesAssetsOnly) {
    let sites = [];
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
            sites.push(checksite);
          }
        } else if (siteFilter) {
            if (siteNames.includes(checksite.name)) {
            sites.push(checksite);
          }
        }
        else {
          sites.push(checksite);
        }
      });
    }
    return sites;
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
    let results = [];
    const chunkSize = 100;
    if (assetTypes) {
      let filter = "&search=";
      assetTypes.forEach(element => {
        filter += `type:'${element}' or `;
      });
      var result = await this.apiHelper.getRESTQuery('Assets', 'asset', filter.slice(0, -3));
    } else {
      var result = await this.apiHelper.getRESTQuery('Assets', 'asset');
    }

    if (result.error) {
      console.error(`Error Getting assets: ${result.error}`)
    } else {
      //console.log(`Assets: ${JSON.stringify(result, null, 4)}`); // to remove
      for (let i = 0; i < result.length; i += chunkSize) {
        const chunk = result.slice(i, i + chunkSize);
        //console.log(`Assets: ${JSON.stringify(chunk, null, 4)}`); // to remove
        const itemResults = await itemsHandler(chunk);
        results = [...results, ...itemResults];
      }
      //results = await itemsHandler(result);
    }
    return results;
  }

   async getSoftware(itemsHandler, assetTypes) {
    let itemResults = [];
    if (assetTypes) {
      let filter = "&search=";
      assetTypes.forEach(element => {
        filter += `type:'${element}' or `;
      });
      var result = await this.apiHelper.getRESTQuery('Software', 'software', filter.slice(0, -3));
    } else {
      var result = await this.apiHelper.getRESTQuery('Software', 'software');
    }

    if (result.error) {
      console.error(`Error Getting Software: ${result.error}`)
    } else {
      itemResults = await itemsHandler(result);
    }
     //console.log(itemResults); // to remove
    return itemResults;
  }
}

module.exports = runzeroClient;