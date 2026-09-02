function success(res, data, meta, status = 200) {
  const payload = { success: true, data };
  if (meta) payload.meta = meta;
  return res.status(status).json(payload);
}

function failure(res, status, code, message, requestId) {
  return res.status(status).json({
    success: false,
    error: { code, message },
    ...(requestId ? { requestId } : {}),
  });
}

module.exports = { success, failure };
