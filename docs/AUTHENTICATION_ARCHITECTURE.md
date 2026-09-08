# Authentication Architecture

Local credentials and Google Identity Services resolve to the same `users` collection. The database enforces unique normalized email addresses and a partial unique index for Google's stable `sub`. Google token verification checks issuer, audience, expiry, subject, and verified email. Linking is restricted to active customer accounts with the same verified email; an existing different subject, suspended account, or Super Admin account fails closed.

Successful local or Google authentication issues the same application JWT with `sub`, `role`, and `ver`. `requireAuth` verifies the signature, then reloads the user and trusts the stored role/status/session version. The default lifetime is 15 minutes and the configured lifetime cannot exceed one hour. There is no refresh token. Browser logout only deletes local token material, so a copied token remains valid until expiry unless the account is suspended or its session version changes.

Password reset stores only a SHA-256 token hash and one-hour expiry. Reset uses a conditional `findOneAndUpdate`, so one request can consume the token. It replaces the password hash, clears reset fields, adds the local provider, and increments `sessionVersion` atomically. Earlier JWTs then fail authorization.

The frontend keeps the Bearer token in local storage for compatibility with the current UI. Moving it to an HttpOnly, Secure, SameSite cookie and adding refresh rotation is deferred to the planned frontend/security phase because it changes the cross-origin and CSRF model.

The email seam has no provider. Its queue-only default does not send mail or claim delivery. Provider configuration and durable delivery belong to the later email phase.
