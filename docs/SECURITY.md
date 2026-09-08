# MansooriKart Security Decisions

- The API accepts `Authorization: Bearer <JWT>`. The browser currently stores the token under `mansoorikart_access_token`; XSS-resistant HttpOnly transport is deferred to a later frontend/security phase.
- Access tokens default to 15 minutes and configuration rejects durations above one hour. There is no refresh endpoint or server-side logout list. Logout removes the browser token; password reset increments the account session version and immediately invalidates earlier tokens.
- Forgot-password responses do not reveal account existence. Reset tokens are random, hashed at rest, expiring, and consumed by one atomic database update. No email provider is configured yet.
- Google ID tokens are verified against the configured public client ID. Google subjects are unique, only verified email identities may link, and Google sign-in never grants an administrative role.
- Public registration always creates `CUSTOMER`. Super Admin accounts are provisioned through the bootstrap command.
- Prices, charges, availability, discounts, order numbers, costs, roles, and ownership are server-controlled. Public serializers are allowlists.
- CORS uses exact configured origins and does not enable credentials. Authentication rate limiting is process-local until a shared store is introduced.
- Transactions require a replica set or sharded MongoDB cluster and abort inventory, orders, purchasing, coupon, return, refund, and audit writes together.
