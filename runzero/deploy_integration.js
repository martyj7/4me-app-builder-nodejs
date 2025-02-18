'use strict';

const AwsConfigHelper = require('../library/helpers/aws_config_helper');
const CliInputHelper = require('../library/helpers/cli_input_helper');
const ConfigFileHelper = require('../library/helpers/config_file_helper');
const Js4meDeployHelper = require('../library/helpers/js_4me_deploy_helper');

const path = require('path')
const source = '4me-integration-runzero';
const stackName = 'app-builder-runzero';

class DeployIntegration {
  constructor(stackName) {
    this.stackName = stackName;
    this.js4meDeployHelper = new Js4meDeployHelper();
    this.cliInputHelper = new CliInputHelper(__dirname);
    this.configFileHelper = new ConfigFileHelper(__dirname, 'config', '4me');
  }

  async gatherInput() {
    return this.cliInputHelper.gatherInput({
                                             domain: {'Which 4me domain': {default: '4me-demo.com'}},
                                             account: {'Which 4me account': {default: 'wdc'}},
                                             serviceInstanceName: {'Which service instance': {default: 'Mainframe 1'}},
                                             profile: {'Which AWS profile': {default: 'staging'}},
                                           });
  }

  readFromFile(filename) {
    return this.configFileHelper.readConfigJsonFile(`${filename}.json`);
  }

  async logInto4meUsingAwsClientConfig(clientConfig, domain, account) {
    const {helper, accessToken} = await this.js4meDeployHelper.logInto4meUsingAwsClientConfig(clientConfig,
                                                                                              domain,
                                                                                              account);
    this.js4meHelper = helper;
    this.accessToken = accessToken;
  }

  async logInto4me(domain, account, clientID, token) {
    const {helper, accessToken} = await this.js4meDeployHelper.logInto4me(domain,
                                                                          account,
                                                                          clientID,
                                                                          token);
    this.js4meHelper = helper;
    this.accessToken = accessToken;
  }

  async findLambdaProduct() {
    return await this.js4meDeployHelper.findDefaultLambdaProduct(this.js4meHelper, this.accessToken);
  }

   async findSqsProduct() {
    return await this.js4meDeployHelper.findDefaultSqsProduct(this.js4meHelper, this.accessToken);
  }

  async syncConfigurationItem(filename, extraProps) {
    const {input, filter} = this.readUpsertData(filename, extraProps);
    return await this.js4meDeployHelper.syncConfigurationItem(this.js4meHelper,
                                                              this.accessToken,
                                                              filter,
                                                              input);
  }

  readUpsertData(filename, extraProps) {
    const input = this.readFromFile(filename);
    return this.js4meDeployHelper.upsertOnSourceIDData(input, source, filename, extraProps);
  }

  async deployLambda(clientConfig, profile, domain, account) {
    const samPath = path.resolve(__dirname, 'aws');
    const offeringReference = this.getOfferingInput().reference;
    const result = await this.js4meDeployHelper.deployLambdaWithBootstrapSecrets(clientConfig,
                                                                                 profile,
                                                                                 samPath,
                                                                                 this.stackName,
                                                                                 domain,
                                                                                 account,
                                                                                 offeringReference);
    result.refreshQueueArn = result.stacksOutput['RefreshQueueArn'];
    result.deadLetterQueueArn = result.stacksOutput['DeadLetterQueueArn'];
    return result;
  }

  async findS3BucketConfigurationItem(s3Bucket) {
    return await this.js4meDeployHelper.findS3BucketConfigurationItem(s3Bucket, this.js4meHelper, this.accessToken);
  }

  async findServiceInstance(serviceInstanceName) {
    const serviceInstanceFilter = {name: {values: [serviceInstanceName]}};
    return await this.js4meDeployHelper.findServiceInstance(this.js4meHelper,
                                                            this.accessToken,
                                                            serviceInstanceFilter);
  }

  getOfferingInput() {
    const {input} = this.readUpsertData('app_offering_input', {});
    return input;
  }

