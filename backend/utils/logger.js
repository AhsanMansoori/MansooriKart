const SENSITIVE_KEYS = /password|token|authorization|card|cvc|cookie/i;

function redact(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(item)]));
}

function log(level, message, meta = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...redact(meta) };
  if (process.env.NODE_ENV === 'production') {
    console.log(JSON.stringify(entry));
  } else {
    console[level === 'error' ? 'error' : 'log'](`[${level}] ${message}`, redact(meta));
  }
}

module.exports = { log, redact };
