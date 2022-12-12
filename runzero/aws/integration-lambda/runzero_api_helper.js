'use strict';

const axios = require('axios');
const LoggedError = require('../../../library/helpers/errors/logged_error');
const runzeroAuthorizationError = require('./errors/runzero_authorization_error');

class runZeroApiHelper {
  constructor(clientSecret) {
    this.apiUrl = 'https://console.rumble.run/api/v1.0';
    this.clientSecret = clientSecret;

    this.resultFormat = '.jsonl'
    this.siteURL = '/export/org/sites' + this.resultFormat
    this.assetURL = '/export/org/assets' + this.resultFormat
    this.softwareURL = '/export/org/software' + this.resultFormat
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

  async getRESTQuery(descr, query) {
    try {
      let typeURL;
      switch (query) {
        case asset:
          typeURL = this.assetURL 
        case site:
          typeURL = this.siteURL
        case software:
          typeURL = this.softwareURL
      }
      const client = this.createClient(this.apiUrl, this.clientSecret);
      const lecResponse = await client.get(
        `${query}`,
        {
          query: query,
          fields: vars,
        }
      );
      const responseBody = lecResponse.data;
      const errors = responseBody.errors;
      if (errors) {
        console.log("Errors from API call:\n%j", errors);
        return { error: `Unable to query ${descr}` };
      } else {
        return responseBody.data;
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

  async executeAPIMutation(descr, query, vars) {
    const result = await this.getRESTQuery(descr, query, vars);
    if (result.error) {
      return result;
    } else {
      const updateResult = result[Object.keys(result)[0]];
      if (updateResult.errors && updateResult.errors.length > 0) {
        return { error: updateResult.errors };
      } else {
        return updateResult;
      }
    }
  }
}

module.exports = runZeroApiHelper;