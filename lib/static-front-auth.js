'use strict';

const config = require('config');
const aws = require('aws-sdk');
const cookie = require('cookie');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const url = require('url');
const qs = require('querystring');
const VError = require('verror');
const uuid = require('uuid/v4');
const buildUrl = require('build-url');

function verbose(f) {
  if (config.verbose) {
    return f();
  }
}

function badRequest(callback) {
  callback(null, {
    status: 400,
    statusDescription: 'Bad Request',
  });
}

exports.signOutHandler = async function(cf, context, callback) {
  const req = cf.request;
  const reqHeaders = req.headers || [];

  const signOut = () => callback(null, {
    status: 307,
    statusDescription: 'Temporary Redirect',
    headers: {
      'set-cookie': [{
        key: 'set-cookie',
        value: cookie.serialize(config.session.cookie_name, "", {
          httpOnly: true,
          maxAge: 0,
        }),
      }],
      location: [{
        key: 'Location',
        value: config.auth.signout_uri || '/',
      }],
    },
  });

  // get session
  const cookies = cookie.parse((reqHeaders.cookie && reqHeaders.cookie.map(e => e.value).join()) || '');
  const sessionId = cookies[config.session.cookie_name];

  if (!sessionId) {
    // ignore, sign-out quietly
    console.info('sessionId required');
    return signOut();
  }

  const dyn = new aws.DynamoDB.DocumentClient({
    region: config.session.store.region,
  });

  const session = await dyn.get({
      TableName: config.session.store.table,
      Key: {
        id: sessionId,
      },
    })
    .promise()
    .catch(err => {
      throw new VError(err, '*** Failed to dyn.get session');
    });

  if (!session.Item || session.Item.temp) {
    // ignore, sign-out quietly
    console.info('session(id=%s) not found or temporary session', sessionId);
    return signOut();
  }

  // remove session cookie
  await dyn.delete({
      TableName: config.session.store.table,
      Key: {
        id: sessionId,
      },
    })
    .promise()
    .catch(err => {
      console.error("*** Failed to delete session %s: %s", sessionId, err);
      // ignore
    });

  return signOut();
};

exports.signInHandler = async function(cf, context, callback) {
  const req = cf.request;
  const reqHeaders = req.headers || [];

  const cookies = cookie.parse((reqHeaders.cookie && reqHeaders.cookie.map(e => e.value).join()) || '');
  const tmpSessionId = cookies[config.session.cookie_name];

  const u = url.parse('https://dummy/?' + req.querystring || '', true);
  if (!u.query.code || !u.query.state || !tmpSessionId) {
    console.info('code/state/sessionId required');
    return badRequest(callback);
  }

  const dyn = new aws.DynamoDB.DocumentClient({
    region: config.session.store.region,
  });
  const tmpSession = await dyn.get({
      TableName: config.session.store.table,
      Key: {
        id: tmpSessionId,
      },
    })
    .promise()
    .catch(err => {
      throw new VError(err, '*** Failed to dyn.get tmpSession');
    });

  if (!tmpSession.Item) {
    console.info('session(id=%s) not found', tmpSessionId);
    return badRequest(callback);
  }

  if (tmpSession.Item.state != u.query.state) {
    console.info('session(id=%s) state does not match', tmpSessionId);
    return badRequest(callback);
  }

  // acquire access token with claim from token EP
  const idToken = await axios.post(
      buildUrl(config.cognito.base_url, {
        path: 'oauth2/token',
      }),
      qs.stringify({
        grant_type: 'authorization_code',
        scope: config.auth.scope,
        redirect_uri: config.auth.redirect_uri,
        code: u.query.code,
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(config.cognito.client_id + ':' + config.cognito.client_secret).toString('base64'),
        },
      })
    .then(body => jwt.decode(body.id_token))
    .catch(err => {
      throw new VError(err, '*** Failed to POST tokenEP: %s',
        err.response && err.response.data ? JSON.stringify(err.response.data) : '');
    });

  // TODO: validate authenticated user
  console.log('%o', idToken);

  // remove tmp session
  await dyn.delete({
      TableName: config.session.store.table,
      Key: {
        id: tmpSessionId,
      },
    })
    .promise()
    .catch(err => {
      console.error("*** Failed to delete tmpSession %s: %s", tmpSessionId, err);
      // ignore
    });

  // create new session
  const newSessionId = uuid();
  await dyn.put({
      TableName: config.session.store.table,
      Item: {
        id: newSessionId,
        expire: Math.floor(new Date().getTime() / 1000) + config.auth.session_max_age_sec,
      },
    })
    .promise()
    .catch(err => {
      throw new VError(err, '*** Failed to dyn.put newSession');
    });

  callback(null, {
    status: 307,
    statusDescription: 'Temporary Redirect',
    headers: {
      'set-cookie': [{
        key: 'set-cookie',
        value: cookie.serialize(config.session.cookie_name, newSessionId, {
          httpOnly: true,
          maxAge: config.auth.session_max_age_sec,
        }),
      }],
      location: [{
        key: 'Location',
        value: tmpSession.Item.backuri,
      }],
    },
  });
};

