'use strict';

// Lambda@Edge does not support env variables.
// This is used for local execution.
require('dotenv').config();

const front = require('./lib/static-front-auth');

console.log(
  Object.assign({
      Ver: require('./version'),
    },
    process.env.AWS_LAMBDA_FUNCTION_NAME == null ? {} : {
      Env: Object.keys(process.env).sort().map(e => e + '=' + process.env[e]),
    }));

const routes = [{
    path: new RegExp('^/signout'),
    handler: front.signOutHandler,
  },
  {
    path: new RegExp('^/signin'),
    handler: front.signInHandler,
  },
  {
    path: new RegExp('^/'),
    handler: front.authHandler,
  }
];

exports.handler = (event, context, callback) => {
  front.dispatch(routes, event, context, callback);
};

