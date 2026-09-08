# MansooriKart Backend API Audit

Audit date: 2026-08-31  
Scope: current `backend/` routes, models, middleware, services, tests, seed and scripts before the revised Phase 3 API work.

## Baseline

The backend is an Express/Mongoose application with five legacy route groups and three primary domain models (`User`, `Product`, and `Order`). It has no `/api/v1` namespace yet. The existing storefront calls the legacy `/api/*` paths directly, so those paths must remain compatible while versioned routes are introduced.

Phase 1 protections already present include Helmet, an explicit CORS allowlist, request IDs, centralized fallback errors, auth rate limiting, customer-only public registration, hashed and expiring password-reset tokens, server-authoritative checkout pricing, and compensating inventory rollback.

## Existing endpoint inventory

| Method | Route                                 | Auth / role                      | Validation and pagination                                     | Current response contract               | Frontend consumer                    | Notes / security review                                                                                                                                                     |
| ------ | ------------------------------------- | -------------------------------- | ------------------------------------------------------------- | --------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/health`                             | Public                           | None                                                          | `{ status: "ok"                         | "degraded" }`                        | No                                                                                                                                                                          | Mongo readiness only; intentionally outside API versioning. |
| GET    | `/api-docs`, `/api-docs/swagger.json` | Public                           | N/A                                                           | Swagger UI / JSON                       | No                                   | Legacy Swagger does not yet cover the planned v1 surface.                                                                                                                   |
| POST   | `/api/auth/register`                  | Public                           | Express-validator: name, email, 8-char password; auth limiter | Standard `{ success, data }`            | `Register.jsx`                       | Ignores requested role and creates `CUSTOMER`; safe.                                                                                                                        |
| POST   | `/api/auth/login`                     | Public                           | Email/password; auth limiter                                  | Standard `{ success, data }`            | `Login.jsx`                          | JWT contains id and role.                                                                                                                                                   |
| POST   | `/api/auth/forgot-password`           | Public                           | Normalized email; auth limiter                                | Generic standard success response       | `ForgotPassword.jsx`                 | Does not disclose account existence; reset token is hashed and not returned.                                                                                                |
| POST   | `/api/auth/reset-password`            | Public                           | Token length and 8-char password; auth limiter                | Standard `{ success, data }` or error   | `ResetPassword.jsx`                  | Single-use, expiring reset token.                                                                                                                                           |
| GET    | `/api/products`                       | Public                           | None; unpaginated                                             | Legacy product array with `id` added    | `App.jsx`, `src/lib/api/products.ts` | Exposes all product states because no product status exists yet; requires v1 active-only pagination/filtering.                                                              |
| GET    | `/api/products/:id`                   | Public                           | Mongo lookup only                                             | Raw product document / plaintext errors | `ProductDetails.jsx`                 | Legacy shape/error handling is inconsistent; retain compatibility while adding normalized v1 detail.                                                                        |
| GET    | `/api/products/:id/similar`           | Public                           | None                                                          | Legacy product array                    | `ProductDetails.jsx`                 | Pinecone first, safe heuristic fallback; optional external service failures are caught.                                                                                     |
| POST   | `/api/products/recommendations`       | Public                           | Non-empty ids array                                           | Legacy product array                    | `Home.jsx`                           | Pinecone centroid first, heuristic fallback; should gain bounded id validation in v1.                                                                                       |
| GET    | `/api/products/category/:category`    | Public                           | None                                                          | Raw product array                       | No direct current consumer           | Category is an unvalidated string, not a domain relation.                                                                                                                   |
| PUT    | `/api/products/:id/rating`            | Public                           | No rating validation/authentication                           | Raw product document                    | `ProductDetails.jsx`                 | Demo endpoint; anonymous writes are unsafe and must be superseded by authenticated reviews.                                                                                 |
| GET    | `/api/search`                         | Public                           | Escaped query (80 chars), `page`/`limit` bounded 1–50         | Raw product array; no metadata          | `NavigationBar.jsx`                  | ReDoS mitigation exists; v1 must add active-only filtering and pagination metadata.                                                                                         |
| POST   | `/api/checkout/create-order`          | Public / guest checkout          | Validates customer/address/items/COD; forbids card fields     | Standard `{ success, data }`            | `Checkout.jsx`                       | Uses database prices; conditional stock decrements with rollback on later failure or save failure. Does not associate order with user, coupon, tax, shipping, or addresses. |
| POST   | `/api/orders/track`                   | Public with order number + email | Email and legacy `FE-` order number check                     | Legacy raw order-tracking payload       | `OrderTracking.jsx`                  | Read-only. New orders use `MK-`, so this format check is internally inconsistent and needs compatible correction.                                                           |
| GET    | `/api/admin/verification`             | JWT + `SUPER_ADMIN`              | N/A                                                           | Standard `{ success, data }`            | No                                   | Only current admin endpoint. Good representative authorization guard, but no operational admin APIs.                                                                        |

## Current models and data limitations

| Model     | Current fields / behavior                                                                                              | Phase 3 implication                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`    | name, unique email, password, role (`CUSTOMER`/`SUPER_ADMIN`), password-reset fields, date                             | Add explicit public serializer, profile status/phone/avatar, timestamps, and separate address relation. Never expose password/token fields.                                                                                     |
| `Product` | name, description, price, string category/brand, single image, stock, rating, `numReviews`, vector ids                 | Needs additive migration to slug/SKU/status/media/references/pricing metadata/indexes. Preserve vector hooks and legacy fields during compatibility period.                                                                     |
| `Order`   | guest name/email/address, item snapshots, subtotal/total, COD/ONLINE enum, basic status and simulated tracking history | Needs customer reference, typed address snapshot, discounts, shipping/tax, coupon, controlled status transition and cancellation-restock guard. Current `advanceStatus` is random and must not be used for production workflow. |
| Missing   | Address, Category, Brand, Cart, Wishlist, Coupon, Review, InventoryMovement, StoreSettings, AuditLog                   | Required Phase 3 domain additions.                                                                                                                                                                                              |

