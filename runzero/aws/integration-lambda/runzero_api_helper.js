'use strict';

const axios = require('axios');
const LoggedError = require('../../../library/helpers/errors/logged_error');
const runzeroAuthorizationError = require('./errors/runzero_authorization_error');

class runZeroApiHelper {
  constructor(clientId, clientSecret, url, orgname, CredOption) {
    this.clientSecret = clientSecret;
    this.clientId = clientId;
    this.orgName = orgname;
    this.orgID;
    this.accessToken = false;
    this.CredOption = CredOption;
    this.apiUrl = url + '/api/v1.0';
    this.oauthUrl = `${this.apiUrl}/account/api`;

    this.resultFormat = '.json';
    this.siteURL = '/export/org/sites' + this.resultFormat + '?fields=name,id,asset_count,organization_id';
    this.assetURL = '/export/org/assets' + this.resultFormat + '?fields=id,site_name,type,hw,names,os,os_version,os_product,os_vendor,last_seen,first_seen,hw_vendor,hw_product,hw_version,comments,addresses,updated_at,organization_id,org_name';
    this.softwareURL = '/export/org/software' + this.resultFormat + '?fields=software_id,software_asset_id,software_vendor,software_product,software_version,software_created_at,software_updated_at,software_update,software_edition,software_language';
    this.orgSearchURL = '/account/orgs?search=' + this.orgName;

     if (this.CredOption == 'export_token') {
       this.accessToken = this.clientSecret;
       this.orgSearchURL = '/export/org/sites.json?fields=organization_id'
    }

    this.oauthClient = this.createoAuthClient(this.oauthUrl);
    this.tokenExpiresIn = false;
    this.tokenExpireTime = false;
    const tester = `${this.clientId} -  ${this.clientSecret} -  ${this.apiUrl} - ${this.orgName} -  ${this.CredOption} -  ${this.accessToken} - ${this.oauthUrl}`
    console.info(tester); // to remove
  }

  createoAuthClient(url) {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    const axiosConfig = {
      baseURL: url,
      timeout: 30000,
      headers: headers,
    };

    return axios.create(axiosConfig);
  }

  createClient(url, bearerToken) {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (bearerToken) {
      headers['authorization'] = `Bearer ${bearerToken}`;
    }
    const axiosConfig = {
      baseURL: url,
      timeout: 30000,
      headers: headers,
    };

    return axios.create(axiosConfig);
  }

  checkTokenVaild() {
    let check = false
    if (this.CredOption == 'export_token') {
      return true
    }
    if (this.accessToken) {
      let timenow = Math.round(new Date().getTime() / 1000)
      if (this.tokenExpireTime && timenow < this.tokenExpireTime) {
        return true
      }
    }
    return false
  }

  storeTokenExpiry() {
    this.tokenExpireTime = Math.round(new Date().getTime() / 1000 + this.tokenExpiresIn);
  }

  async getAccessToken() {
    console.log(`clientID: ${this.clientId} - client_secret: ${this.clientSecret} - URL: ${this.oauthUrl}`)
    const tokenVaild = this.checkTokenVaild();
    if (tokenVaild) {
      return this.accessToken;
    }
    try {
      const lecResponse = await this.oauthClient.post(
        '/token',
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials',
        }
      );
      //console.error(response); // to remove
      const response = lecResponse.data;
      if (response && response.access_token) {
        this.accessToken = response.access_token;
        this.tokenExpiresIn = response.expires_in;
        storeTokenExpiry();
        console.log(this.accessToken); // to remove
        return this.accessToken;
      } else if (response) {
        console.error(`Error retrieving runZero access token. Status: ${lecResponse.status}\n%j`, response);
        this.tokenExpiresIn = false;
      } else {
        console.error(`Error retrieving runZero access token. Status: ${lecResponse.status}. No response body`);
        this.tokenExpiresIn = false;
      }
      return {
        error: 'Unable to access runZero',
      }
    } catch (error) {
      if (error.response) {
        const response = error.response;
        if (response.status === 401 || response.status === 404) {
          // 401: bad client secret or refresh token
          // 404: bad client ID
          const msg = "Incorrect runZero credentials: " + response.statusText;
          console.error(msg);
          throw new runzeroAuthorizationError(msg);
        } else {
          const url = error.config.url;
          console.error(`Error from ${url}. ${response.status}: ${response.statusText}`);
        }
      } else {
        console.error(error);
      }
      throw new LoggedError(error);
    }
  }

  async getOrgID() {
    if (this.orgID) {
      return this.orgID
    }
    const result = await this.getRESTQuery('runZero Organisation', 'org');
    if (result.error) {
      console.info(`Unable to get Org ID: ${result.error}`);
    } else {
      if (!result || result.length === 0) {
        console.error('No OrgID in runzero response, got:\n%j', result);
      }
      if (this.CredOption = 'export_token') {
        return result[0].organization_id
      }
      this.orgID = result.id;
      return this.orgID;
    }
  }

  async getRESTQuery(descr, query, filter) {
    let typeURL;
      switch (query) {
        case "asset":
          typeURL = this.assetURL ;
          break;
        case "site":
          typeURL = this.siteURL;
          break;
        case "software":
          typeURL = this.softwareURL;
          break;
        case "org":
          typeURL = this.orgSearchURL;
          break;
        case "assettype":
          typeURL = this.assetURL + '?fields=type';
          break;
        default:
          typeURL = undefined;
      }
    if (!typeURL){
      return { error: `Unable to query ${descr}` };   
    }
    if (filter) {
      typeURL = typeURL + filter;
    }
   /*  if (this.CredOption == 'api_client') {
      typeURL = typeURL + '&_oid=' + this.getOrgID()
    } */
    
    const accessToken = await this.getAccessToken();
    if (accessToken.error) {
      return accessToken;
    }
    try {

      const client = this.createClient(this.apiUrl, this.clientSecret);
      const lecResponse = await client.get(`${typeURL}`);
      console.log(lecResponse)
      const responseBody = lecResponse.data;
      const errors = responseBody.errors;
      if (errors) {
        console.log("Errors from API call:\n%j", errors);
        return { error: `Unable to query ${descr}` };
      } else {
        return responseBody;
      }
    } catch (error) {
      if (error.response) {
        const lecResponse = error.response;
        if (lecResponse.data && lecResponse.data.errors) {
          const errors = lecResponse.data.errors;
          console.error("Errors from API call:\n%j", errors);
          return { error: `Unable to query ${descr}` };
        } else {
          const url = error.config.url;
          console.error(`Error from ${url}. ${lecResponse.status}: ${lecResponse.statusText}`);
        }
      } else {
        console.error(error);
      }
      return { error: `Unable to query ${descr}` };
    }
  }
}

module.exports = runZeroApiHelper;