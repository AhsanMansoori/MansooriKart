import { z } from 'zod';

/**
 * Single source of truth for backend configuration.
 *
 * Every environment variable the backend depends on is declared, coerced and validated
 * here on every getConfig call. Domain code reads a typed `BackendConfig` instead of touching
 * `process.env`, so a missing or malformed value fails at startup rather than surfacing
 * as an undefined string deep inside a request (§13). See `docs/ENVIRONMENT_CONFIGURATION.md`.
 *
 * Two rules govern what may appear in this file:
 *
 *  1. Only variables the application actually reads are declared. The contract is not a
 *     wish list; an unused variable is removed rather than documented.
 *  2. Validation failures name the variable and the reason, never the value. A
 *     configuration error must be diagnosable from a log line that is safe to paste
 *     into a ticket (§32).
 *
 * Nothing here holds a Google client secret, an SMTP password or a payment credential:
 * the selected Google Identity Services flow verifies ID tokens against a *public*
 * client id (see `docs/AUTHENTICATION_ARCHITECTURE.md`), and no email or payment
 * provider is wired yet.
 */

export interface AuthRateLimitConfig {
  /** Sliding window for authentication attempts, in milliseconds. */
  windowMs: number;
  /** Maximum attempts per window, per client address, per process. */
  max: number;
}

export interface BackendConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  mongoUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  frontendUrl?: string;
  allowedOrigins: string[];
  /** Public Google OAuth client id. Absent means Google sign-in is disabled, not broken. */
  googleClientId?: string;
  /** Deployment label reported by the operations health endpoint. Never a secret. */
  appVersion: string;
  authRateLimit: AuthRateLimitConfig;
}

/** An empty environment variable is an absent one; `PORT=` must not parse as port 0. */
const blank = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optionalText = z.preprocess(blank, z.string().trim().min(1).optional());
/** Absent and blank collapse to the same failure so the message is always the readable one. */
const requiredText = (name: string) => z.preprocess(value => (typeof value === 'string' ? value : ''), z.string().trim().min(1, `${name} is required.`));
const boundedInt = (fallback: number, max: number) => z.preprocess(blank, z.coerce.number().int().min(1).max(max).default(fallback));

const schema = z.object({
  // Application
  NODE_ENV: z.preprocess(blank, z.enum(['development', 'test', 'production']).default('development')),
  PORT: boundedInt(5000, 65535),
  FRONTEND_URL: optionalText,
  APP_VERSION: optionalText,
  // Database
  MONGO_URI: requiredText('MONGO_URI').refine(
    value => /^mongodb(?:\+srv)?:\/\/[^\s/?#]+(?:\/[^\s#]*)?$/.test(value),
    'MONGO_URI must be a valid mongodb:// or mongodb+srv:// connection URI.'
  ),
  // Authentication
  JWT_SECRET: requiredText('JWT_SECRET'),
  JWT_EXPIRES_IN: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN must look like 15m, 1h or 3600s.')
      .refine(value => {
        const seconds = Number(value.slice(0, -1)) * ({ s: 1, m: 60, h: 3600, d: 86400 }[value.slice(-1)] ?? 0);
        return seconds >= 60 && seconds <= 3600;
      }, 'JWT_EXPIRES_IN must be between one minute and one hour.')
      .default('15m')
  ),
  GOOGLE_CLIENT_ID: optionalText.refine(
    value => value === undefined || /^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(value),
    'GOOGLE_CLIENT_ID must be a Google OAuth client ID.'
  ),
  // Security and CORS
  CORS_ALLOWED_ORIGINS: z.preprocess(blank, z.string().trim().default('')),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: boundedInt(15, 1440),
  AUTH_RATE_LIMIT_MAX: z.preprocess(blank, z.coerce.number().int().min(1).max(10000).optional()),
});

/** Placeholder material shipped in `.env.example`. Present in production means nobody set a real secret. */
const PLACEHOLDER_MARKERS = ['replace', 'example', 'changeme', 'change_me', 'your_', 'placeholder', 'secret_here'];