## Middleware and service audit

- `middleware/auth.js` supports `x-auth-token`, verifies JWT and obtains the persisted role. It returns normalized 401/403 responses for protected requests. It should be extended to accept standard Bearer authorization without removing the legacy header.
- `middleware/errors.js` provides safe unknown-route and unhandled-error responses; individual legacy handlers still return inconsistent raw strings/payloads.
- `middleware/requestContext.js` provides a request ID. It should be included in all v1 success/error paths where useful and supplied to audit events.
- Pinecone/Google AI/Weaviate/FAISS services are optional only in practice: recommendation code catches their failures. New core routes must not depend on them.
- The seed process and Pinecone sync currently run on backend startup after Mongo connects. Schema additions must be backward-compatible, and any backfill must be an idempotent script rather than a destructive reset.

## Test audit

Six backend suites / 22 tests cover authentication, checkout rollback, products, safe search, read-only tracking, and embedding normalization. They mock models and do not yet cover a live v1 composition root, ownership boundaries, cart/wishlist/coupons, reviews, inventory ledger, or Super Admin resource routes. Phase 3 tests must be added alongside each new route family.

## Baseline quality gates

Executed before Phase 3 implementation:

| Command                                    | Result                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `npm run format:check`                     | PASS                                                                                    |
| `npm run lint`                             | PASS                                                                                    |
| `npx tsc --noEmit`                         | PASS                                                                                    |
| `npm --prefix backend test -- --runInBand` | PASS — 22/22 tests                                                                      |
| `npm run build`                            | PASS (non-blocking Vite/chunk-size warnings)                                            |
| `npm test -- --runInBand`                  | In progress when this audit was recorded; the prior verified baseline is 51/51 passing. |

## Incremental implementation plan

1. Add reusable v1 response, validation, pagination, safe-query, serialization, and audit utilities.
2. Add additive domain models and `/api/v1` route families while retaining legacy mounts.
3. Expand checkout/orders around the current authoritative inventory compensation rather than replacing it in a big-bang change.
4. Add focused authorization, ownership, lifecycle, and inventory tests with each family.
5. Freeze contracts in `docs/API_CONTRACT.md`, `docs/API_INVENTORY.md`, and Swagger only after the stable route surface exists.
