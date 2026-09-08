# Environment Configuration

`backend/src/config/env.ts` is the runtime authority. `getConfig()` validates each read and never includes rejected values in errors.

| Variable                         | Required   | Contract                                                                          |
| -------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `NODE_ENV`                       | No         | `development`, `test`, or `production`; default `development`                     |
| `PORT`                           | No         | Integer 1–65535; default 5000                                                     |
| `MONGO_URI`                      | Yes        | `mongodb://` or `mongodb+srv://`; deployment must support transactions            |
| `JWT_SECRET`                     | Yes        | At least 32 characters and non-placeholder in production                          |
| `JWT_EXPIRES_IN`                 | No         | 1 minute through 1 hour; default `15m`                                            |
| `FRONTEND_URL`                   | Production | Absolute HTTP(S) URL; HTTPS outside loopback in production                        |
| `CORS_ALLOWED_ORIGINS`           | No         | Comma-separated exact HTTP(S) origins                                             |
| `GOOGLE_CLIENT_ID`               | No         | Public `*.apps.googleusercontent.com` identifier; absence disables Google sign-in |
| `APP_VERSION`                    | No         | Deployment label exposed by authenticated system health; default `unknown`        |
| `AUTH_RATE_LIMIT_WINDOW_MINUTES` | No         | 1–1440; default 15                                                                |
| `AUTH_RATE_LIMIT_MAX`            | No         | 1–10000; default 10 production, 100 otherwise                                     |

The frontend reads `VITE_API_URL` and optional public `VITE_GOOGLE_CLIENT_ID`. No client secret, MongoDB URI, JWT secret, payment credential, SMTP credential, AI key, or storage credential belongs in a `VITE_*` value.

MongoDB standalone servers are rejected during startup because the application depends on transactions. Docker Compose therefore expects an external transaction-capable `MONGO_URI`; it does not silently start an incompatible standalone database.
