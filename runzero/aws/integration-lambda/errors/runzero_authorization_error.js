'use strict';

const LoggedError = require('../../../../library/helpers/errors/logged_error');

class runzeroAuthorizationError extends LoggedError {
  constructor(message) {
    super(message);
  }
}

module.exports = runzeroAuthorizationError;