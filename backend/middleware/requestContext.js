const crypto = require('crypto');
const { log } = require('../utils/logger');

function requestContext(req, res, next) {
  const requestId = req.header('x-request-id') || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  const startedAt = Date.now();
  res.on('finish', () =>
    log('info', 'http_request', { requestId, method: req.method, path: req.originalUrl, statusCode: res.statusCode, durationMs: Date.now() - startedAt })
  );
  next();
}

module.exports = { requestContext };
