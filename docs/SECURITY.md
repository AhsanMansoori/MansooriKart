# MansooriKart Security Decisions

- **Authentication:** JWT is a temporary Phase 1 transport, persisted as `mansoorikart_access_token` with migration from legacy keys. The API sends it as `x-auth-token`. The target is secure HttpOnly cookie sessions.
- **Password reset:** forgot-password responses are generic. A random 256-bit token is generated, only its SHA-256 hash and expiry are persisted, and reset tokens are single-use. A mail adapter must deliver the URL; tokens are never returned by the API or logged.
- **Development email adapter:** only when `NODE_ENV=development`, the reset URL is emitted through the redacting structured logger for manual local verification. Production does not log reset URLs and needs a provider adapter.
- **Roles:** public registration always creates `CUSTOMER`. `SUPER_ADMIN` is assigned only by the explicit `npm run admin:bootstrap` command using `SUPER_ADMIN_*` environment variables.
- **Checkout boundary:** prices and stock are authoritative server data. Card data is forbidden. Phase 1 supports COD only; online payment explicitly reports unavailable until a provider is selected.
- **CORS and rate limits:** configured origin allow-list; auth endpoints have 15-minute limits. Credentials are not enabled for cross-origin requests.
- **Logging:** request IDs and structured request metadata are logged. Passwords, tokens, cookies and card-related fields are redacted.
- **Secrets:** use `MONGO_URI`, `JWT_SECRET`, `FRONTEND_URL`, optional recommendation variables, and bootstrap variables only through environment configuration. Do not commit secrets.
