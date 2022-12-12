'use strict';

const LoggedError = require('../../../../library/helpers/errors/logged_error');

class runzeroGraphQLError extends LoggedError {
  constructor(message) {
    super(message);
  }
}

module.exports = runzeroGraphQLError;