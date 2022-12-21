'use strict';

const runzeroHelper = require('./runzero_helper');
const TimeHelper = require('../../../library/helpers/time_helper');
const LoggedError = require('../../../library/helpers/errors/logged_error');
const Js4meHelper = require('../../../library/helpers/js_4me_helper');

class DiscoveryMutationHelper {
  constructor(referenceData, generateLabels, installations) {
    this.referenceData = referenceData;
    this.generateLabels = generateLabels;
    this.installations = installations;
    this.runzeroHelper = new runzeroHelper();
    this.timeHelper = new TimeHelper();
    this.categories = [];
  }

  toDiscoveryUploadInput(installationName, assets) {
    assets.forEach(a => this.addCi(a));

    const otherSources = this.installations.filter(i => i !== installationName).map(this.sourceForInstallation);
    return {
      source: this.sourceForInstallation(installationName),
      alternativeSources: otherSources.concat('runzero'),
      referenceStrategies: {
        ciUserIds: {strategy: 'APPEND'},
      },
      physicalAssets: this.categories,
    };
  }

  addCi(asset) {
    const key = asset.id;
    try {
      const mappedProduct = this.mapProduct(asset);
      const ci = this.createCi(asset, mappedProduct);
      mappedProduct.configurationItems.push(ci);
    } catch (e) {
      console.error(`Error processing: ${key}`);
      throw new LoggedError(e);
    }
  }

  createCi(asset, product) {
    const ci = {
      sourceID: asset.site_name,
      systemID: asset.id,
      status: 'in_production'
    };

    const runzeroName = asset.names[0];
    if (this.generateLabels) {
      ci.name = product.name;
      ci.label = runzeroName;
    } else {
      ci.name = runzeroName;
    }

    /* if (asset.allUsers) {
      const nodeIDs = asset.allUsers.map(u => this.mapUser(u)).filter(n => !!n);
      if (nodeIDs.length > 0) {
        ci.userIds = nodeIDs;
      }
    } else if (asset.assetBasicInfo.userName) {
      const userNodeID = this.mapUser(asset.assetBasicInfo.userName);
      if (userNodeID) {
        ci.userIds = [userNodeID];
      }
    }
    if (asset.softwares) {
      const softwareIDs = this.mapSoftware(asset.softwares);
      if (softwareIDs.length > 0) {
        ci.ciRelations = {childIds: softwareIDs};
      }
    }*/
    if (asset.os) {
      const softwareIDs = asset.os;
        if (ci.ciRelations) {
          ci.ciRelations.childIds = ci.ciRelations.childIds.concat(softwareIDs)
        } else {
          ci.ciRelations = {childIds: softwareIDs}
        }
    }
    return ci;
  }
  
  mapUser(userName) {
    const name = userName && userName.toLowerCase();
    return this.referenceData.users.get(name);
  }

  mapSoftware(softwares) {
    return this.mapSoftwareName(softwares.map(s => s.name));
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

  sourceForInstallation(installation) {
    return `runzero-${installation}`.substring(0, Js4meHelper.MAX_SOURCE_LENGTH);
  }
}

module.exports = DiscoveryMutationHelper;