  async createOffering(serviceInstance, avatar) {
    const offeringInput = this.getOfferingInput();
    offeringInput.serviceInstanceId = serviceInstance.id;

    return await this.js4meDeployHelper.upsertOffering(this.js4meHelper,
                                                       this.accessToken,
                                                       offeringInput,
                                                       avatar);
  }

  async createUiExtension(offering) {
    const filename = 'ui_extension_input';
    const uiExtensionInput = this.configFileHelper.readUiExtensionFromFiles(filename);
    const {input} = this.js4meDeployHelper.upsertOnSourceIDData(uiExtensionInput, source, filename, {});

    return await this.js4meDeployHelper.syncUiExtensionVersion(this.js4meHelper,
                                                               this.accessToken,
                                                               offering,
                                                               input);
  }

  async update4me(s3Bucket,
                  serviceInstanceName,
                  region,
                  lambdaArn,
                  lambdaUrl,
                  refreshQueueArn,
                  deadLetterQueueArn,
                  account,
                  domain) {
    const lambdaProduct = await this.findLambdaProduct();

    // make sure S3 bucket CI is present in 4me
    await this.findS3BucketConfigurationItem(s3Bucket);

    const serviceInstance = await this.findServiceInstance(serviceInstanceName);

    const location = `Amazon ${region}`;
    await this.syncConfigurationItem('runzero_lambda_ci',
                                                  {
                                                    productId: lambdaProduct.id,
                                                    serviceId: serviceInstance.service.id,
                                                    serviceInstanceIds: [serviceInstance.id],
                                                    location: location,
                                                    systemID: lambdaArn,
                                                    customFields: [
                                                      {
                                                        id: 'cloudformation_stack',
                                                        value: stackName,
                                                      },
                                                      {
                                                        id: 'api_url',
                                                        value: lambdaUrl,
                                                      },
                                                    ],
                                                  });

    const sqsProduct = await this.findSqsProduct();
    await this.syncConfigurationItem('runzero_dead_letter_sqs_ci',
                                     {
                                       productId: sqsProduct.id,
                                       serviceId: serviceInstance.service.id,
                                       serviceInstanceIds: [serviceInstance.id],
                                       location: location,
                                       systemID: deadLetterQueueArn,
                                       customFields: [
                                         {
                                           id: 'cloudformation_stack',
                                           value: stackName,
                                         },
                                       ],
                                     });
    await this.syncConfigurationItem('runzero_sqs_ci',
                                                  {
                                                    productId: sqsProduct.id,
                                                    serviceId: serviceInstance.service.id,
                                                    serviceInstanceIds: [serviceInstance.id],
                                                    location: location,
                                                    systemID: refreshQueueArn,
                                                    customFields: [
                                                      {
                                                        id: 'cloudformation_stack',
                                                        value: stackName,
                                                      },
                                                    ],
                                                  });

    const avatar = this.readAvatar();
    const offering = await this.createOffering(serviceInstance, avatar);
    await this.createUiExtension(offering);

    console.log(`Success. App Offering is available at: https://${account}.${domain}/app_offerings/${offering.id}`);

    return offering;
  }

  readAvatar() {
    const filename = "runzero-logo.svg";

    return this.configFileHelper.readAvatar(filename);
  }
}
module.exports = DeployIntegration;

(async () => {
  if (require.main !== module) {
    return;
  }

  const deployIntegration = new DeployIntegration(stackName);
  const {domain, account, serviceInstanceName, profile} = await deployIntegration.gatherInput();

  const clientConfig = await new AwsConfigHelper(profile).getClientConfig();
  await deployIntegration.logInto4meUsingAwsClientConfig(clientConfig, domain, account);

  const {lambdaUrl, lambdaArn, s3Bucket, refreshQueueArn, deadLetterQueueArn} = await deployIntegration.deployLambda(clientConfig,
                                                                                                 profile,
                                                                                                 domain,
                                                                                                 account);
  await deployIntegration.update4me(s3Bucket,
                                    serviceInstanceName,
                                    clientConfig.region,
                                    lambdaArn,
                                    lambdaUrl,
                                    refreshQueueArn,
                                    deadLetterQueueArn,
                                    account,
                                    domain);
})();
