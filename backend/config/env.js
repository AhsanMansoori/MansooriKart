const required = ['MONGO_URI', 'JWT_SECRET'];

function validateEnvironment({ allowMissingDatabase = false } = {}) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const missing = required.filter(key => !process.env[key]);
  if (allowMissingDatabase) {
    const mongoIndex = missing.indexOf('MONGO_URI');
    if (mongoIndex >= 0) missing.splice(mongoIndex, 1);
  }
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (nodeEnv === 'production' && !process.env.FRONTEND_URL) {
    throw new Error('Missing required environment variable: FRONTEND_URL');
  }

  return {
    nodeEnv,
    port: Number(process.env.PORT || 5000),
    frontendUrl: process.env.FRONTEND_URL || (nodeEnv === 'production' ? null : 'http://localhost:3000'),
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean),
  };
}

module.exports = { validateEnvironment };
