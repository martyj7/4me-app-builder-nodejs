'use strict';

const runzeroHelper = require('./runzero_helper');
const TimeHelper = require('../../../library/helpers/time_helper');
const LoggedError = require('../../../library/helpers/errors/logged_error');
const Js4meHelper = require('../../../library/helpers/js_4me_helper');

class DiscoveryMutationHelper {
  constructor(referenceData, generateLabels, SitesReferences) {
    this.referenceData = referenceData;
    this.generateLabels = generateLabels;
    this.runzeroHelper = new runzeroHelper();
    this.timeHelper = new TimeHelper();
    this.categories = [];
    this.siterefs = SitesReferences;
  }

  toDiscoveryUploadInput(assets) {
    //console.log(assets); // to remove
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

  addCi(asset) {
    console.log(asset); // to remove
    const key = (asset.id) ? asset.id : asset.software_id;
    try {
      const mappedProduct = this.mapProduct(asset);
      console.log(mappedProduct); // to remove
      const ci = (asset.id) ? this.createCi(asset, mappedProduct) : this.createSoftwareCi(asset, mappedProduct);
      console.log(ci)
      mappedProduct.configurationItems.push(ci);
    } catch (e) {
      console.error(`Error processing: ${key}`);
      throw new LoggedError(e);
    }
  }

  createSoftwareCi(asset, product) {
    console.log(`CI Software Create: ${asset} - ${product}`) //to remove
    const ci = {
      sourceID: asset.software_id,
      systemID: asset.software_id,
      status: 'in_production'
    };
    ci.name = product.name + " " + asset.software_version;
    console.log(ci); //to remove
    return ci;
  }

  createCi(asset, product) {
    console.log(`CI Create: ${asset} - ${product}`) //to remove
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

   /*  if (asset.site_name) {
      const siteID = this.mapSite(asset.site_name);
      if (siteID) {
        ci.siteId = siteID;
      }
    } */
    /*
    if (asset.softwares) {
      const softwareIDs = this.mapSoftware(asset.softwares);
      if (softwareIDs.length > 0) {
        ci.ciRelations = {childIds: softwareIDs};
      }
    }*/
    /*
    if (asset.os) {
      const softwareIDs = asset.os;
        if (ci.ciRelations) {
          ci.ciRelations.childIds = ci.ciRelations.childIds.concat([softwareIDs])
        } else {
          ci.ciRelations = {childIds: softwareIDs}
        }
    }*/
    console.log(ci); //to remove
    return ci;
  }

  mapUser(userName) {
    const name = userName && userName.toLowerCase();
    return this.referenceData.users.get(name);
  }

  mapSoftware(softwares) {
    return this.mapSoftwareName(softwares.map(s => s.name));
  }

  mapSite(siteName) {
    let siteMatch;
    try {
      siteMatch =  this.siterefs.find(o => o.name === siteName).id;
    } catch (e) {
      console.error(`Error finding Asset Site match: ${siteName}`);
      throw new LoggedError(e);
    }
    //console.log(siteMatch); // to remove
    return siteMatch
  }

  mapSoftwareName(softwareNames) {
    return softwareNames
      .map(n => this.runzeroHelper.cleanupName(n))
      .map(n => this.referenceData.softwareCis.get(n))
      .filter(id => !!id);
  }

  mapProduct(asset) {
    const product = this.runzeroHelper.getProduct(asset);
    if (!product.mapped) {
      product.mapped = {
        meta: {strategy: 'CREATE'},
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