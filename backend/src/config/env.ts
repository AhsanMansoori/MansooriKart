export interface BackendConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  mongoUri: string;
  jwtSecret: string;
  frontendUrl?: string;
  allowedOrigins: string[];
}

export function getConfig(environment: NodeJS.ProcessEnv = process.env): BackendConfig {
  const nodeEnv = (environment.NODE_ENV || 'development') as BackendConfig['nodeEnv'];
  const mongoUri = environment.MONGO_URI;
  const jwtSecret = environment.JWT_SECRET;
  if (!mongoUri || !jwtSecret) throw new Error('MONGO_URI and JWT_SECRET are required.');
  if (nodeEnv === 'production' && !environment.FRONTEND_URL) throw new Error('FRONTEND_URL is required in production.');
  const port = Number(environment.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  return {
    nodeEnv,
    port,
    mongoUri,
    jwtSecret,
    ...(environment.FRONTEND_URL ? { frontendUrl: environment.FRONTEND_URL } : {}),
    allowedOrigins: (environment.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean),
  };
}