function normaliseNodeEnv(value: string | undefined): BackendConfig['nodeEnv'] {
  return value === 'production' || value === 'test' ? value : 'development';
}

/**
 * Parses an origin the CORS allowlist may contain.
 *
 * Returns the normalised `scheme://host[:port]` form so `https://shop.example/` and
 * `https://shop.example` cannot disagree, and rejects anything that is not an absolute
 * http(s) URL. In production a cleartext origin is refused unless it is loopback, which
 * is how development can keep using `http://localhost` without that convenience
 * becoming a production default (§16).
 */
function normaliseOrigin(value: string, production: boolean, issues: string[], label: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    issues.push(`${label} must be an absolute http(s) origin.`);
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    issues.push(`${label} must use http or https.`);
    return null;
  }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (production && parsed.protocol === 'http:' && !loopback) {
    issues.push(`${label} must use https in production.`);
    return null;
  }
  return parsed;
}

/**
 * Validates the environment and returns the typed configuration.
 *
 * Throws a single `Error` listing every problem by variable name. Callers at startup let
 * it propagate; the process must not serve traffic with a half-valid configuration.
 */
export function getConfig(environment: NodeJS.ProcessEnv = process.env): BackendConfig {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map(issue => `${issue.path.join('.') || 'environment'}: ${issue.message}`);
    throw new Error(`Invalid backend environment configuration -> ${[...new Set(reasons)].join('; ')}`);
  }
  const values = parsed.data;
  const nodeEnv = normaliseNodeEnv(values.NODE_ENV);
  const production = nodeEnv === 'production';
  const issues: string[] = [];

  if (production) {
    if (!values.FRONTEND_URL) issues.push('FRONTEND_URL is required in production.');
    if (values.JWT_SECRET.length < 32) issues.push('JWT_SECRET must be at least 32 characters in production.');
    if (PLACEHOLDER_MARKERS.some(marker => values.JWT_SECRET.toLowerCase().includes(marker)))
      issues.push('JWT_SECRET still contains example placeholder text.');
  }

  // `frontendUrl` keeps its full path because it is also the base for password-reset
  // links, while CORS compares origins only.
  const frontend = values.FRONTEND_URL ? normaliseOrigin(values.FRONTEND_URL, production, issues, 'FRONTEND_URL') : null;
  const frontendUrl = frontend ? frontend.href.replace(/\/$/, '') : null;
  const configured = values.CORS_ALLOWED_ORIGINS.split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
    .map(origin => normaliseOrigin(origin, production, issues, 'CORS_ALLOWED_ORIGINS'))
    .filter((origin): origin is URL => Boolean(origin))
    .map(origin => origin.origin);

  if (issues.length) throw new Error(`Invalid backend environment configuration -> ${[...new Set(issues)].join('; ')}`);

  // Local development ports are convenience defaults, not production policy: outside
  // production the browser dev servers are trusted, in production only what is configured.
  const developmentOrigins = production ? [] : ['http://localhost:3000', 'http://localhost:5173'];
  const allowedOrigins = [...new Set([...(frontend ? [frontend.origin] : []), ...configured, ...developmentOrigins])];

  return {
    nodeEnv,
    port: values.PORT,
    mongoUri: values.MONGO_URI,
    jwtSecret: values.JWT_SECRET,
    jwtExpiresIn: values.JWT_EXPIRES_IN,
    ...(frontendUrl ? { frontendUrl } : {}),
    allowedOrigins,
    ...(values.GOOGLE_CLIENT_ID ? { googleClientId: values.GOOGLE_CLIENT_ID } : {}),
    appVersion: values.APP_VERSION ?? 'unknown',
    authRateLimit: {
      windowMs: values.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
      max: values.AUTH_RATE_LIMIT_MAX ?? (production ? 10 : 100),
    },
  };
}
