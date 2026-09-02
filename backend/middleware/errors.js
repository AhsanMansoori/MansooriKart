function notFound(req, res) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' }, requestId: req.requestId });
}

function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  if (status >= 500) console.error('Unhandled API error', { requestId: req.requestId, code, message: err.message });
  res.status(status).json({
    success: false,
    error: { code, message: status >= 500 ? 'Something went wrong. Please try again later.' : err.message },
    requestId: req.requestId,
  });
}

module.exports = { notFound, errorHandler };
