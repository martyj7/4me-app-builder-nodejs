'use strict';

const LoggedError = require('../../../../library/helpers/errors/logged_error');

class runzeroAPIError extends LoggedError {
  constructor(message) {
    super(message);
  }
}

module.exports = runzeroAPIError;