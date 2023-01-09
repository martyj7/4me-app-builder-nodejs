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
    this.storedProducts = [];
    this.SoftwareReferences = [];
    this.storedConfigItems = [];
    this.defaultTeamId;
    this.storedOrgs = [];
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
    //console.log(`Site error length: ${Object.keys(siteErrors).length}`); // to remove
    if (Object.keys(siteErrors).length > 0) {
        result.errors["Sites"] = siteErrors;
    }
    console.log(`Upload count: ${siteCounts}, error count: ${siteErrors ? siteErrors.length : 0}`); 

    // create/update software CIs next
    const softwareResult = await this.processSoftware(generateLabels, assetTypes);
    result.uploadCounts['Software'] = softwareResult.uploadCount;
      if (softwareResult.errors.length > 0) {
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
    //console.log(`Software Result: ${JSON.stringify(sendResults, null, 4)}`); // to remove
    console.log(`Upload count: ${sendResults.uploadCount}, error count: ${sendResults.errors[0] ? sendResults.errors[0].length : 0}`); 
    return sendResults;
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

  async addExtendedData(assets) {
    for (let asset of assets) {
      if (asset.os && asset.os_product && asset.os_vendor) {
        let sysID = `${asset.os} ${asset.os_version}`;
      if (!asset.os_version) {
        sysID = asset.os;
      }
        const OSConstruct =  [{
                "meta": {
                    "strategy": "CREATE"
                },
                "sourceID": "software/operating_system_software",
                "name": asset.os,
                "brand": asset.os_vendor,
                "configurationItems": [
                    {
                        "sourceID": "runZero",
                        "systemID": asset.os,
                        "status": "in_production",
                        "name": sysID
                    }
                ]
            }]
        await this.uploadSWTo4me(OSConstruct);
      }
      /* if (asset.org_name && !this.storedOrgs.find(e => e.name == asset.org_name)) {
        
        const input = {
        "name": asset.org_name,
        "remarks": "Created by runZero, OrgID: " + asset.organization_id,
        "runzeroID": asset.organization_id
      };
      await this.uploadOrgTo4me(input);
      } */
    }
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
          //console.log(input); // to remove
          const mutationResult = await this.uploadSWTo4me(input);

          if (mutationResult.errors == 1) {
            errors.push(mutationResult.errors);
          } else if (mutationResult.errors) {
            errors.push(...this.mapErrors(mutationResult.errors));
          }
          result.uploadCount = mutationResult.uploadCount;
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
    return result;
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
          const extendedData = await this.addExtendedData(assetsToProcess);
          const referenceData = await this.referenceHelper.lookup4meReferences(assetsToProcess);
          const discoveryHelper = new DiscoveryMutationHelper(referenceData, generateLabels, this.SitesReferences, this.SoftwareReferences);
          const input = discoveryHelper.toDiscoveryUploadInput(assetsToProcess);
          //console.log(input.products); // to remove
          const mutationResult = await this.uploadTo4me(input);
          //console.log(JSON.stringify(mutationResult, null, 4)); // to remove
          for (let i of assetsToProcess) {
            await this.uploadRelationTo4me( this.SitesReferences,{
              "label": i.names[0] + " (runzero)",
              "siteId": i.site_name
            });
          }
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

  async CISearch(ci, label) {
    let result = { "existing": false, "id": 0 };
    let ciReturn = (this.storedConfigItems.length > 0) ? this.storedConfigItems.find(e => e.name == ci) : false;
    if (!ciReturn) {
      //console.log(JSON.stringify(ci, null, 4)); // to remove
      const accessToken = await this.customer4meHelper.getToken();
      const fieldname = label ? 'label' : "name";
      ciReturn = await this.customer4meHelper.RestAPIGet('CI Search',
        accessToken,
        `cis?${fieldname}=${ci}&fields=id`,
      );
      if (ciReturn.length > 0) {
        result.id = ciReturn[0].nodeID;
        result.existing = true;
        this.storedConfigItems.push({ "name": ci, "id": result.id });
      }
    } else {
      result.existing = true;
      result.id = ciReturn.id
    }
    return result;
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
    //console.log(JSON.stringify(input, null, 4)); // to remove
    const errors = [];
    let success = 0;
    //let results = { uploadCount: success, errors: errors };
    const catQuery = `query {
      productCategories(first: 100,filter: {ruleSet: {values: [software]},
    references: ["${input[0].sourceID}"]}){ nodes { id } }
    }`;
    const accessToken = await this.customer4meHelper.getToken();
    const categories = await this.customer4meHelper.executeGraphQLMutation('category Query',
      accessToken,
      catQuery);
    const catID = categories.nodes[0].id;
    const catName = input[0].sourceID;
    if (!this.defaultTeamId) {
      const teams = await this.customer4meHelper.RestAPIGet('Teams Query',
        accessToken,
        'teams?name=Service Desk',
      );
      this.defaultTeamId = teams[0].id;
    }
    //console.log(this.defaultTeamId); // to remove
    //console.log(`First: ${input[0].sourceID}`); // to remove
    if (this.storedProducts.length == 0) {
       const osproducts = await this.customer4meHelper.RestAPIGet('Get OS Products',
                                                           accessToken,
                                                           `products?category=software/operating_system_software&per_page=100`,
      );
      //console.log(JSON.stringify(osproducts, null, 4)); // to remove
      for (const e of osproducts) {
         this.storedProducts.push(e);
      }
      const products = await this.customer4meHelper.RestAPIGet('Get Other Products',
                                                           accessToken,
                                                           `products?category=software/other_type_of_software&per_page=100`,
      );
      //console.log(JSON.stringify(products, null, 4)); // to remove
      for (const e of products) {
         this.storedProducts.push(e);
      }
     }
    //console.log(JSON.stringify(this.storedProducts, null, 4)); // to remove
    /* const products = await this.customer4meHelper.RestAPIGet('Get Products',
      accessToken,
      `products?category=${input[0].sourceID}&per_page=100`,
    ); */
    //console.log(products); // to remove
    for (let i of input) {
      //console.log(JSON.stringify(i, null, 4)); // to remove
      //console.log(`Prod: ${products.data.find(e => e.name === i.name).nodeID}`); // to remove
      const thisProduct = {
        "name": i.name, "brand": i.brand, "category": catName,
        "sourceID": "runZero", "product_category_id": catID, "support_team": this.defaultTeamId
      };
      let productid;
      //console.log(i.name.trim()); // to remove
      //console.log(this.storedProducts[0].name); // to remove
      if (this.storedProducts.filter(e => e.name === i.name.trim()).length == 0) {
        const result = await this.customer4meHelper.RestAPIProductsPost('create product',
          accessToken,
          'products',
          thisProduct);
        if (result.error) {
          console.error('Error uploading Software Product:\n%j', result.error);
          errors.push(`Unable to upload Software Products to 4me - ${result.error}`);
        } else {
          productid = result.data.nodeID;
          this.storedProducts.push(result.data);
        }
      } else {
        productid = this.storedProducts.find(e => e.name === i.name).nodeID
      }  
      for (let ci of i.configurationItems) {
        ci.productId = productid;
        ci.name = ci.name.trim();
        let mutationType = "ConfigurationItemCreateInput";
        let mutationAction = "configurationItemCreate";

        const ciReturn = await this.CISearch(ci.name, false);
        //console.log(ciReturn.existing); //to remove
        //console.log(ciReturn.id); //to remove
        if (ciReturn.existing) {
          ci.id = ciReturn.id;
          delete ci.name;
          mutationType = "ConfigurationItemUpdateInput";
          mutationAction = "configurationItemUpdate";
        }
       
        //console.log(ciReturn.data); // to remove
        //console.log(ciReturn.data.length); // to remove
       
        const ciMutation = `mutation($input: ${mutationType}!) {
          ${mutationAction}(input: $input) {
            errors { path message }
          }
        }`
        //console.log(JSON.stringify(ciMutation, null, 4)); // to remove
        const ciResult = await this.customer4meHelper.executeGraphQLMutation('Upload CIs',
          accessToken,
          ciMutation,
          { input: ci });
        if (ciResult.error) {
          console.error('Error uploading Software:\n%j', ciResult);
          errors.push(`Unable to upload Software to 4me - ${ciResult.error}`);
        } else {
          success++;
        }
      }
    }
    //console.log(success); // to remove
    return { uploadCount: success, errors: errors };
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
      console.error('Error uploading site:\n%j', result);
      throw new LoggedError('Unable to upload Site to 4me');
    } else {
      return result;
    }
  }

  async uploadOrgTo4me(input) {
    const accessToken = await this.customer4meHelper.getToken();
    const existingCheck = await this.customer4meHelper.executeGraphQLMutation('Find Organisation',
      accessToken,
      `query {
      organizations(first:1, filter: {name: {values: ["${input.name}"]}}) {nodes { name id }}
      }`);
    if (existingCheck.nodes.length > 0) {
      this.storedOrgs.push({ "name": input.name, "id": existingCheck.nodes[0].id, "runZeroID": input.runzeroID })
    } else {
      const upload = {"name": input.name, "remarks": input.remarks}
      const query = `
      mutation($input: OrganizationCreateInput!) {
        organizationCreate(input: $input) {
          errors { path message }
        }
      }`;
      const result = await this.customer4meHelper.executeGraphQLMutation('discovered sites',
        accessToken,
        query,
        { input: upload });
      if (result.error) {
        console.error('Error uploading Org:\n%j', result);
        throw new LoggedError('Unable to upload Orgs to 4me');
      }
    }
  }

  async uploadRelationTo4me(siterefs, input) {
    const ciReturn = await this.CISearch(input.label, true);
    //console.log(ciReturn.existing); //to remove
    //console.log(ciReturn.id); //to remove
    if (ciReturn.existing) {
      input.id = ciReturn.id;
      delete input.label;
      input.siteId = siterefs.find(e => e.name == input.siteId).id;
      const query = `
        mutation($input: ConfigurationItemUpdateInput!) {
          configurationItemUpdate(input: $input) {
            errors { path message }
          }
        }`;
      const accessToken = await this.customer4meHelper.getToken();
      const result = await this.customer4meHelper.executeGraphQLMutation('CI Relations',
        accessToken,
        query,
        { input: input });
      if (result.error) {
        console.error('Error uploading CI Relations:\n%j', result);
        throw new LoggedError('Unable to uploadCI Relations to 4me');
      }
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
