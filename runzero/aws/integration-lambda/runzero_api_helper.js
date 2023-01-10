'use strict';

const axios = require('axios');
const LoggedError = require('../../../library/helpers/errors/logged_error');
const runzeroAuthorizationError = require('./errors/runzero_authorization_error');

axios.interceptors.request.use(request => {
  console.log('Starting Request', JSON.stringify(request, null, 2));
  return request;
});
axios.interceptors.response.use(response => {
  console.log('Response:', response);
  return response;
});

class runZeroApiHelper {
	constructor(clientId, clientSecret, url, orgname, CredOption) {
		this.clientSecret = clientSecret;
		this.clientId = clientId;
		this.orgName = orgname;
		this.accessToken = false;
		this.CredOption = CredOption;
		this.apiUrl = url + '/api/v1.0';

		// runZero default URLs
		this.resultFormat = '.json';
		this.siteURL = '/export/org/sites' + this.resultFormat + '?fields=name,id,asset_count,organization_id';
		this.assetURL = '/export/org/assets' + this.resultFormat + '?fields=id,site_name,type,hw,names,os,os_version,os_product,os_vendor,last_seen,first_seen,hw_vendor,hw_product,hw_version,comments,addresses,updated_at,organization_id,org_name';
		this.softwareURL = '/export/org/software' + this.resultFormat + '?fields=software_id,software_asset_id,software_vendor,software_product,software_version,software_created_at,software_updated_at,software_update,software_edition,software_language';
		this.orgSearchURL = '/account/orgs?search=' + this.orgName;
		if (this.CredOption == 'export_token') {
			this.accessToken = this.clientSecret;
			this.orgSearchURL = '/export/org/sites.json?fields=organization_id';
    }
    this.orgID = false;
		// oauth config
		this.oauthUrl = `${this.apiUrl}/account/api/token`;
		this.oauthClient = this.createoAuthClient(this.oauthUrl);
		this.tokenExpireTime = 0;
		//const tester = `${this.clientId} -  ${this.clientSecret} -  ${this.apiUrl} - ${this.orgName} -  ${this.CredOption} -  ${this.accessToken} - ${this.oauthUrl}`;
    //console.info(tester); // to remove
  }
  

	// Axios clients
	createoAuthClient(url) {
		const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'client_id': this.clientId,
			'client_secret': this.clientSecret,
			'grant_type': 'client_credentials',
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
			headers.authorization = `Bearer ${bearerToken}`;
		}
		const axiosConfig = {
			baseURL: url,
			timeout: 30000,
			headers: headers,
		};

		return axios.create(axiosConfig);
	}

	checkTokenVaild() {
		if (this.CredOption == 'export_token') {
			return true;
		}
		if (this.accessToken) {
			let timenow = Math.round(new Date().getTime() / 1000);
			if (this.tokenExpireTime && timenow < this.tokenExpireTime) {
				return true;
			}
    }
    this.tokenExpireTime = 0;
		return false;
	}

	storeTokenExpiry(tokenExpiresIn) {
    this.tokenExpireTime = Math.round(new Date().getTime() / 1000 + tokenExpiresIn);
	}

	async getAccessToken() {
		//console.log(`clientID: ${this.clientId} - client_secret: ${this.clientSecret} - URL: ${this.oauthUrl}`); // to remove
		const tokenVaild = this.checkTokenVaild();
		if (tokenVaild) {
			return this.accessToken;
    }
    let errmsg;
    try {
      const clientSecret = encodeURIComponent(this.clientSecret);
      //console.log(`getAccessToken: ${this.clientId} - ${clientSecret} - ${this.oauthUrl}`) // to remove
      const headers = {
			'Content-Type': 'application/x-www-form-urlencoded',
		  };
      const lecResponse = await axios.post(this.oauthUrl,
       `grant_type=client_credentials&client_id=${this.clientId}&client_secret=${clientSecret}`,
        { headers: headers }
        );
      const response = lecResponse.data;
			if (response && response.access_token) {
				this.accessToken = response.access_token;
				this.storeTokenExpiry(response.expires_in);
				console.log(this.accessToken); // to remove
				return this.accessToken;
      } else if (response) {
        errmsg = `Error retrieving runZero access token. Status: ${lecResponse.status}`;
      } else {
        errmsg = `Error retrieving runZero access token. Status: ${lecResponse.status}. No response body`;
			}
			return {
				error: errmsg,
			};
		} catch (error) {
			if (error.response) {
				const response = error.response;
				if (response.status === 401 || response.status === 404) {
          errmsg = "runZero credentials Error: " + response.statusText + " " + response.status;
          return {
				      authError: errmsg,
		      };
				} else {
					const url = error.config.url;
					console.error(`Error from ${url}. ${response.status}: ${response.statusText}`);
				}
      }
      errmsg = error;
    }
    return {
				error: errmsg,
		};
	}

	async getOrgID() {
		if (this.orgID) {
			return this.orgID;
    }
    try {
      const accessToken = await this.getAccessToken();
      if (accessToken.error || accessToken.authError) {
        return accessToken;
      }
			const client = this.createClient(this.apiUrl, accessToken);
			const result = await client.get(`${this.orgSearchURL}`);
			console.log(result); // to remove
      if (result.errors) {
        return { error: `Errors from Get OrgID call: ${result.errors}` };
      } else {
        //console.log(result.data); // to remove
        if (!result.data || result.data.length === 0) {
          return { error: `No OrgID in runzero response: ${result}` };
        }
        if (this.CredOption == 'export_token') {
          this.orgID = result.data[0].organization_id;
        } else {
          this.orgID = result.data[0].id;
        } 
      }
      //console.log(`OrgID: ${this.orgID}`); // to remove
    } catch (e) {
      return { error: `Unable to get OrgID: ${e}` };
    }
    return this.orgID;
	}

	getURL(query, filter) {
		let typeURL = false;
		switch (query) {
			case "asset":
				typeURL = this.assetURL;
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
		if (!typeURL) {
			return false;
		}
		if (filter) {
			typeURL = typeURL + filter;
		}
		if (this.CredOption == 'api_client' && filter != 'org') {
      typeURL = typeURL + '&_oid=' + this.orgID;
		 }
		return typeURL;
	}

	async getRESTQuery(descr, query, filter) {
		const typeURL = this.getURL(query, filter);
		if (!typeURL) {
			return {
				error: `Invalid query: ${descr}`
			};
		}
    const accessToken = await this.getAccessToken();
    this.getOrgID();
		if (accessToken.error) {
			return accessToken.error;
		}
		try {
			const client = this.createClient(this.apiUrl, accessToken);
			const lecResponse = await client.get(`${typeURL}`);
			console.log(lecResponse); // to remove
			const responseBody = lecResponse.data;
			const errors = responseBody.errors;
			if (errors) {
				console.log("Errors from API call:\n%j", errors);
				return {
					error: `Unable to query ${descr}`
				};
			} else {
				return responseBody;
			}
		} catch (error) {
			if (error.response) {
				const lecResponse = error.response;
				if (lecResponse.data && lecResponse.data.errors) {
					const errors = lecResponse.data.errors;
					console.error("Errors from API call:\n%j", errors);
					return {
						error: `Unable to query ${descr}`
					};
				} else {
					const url = error.config.url;
					console.error(`Error from ${url}. ${lecResponse.status}: ${lecResponse.statusText}`);
				}
			} else {
				console.error(error);
			}
			return {
				error: `Unable to query ${descr}`
			};
		}
	}
}

module.exports = runZeroApiHelper;