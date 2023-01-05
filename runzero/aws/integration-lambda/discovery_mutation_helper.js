'use strict';

const runzeroHelper = require('./runzero_helper');
const TimeHelper = require('../../../library/helpers/time_helper');
const LoggedError = require('../../../library/helpers/errors/logged_error');
const Js4meHelper = require('../../../library/helpers/js_4me_helper');

class DiscoveryMutationHelper {
  constructor(referenceData, generateLabels, SitesReferences, softwareRefs) {
    this.referenceData = referenceData;
    this.generateLabels = generateLabels;
    this.runzeroHelper = new runzeroHelper();
    this.timeHelper = new TimeHelper();
    this.categories = [];
    this.siterefs = SitesReferences;
    this.softwareAssetIDs = softwareRefs;
    this.OSSoftware = [];
    this.OSProduct = {};
  }

  toDiscoveryUploadInput(assets) {
    //console.log(assets); // to remove
    //console.log(this.referenceData.softwareCis); // to remove
    assets.forEach(a => this.addCi(a));
    return {
      source: 'runZero',
      alternativeSources: 'runZero',
      referenceStrategies: {
        ciUserIds: {strategy: 'APPEND'},
      },
      physicalAssets: this.categories,
    };
  }

   toDiscoverySWUploadInput(assets) {
    //console.log(assets); // to remove
    assets.forEach(a => this.addSWCi(a));
    return this.categories[0].products
  }

  async addCi(asset) {
    //console.log(asset); // to remove
    const key = asset.id;
    try {
      const mappedProduct = this.mapProduct(asset);
      //console.log(mappedProduct); // to remove
      const ci = await this.createCi(asset, mappedProduct);
      //console.log(ci)
      mappedProduct.configurationItems.push(ci);
    } catch (e) {
      console.error(`Error processing: ${key}`);
      throw new LoggedError(e);
    }
  }

  addSWCi(asset) {
    //console.log(asset); // to remove
    const key = asset.software_id;
    try {
      const mappedProduct = this.mapSWProduct(asset);
      //console.log(mappedProduct); // to remove
      const ci = this.createSoftwareCi(asset, mappedProduct);
      if (mappedProduct.configurationItems.filter(e => e.name === ci.name).length == 0) {
        //console.log(`Push to CI collection: ${ci.name}`); // to remove
        mappedProduct.configurationItems.push(ci);
      }
    } catch (e) {
      console.error(`Error processing: ${key}`);
      throw new LoggedError(e);
    }
  }

  createSoftwareCi(asset, product) {
    //console.log(`CI Software Create: ${asset} - ${product}`) //to remove
    const ci = {
      sourceID: 'runZero',
      systemID: product.name,
      status: 'in_production'
    };
    if (asset.os_version) {
      asset.software_version = asset.os_version;
    }
    ci.name = product.name + ' ' + asset.software_version;
    ci.name = ci.name.trim()
    //console.log(ci); //to remove
    return ci;
  }

  async createCi(asset, product) {
    //console.log(`CI Create: ${JSON.stringify(asset, null, 4)} - ${JSON.stringify(product, null, 4)}`) //to remove
    const ci = {
      sourceID: asset.id,
      systemID: asset.id,
      status: 'in_production'
    };

    const runzeroName = asset.names[0] + " (NEW)";
    if (this.generateLabels) {
      ci.name = product.name;
      ci.label = runzeroName;
    } else {
      ci.name = runzeroName;
    }

    const userNodeID = this.mapUser("runZero User");
    if (userNodeID) {
      ci.userIds = [userNodeID];
    }
    if (this.softwareAssetIDs.filter(e => e.software_asset_id === asset.id).length > 0) {
      const softwareIDs = this.mapSoftware(this.referenceData.softwareCis, asset.id);
      if (softwareIDs.length > 0) {
         if (ci.ciRelations) {
          ci.ciRelations.childIds = ci.ciRelations.childIds.concat([softwareIDs])
        } else {
          ci.ciRelations = { childIds: softwareIDs }
        }
      }
    }
    if (asset.os) {
      let sysID = `${asset.os} ${asset.os_version}`;
      if (!asset.os_version) {
        sysID = asset.os;
      }
      const softwareIDs = this.mapOSSoftware(this.referenceData.softwareCis, sysID);
      if (softwareIDs.length > 0) {
        if (ci.ciRelations) {
          ci.ciRelations.childIds = ci.ciRelations.childIds.concat(softwareIDs)
        } else {
          ci.ciRelations = { childIds: softwareIDs }
        }
      }
    }
    if (asset.site_name) {
      ci.location = asset.site_name;
    } 
    //console.log(ci.ciRelations); // to remove
    //console.log(ci); //to remove
    return ci;
  }

