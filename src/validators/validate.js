const { validationResult } = require('express-validator');
const { ApiError } = require('../utils/ApiError.js');

const validate = (req, _, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }

  const extractedErrors = errors.array().reduce((acc, err) => {
    acc[err.path] = err.msg; // Set key as field name and value as error message
    return acc;
  }, {});

  // 422: Unprocessable Entity
  throw new ApiError(422, 'Received data is not valid', extractedErrors);
};

module.exports = { validate };
