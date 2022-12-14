const InstanceHelper = require('./instance_helper');
const crypto = require('crypto');
const runzeroIntegration = require('./runzero_integration');
const runzeroAuthorizationError = require('./errors/runzero_authorization_error');
const Js4meAuthorizationError = require('../../../library/helpers/errors/js_4me_authorization_error');

async function findConfigurationItem(js4meHelper, accessToken, arn) {
  const filter = {systemID: {values: [arn]}};
  const result = await js4meHelper.getRESTQuery('Configuration item',
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

async function getLambdaUrl(provider4meHelper, accessToken, lambdaArn) {
  const lambdaCi = await findConfigurationItem(provider4meHelper, accessToken, lambdaArn);
  if (lambdaCi.error) {
    return lambdaCi;
  }
  const apiUrlField = lambdaCi.customFields.find(f => f.id === 'api_url');
  if (!apiUrlField) {
    return {error: 'No api_url found'};
  }
  const lambdaUrl = apiUrlField.value;
  if (!lambdaUrl) {
    return {error: 'No api_url value found'};
  }
  return lambdaUrl;
}

async function getInvalidCurrentAuthorizationInput(customerContext, clientID) {
  try {
    const clientSecret = customerContext.secrets.secrets.client_secret;
    const refreshToken = customerContext.secrets.refresh_token;

    const integration = new runzeroIntegration(clientID, clientSecret, refreshToken, customerContext.js4meHelper);
    const valid = await integration.validateCredentials();
    return {suspended: !valid};
  } catch (error) {
    if (error instanceof runzeroAuthorizationError) {
      // runZero credentials not OK, act as if we did not have them already: suspend instance and await auth
      return {suspended: true};
    } else if (error instanceof Js4meAuthorizationError) {
      // unable to access customer account
      return {
        suspended: true,
        suspensionComment: `Unable to connect to customer account. Please rotate the token and unsuspend.`,
      }
    } else {
      console.error(`Unable to verify credentials: ${error}`);
      // unable to verify credentials, assume they are still valid. They will be checked on next sync.
      return {suspended: false};
    }
  }
}

async function getPendingAuthorizationInput(lambdaArn, provider4meHelper, accessToken, customerAccount, callbackSecret) {
  // determine public URL of lambda for the callback URI
  const lambdaUrl = await getLambdaUrl(provider4meHelper, accessToken, lambdaArn);
  if (lambdaUrl.error) {
    return lambdaUrl;
  }

  return {
    suspended: true,
    suspensionComment: 'Awaiting authorization from runZero',
    customFields: [
      {
        id: 'callback_url',
        value: `${lambdaUrl}${customerAccount}/${callbackSecret}`,
      },
      {
        id: 'connection_status',
        value: 'pending_authorization',
      }
    ]
  }
}

async function generateCustomerSecret(options) {
  const customerContext = options.lambda4meContext.customerContext;

  const callbackSecret = crypto.randomBytes(16).toString('hex');
  // store generated secret so we can verify callback
  const secretsHelper = customerContext.secretsHelper;
  const secretsAccountKey = customerContext.secretsAccountKey;
  return await secretsHelper.updateSecrets(secretsAccountKey, {callback_secret: callbackSecret});
}

/* async function handleInstallationChanged(handler, data, options) {
  let callbackSecret;
  const secrets = options.lambda4meContext.customerContext.secrets;
  if (secrets.callback_secret) {
    console.log('runZero callback URI already set');
    callbackSecret = secrets.callback_secret;
  } else {
    const awsResult = await generateCustomerSecret(options);
    callbackSecret = awsResult.secrets.callback_secret;
    if (!callbackSecret) {
      return {error: 'Unable to store runZero callback secret'};
    }
  }
  const createResult = await updaterunzeroCallbackURL(callbackSecret, options);
  if (createResult.error) {
    console.error('unable to update runZero callback URL\n%j', createResult.error);

    return handler.unknownError('Unable to update runZero callback URL');
  }

  return handler.respondWith('OK');
} */