  mapUser(userName) {
    const name = userName && userName.toLowerCase();
    return this.referenceData.users.get(name);
  }

  mapSoftware(softwareCis, asset) {
    var result = [];
    //console.log(JSON.stringify(softwareCis, null, 4)); // to remove
    //console.log(asset); // to remove
    this.softwareAssetIDs.forEach(function (o) {
      if (o.software_asset_id === asset) {
        let thisName = `${o.software_vendor} ${o.software_product} ${o.software_version}`;
        let match = softwareCis.find(e => e.name == thisName);
        if (match) {
          result.push(match.id)
        }
      }
    });
    return result;

  }

  mapOSSoftware(softwareCis, asset) {
    var result = [];
    //console.log(JSON.stringify(softwareCis, null, 4)); // to remove
    let match = softwareCis.find(e => e.name == asset);
    if (match) {
      result.push(match.id)
    }
    return result;
  }

   mapSoftwareIds(softwares) {
    return this.mapSoftwareName(softwares.map(s => s.name));
  }

   mapSoftwareName(softwareNames) {
    return softwareNames
      .map(n => this.referenceData.softwareCis.get(n))
      .filter(id => !!id);
  }

  mapSite(siteName) {
    let site = [];
    try {
      siteMatch = this.siterefs.find(o => o.name === siteName);
      site.push(siteMatch.id);
    } catch (e) {
      console.error(`Error finding Asset Site match: ${siteName}`);
      //hrow new LoggedError(e);
    }
    //console.log(siteMatch); // to remove
    return site;
  }

  mapProduct(asset) {
      const product = this.runzeroHelper.getProduct(asset);
      if (!product.mapped) {
        product.mapped = {
          meta: { strategy: 'CREATE' },
          sourceID: product.reference,
          name: product.name,
          brand: product.brand,
          model: product.model,
          productID: product.sku,
          configurationItems: [],
        };
        const category = this.mapCategory(asset);
        this.addProduct(category, product.mapped);
      }
    return product.mapped;
  }

  mapSWProduct(asset) {
    const product = this.runzeroHelper.getProduct(asset);
    if (!product.mapped) {
      product.mapped = {
        meta: { strategy: 'CREATE' },
        sourceID: product.reference,
        name: product.name,
        brand: product.brand,
        configurationItems: [],
      };
      const category = this.mapCategory(asset);
      this.addProduct(category, product.mapped);
    }
    return product.mapped;
  }

   mapCategory(asset) {
    const category = this.runzeroHelper.getProductCategory(asset);
    if (!category.mapped) {
      category.mapped = {
        meta: {strategy: 'CREATE'},
        reference: category.reference,
        name: category.name,
        products: [],
      };
        this.categories.push(category.mapped);
    }
    return category.mapped;
  }

  addProduct(category, product) {
    if (category.products.indexOf(product) === -1) {
      category.products.push(product);
    }
  }

  siteSource(site) {
    return `runzero-${site}`.substring(0, Js4meHelper.MAX_SOURCE_LENGTH);
  }
}

module.exports = DiscoveryMutationHelper;