exports.authHandler = async function(cf, context, callback) {
  const req = cf.request;
  const reqHeaders = req.headers || [];

  const cookies = cookie.parse((reqHeaders.cookie && reqHeaders.cookie.map(e => e.value).join()) || '');
  const sessionId = cookies[config.session.cookie_name];

  const gotoSignIn = async () => {

    const state = uuid();
    const tmpSessionId = uuid();

    const dyn = new aws.DynamoDB.DocumentClient({
      region: config.session.store.region,
    });

    await dyn.put({
        TableName: config.session.store.table,
        Item: {
          id: tmpSessionId,
          temp: true,
          state: state,
          backuri: req.uri,
          expire: Math.floor(new Date().getTime() / 1000) + config.auth.tmp_session_max_age_sec,
        },
      })
      .promise()
      .catch(err => {
        throw new VError(err, '*** Failed to dyn.put tmpSession');
      });

    callback(null, {
      status: 307,
      statusDescription: 'Temporary Redirect',
      headers: {
        'set-cookie': [{
          key: 'set-cookie',
          value: cookie.serialize(config.session.cookie_name, tmpSessionId, {
            httpOnly: true,
            maxAge: config.auth.tmp_session_max_age_sec,
            path: config.session.cookie_path || '/',
          }),
        }],
        location: [{
          key: 'Location',
          value: buildUrl(config.cognito.base_url, {
            path: 'login',
            queryParams: {
              response_type: 'code',
              state: state,
              client_id: config.cognito.client_id,
              redirect_uri: config.auth.redirect_uri,
            },
          }),
        }],
      },
    });
  };

  if (!sessionId) {
    // redirect to login
    return gotoSignIn();
  } else {
    // validate session id
    const dyn = new aws.DynamoDB.DocumentClient({
      region: config.session.store.region,
    });
    const session = await dyn.get({
        TableName: config.session.store.table,
        Key: {
          id: sessionId,
        },
      })
      .promise()
      .catch(err => {
        throw new VError(err, '*** Failed to dyn.get session');
      });

    if (!session.Item || session.Item.temp) {
      // redirect to login
      console.info('session(id=%s) not found or temporary session', sessionId);
      return gotoSignIn();
    }

    callback(null, req);
  }
};

exports.dispatch = function(routes, event, context, callback) {
  verbose(() => console.info('event: %s', JSON.stringify(event, null, 2)));

  try {
    event.Records.forEach(ev => {
      const cf = ev.cf;
      const uri = cf.request.uri;

      const action = routes.find(e => e.path.test(uri)) || {
        handler: function(cf, context, callback) {
          callback(null, cf.request);
        },
      };
      action.handler(cf, context, callback);
    });
  } catch (err) {
    console.error('event: %s, error: %o', JSON.stringify(event), err);
    callback(new VError(err, '*** Some error occurred'));
  }
};

