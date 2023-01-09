const Js4meInstallationHandler = require('../../../library/helpers/js_4me_installation_handler');
const InstanceHelper = require('./instance_helper');
const runzeroIntegration = require('./runzero_integration');
const runzeroAuthorizationError = require('./errors/runzero_authorization_error');
const Js4meAuthorizationError = require('../../../library/helpers/errors/js_4me_authorization_error');
const runzeroLambdaHandler = require('./runzero_lambda_handler');

async function findConfigurationItem(js4meHelper, accessToken, arn) {
  const filter = {systemID: {values: [arn]}};
  const result = await js4meHelper.getGraphQLQuery('Configuration item',
                                                   accessToken, `
       query($filter: ConfigurationItemFilter) {
         configurationItems(first: 1, filter: $filter ) {
           nodes { id customFields { id value } }
         }
       }`,
                                                   {
                                                     filter: filter,
                                                   });
  if (result.error) {
    console.error('%j', result);
    return result;
  } else {
    const nodes = result.configurationItems.nodes;
    if (!nodes || nodes.length === 0) {
      return {error: 'No lambda CI found'};
    }
    return nodes[0];
  }
}

async function updaterunzeroAuthStatus(options) {
  const provider4meHelper = options.lambda4meContext.providerContext.js4meHelper;
  const accessToken = await provider4meHelper.getToken();

  const customerContext = options.lambda4meContext.customerContext;
  const customerAccount = customerContext.account;
  const offeringReference = options.lambda4meContext.offeringReference;

  const instanceHelper = new InstanceHelper();
  let config = await instanceHelper.retrieveInstanceWithRetry(provider4meHelper,
                                                              accessToken,
                                                              offeringReference,
                                                              customerAccount);

  if (config.error) {
    console.log('Unable to query instance. Too quick after app offering installation?');
    return config;
  }
  //console.info(config); // to remove
  instanceInput = null;
  if (config.connectionStatus === 'success') {
    instanceInput = await getInvalidCurrentAuthorizationInput(customerContext, config);
    if (!instanceInput.suspended) {
      return config;
    }
  }
  instanceInput = await getPendingAuthorizationInput(customerContext, config);
  if (instanceInput.error) {
    return instanceInput;
  }
  // update customer app instance in 4me
  const updateCustomFields = await instanceHelper.updateAppInstance(provider4meHelper, accessToken, {id: config.instanceId, ...instanceInput});
  if (updateCustomFields.error) {
    console.error('Unable to set app instance custom fields %s:\n%j', instanceInput, updateCustomFields.error);
    return {error: 'Unable to set app instance custom fields'};
  }
  if (instanceInput.customFields[0].value == 'success') {
    const handler = new runzeroLambdaHandler(options, process.env.REFRESH_QUEUE_URL);
    const refreshToken = await handler.updateRefreshToken(customerContext, config);
    const results = await handler.sendRefreshMessage(customerAccount);
    //console.log(results) // to remove
  } 
  return updateCustomFields;
}

async function getPendingAuthorizationInput(customerContext, config) {
  try {
    let clientSecret = false;
    if (config.CredOption == 'export_token') {
      clientSecret = customerContext.secrets.secrets.export_secret;
    } else {
      clientSecret = customerContext.secrets.secrets.client_secret;
    }
    const integration = new runzeroIntegration(config.clientID, clientSecret, config.rzURL, config.orgName, config.CredOption, customerContext.js4meHelper);
    const valid = await integration.validateCredentials();
    return { suspended: !valid,
            customFields: [
              {
                id: 'connection_status',
                value: 'success',
              }
            ]
          };
  } catch (error) {
    if (error instanceof runzeroAuthorizationError) {
        // runzero credentials not OK, act as if we did not have them already: suspend instance and await auth
      return {
        suspended: false, // moded
        suspensionComment: `Unable to connect to runzero. Please check credentials.`,
      };
    } else if (error instanceof Js4meAuthorizationError) {
      // unable to access customer account
      return {
          suspended: false, // moded
          suspensionComment: `Unable to connect to customer account. Please rotate the token and unsuspend.`,
        };
    } else {
      console.error(`Unable to verify credentials: ${error}`);
      // unable to verify credentials, assume they are still valid. They will be checked on next sync.
      return { suspended: false };
    }
  }
}

async function getInvalidCurrentAuthorizationInput(customerContext, config) {
 try {
    let clientSecret = false;
    if (config.CredOption == 'export_token') {
      clientSecret = customerContext.secrets.secrets.export_secret;
    } else {
      clientSecret = customerContext.secrets.secrets.client_secret;
    }
    const integration = new runzeroIntegration(config.clientID, clientSecret, config.rzURL, config.orgName, config.CredOption, customerContext.js4meHelper);
    const valid = await integration.validateCredentials();
    return {suspended: !valid};
  } catch (error) {
    if (error instanceof runzeroAuthorizationError) {
      // runZero credentials not OK, act as if we did not have them already: suspend instance and await auth
      return {suspended: false}; // moded
    } else if (error instanceof Js4meAuthorizationError) {
      // unable to access customer account
      return {
        suspended: false, // moded
        suspensionComment: `Unable to connect to customer account. Please rotate the token and unsuspend.`,
      }
    } else {
      console.error(`Unable to verify credentials: ${error}`);
      // unable to verify credentials, assume they are still valid. They will be checked on next sync.
      return {suspended: false};
    }
  }
}

async function handleInstallationChanged(handler, data, options) {

  const createResult = await updaterunzeroAuthStatus(options);
  if (createResult.error) {
    console.error('unable to update runZero Auth Status\n%j', createResult.error);

    return handler.unknownError('Unable to update Auth Status');
  }

  return handler.respondWith('OK'); 
}

async function handleAny(event, context) {
  console.log('received:\n%j', event);
  const options = {
    applicationName: process.env.PARAM_BOOTSTRAP_APP,
    providerAccount: process.env.PARAM_BOOTSTRAP_ACCOUNT,
    env4me: process.env.PARAM_4ME_DOMAIN,
    offeringReference: process.env.PARAM_OFFERING_REFERENCE,
    refreshQueueUrl: process.env.REFRESH_QUEUE_URL,
  };
  if (event.source === 'aws.secretsmanager') {
    // no verification of message required, as event.source is set by AWS
    const handler = new Js4meInstallationHandler(handleInstallationChanged, options);
    return await handler.handle(event, context);
  }else {
    const handler = new runzeroLambdaHandler(options);
    if (event.source === 'aws.events') {
      return await handler.handleScheduledEvent(event, context);
    } else if (event.Records) {
      return await handler.handleSQSEvent(event, context);
    } else {
      return await handler.handleHTTPEvent(event, context);
    }
  }
}

exports.lambdaHandler = async (event, context) => {
  const resultEvent = await handleAny(event, context);

  if (resultEvent.statusCode !== 200 && resultEvent.statusCode !== 302) {
    console.error('%j', resultEvent);
  } else {
    console.info('%j', resultEvent);
  }
  return resultEvent;
};
