# MansooriKart Customers ERP Architecture

Phase E, Part A: Super Admin visibility over real customer accounts, their real order
history, read-only segmentation, and one narrowly-scoped account-status mutation.
Everything below describes the implemented `/api/v1` runtime
(`backend/src/routes/v1/adminCustomers.ts`). The removed legacy `/api/*` runtime has no active consumer.

## 1. No duplicate customer entity

**There is no `AdminCustomer`, `ERPCustomer`, or `CustomerProfile` collection.** A customer
_is_ the existing `User` document with `role: 'CUSTOMER'`; the Customers ERP is a read model
over the architecture that already exists:

| Concern          | Source of truth (unchanged)                         |
| ---------------- | --------------------------------------------------- |
| Identity, status | `User`                                              |
| Order history    | `Order` (`customer` reference)                      |
| Addresses        | `Address` (`user` reference)                        |
| Cart, wishlist   | `Cart`, `Wishlist` (`user` reference)               |
| Reviews          | `Review` (`customer` reference)                     |
| Returns          | `ReturnRequest` (`customer` reference)              |
| Refunds          | `Refund`, reached through the customer's own orders |

A duplicate collection was deliberately not created because no missing business entity was
found: every field the ERP needs already exists on `User`, and copying it would create a
second, drifting truth for account status — the one field this phase actually writes.

`Refund` carries no customer reference. The detail endpoint therefore resolves refunds by
first collecting the customer's own `Order` ids and matching `refund.order` against them, so a
refund can never be attributed to the wrong account.

## 2. Field exposure policy

Two mechanisms, one for each access path:

- **Aggregation** uses an explicit **inclusive projection** (`publicUserProjection`):
  `_id`, `name`, `email`, `phone`, `avatar`, `role`, `status`, `createdAt`, `updatedAt`.
  This matters because `$project` in an aggregation pipeline ignores Mongoose's
  `select: false`, so an allowlist — not a denylist — is what makes the password hash, reset
  token hash, and reset expiry _structurally unable_ to appear.
- **Document reads** use `.select('name email phone avatar role status createdAt updatedAt')`.

Consequently `password`, `passwordHash`, `resetPasswordToken`, `resetPasswordTokenHash`,
`resetPasswordExpires`, JWT material, and `__v` appear nowhere in any Customers ERP response.
The integration test walks every response body recursively and fails on any of those keys at
any depth.

## 3. Customer statistics — real aggregates only

Statistics are computed by a `$lookup` into the `orders` collection per customer. Nothing is
stored, cached, denormalised, or accepted from a client.

| Figure              | Definition                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `totalOrders`       | Count of the customer's orders, **any** status                                                                           |
| `grossSpend`        | `Σ order.total`, any status                                                                                              |
| `realizedSpend`     | `Σ order.total` for delivered/return lifecycle orders whose payment state is `PAID`, `PARTIALLY_REFUNDED`, or `REFUNDED` |
| `cancelledOrders`   | Count where `orderStatus = CANCELLED`                                                                                    |
| `averageOrderValue` | `grossSpend / totalOrders` (0 when there are no orders)                                                                  |
| `firstOrderAt`      | `min(order.createdAt)`                                                                                                   |
| `lastOrderAt`       | `max(order.createdAt)`                                                                                                   |

`realizedSpend` uses the same shared realized-order predicate as the sales and finance
dashboards, so lifetime value and realized revenue cannot disagree merely because a paid order
later enters a partial or full refund state. A cancelled order and an uncollected COD order both
raise `grossSpend` and neither raises `realizedSpend`; unpaid cash is not lifetime value.

## 4. Segmentation (read-only labels)

Derived on read from the statistics above, in this order:

| Segment    | Condition                         |
| ---------- | --------------------------------- |
| `PROSPECT` | `totalOrders = 0`                 |
| `AT_RISK`  | last order more than 180 days ago |
| `VIP`      | `realizedSpend >= 100_000` PKR    |
| `REPEAT`   | `totalOrders >= 3`                |
| `NEW`      | anything else that has ordered    |

Segments are **reporting labels only**. They are not persisted, not writable, and nothing acts
on them: there is no campaign, email, SMS, or push mechanism attached to a segment in this
phase. Customer groups, loyalty tiers, and marketing automation are out of scope.

## 5. Endpoints

All five require a current `SUPER_ADMIN` Bearer token (`requireAuth` then `requireSuperAdmin`,
mounted on the router before any handler): no token → `401`, customer token → `403`.

| Method | Path                                 | Purpose                                    |
| ------ | ------------------------------------ | ------------------------------------------ |
| GET    | `/api/v1/admin/customers`            | Filtered, sorted, paginated customer list  |
| GET    | `/api/v1/admin/customers/analytics`  | Real totals, segment counts, top customers |
| GET    | `/api/v1/admin/customers/:id`        | 360° customer view                         |
| GET    | `/api/v1/admin/customers/:id/orders` | Paginated order history                    |
| PATCH  | `/api/v1/admin/customers/:id/status` | Audited `ACTIVE` ⇄ `SUSPENDED`             |

List query is a strict Zod allowlist: `page`, `limit` (1–100), `search`, `status`
(`ACTIVE|SUSPENDED`), `role` (`CUSTOMER|SUPER_ADMIN`), `segment`, `hasOrders`
(`true|false`), `from`, `to`, `sort`
(`createdAt|name|email|totalOrders|realizedSpend|lastOrderAt`), `direction`. Any other key is
`400 VALIDATION_ERROR`. Consequences:

- Operator injection (`?status[$ne]=SUSPENDED`) is rejected before touching Mongo, because
  the value is typed as an enum and an object never reaches the filter.
- `search` is **regex-escaped**, so `.*` matches literally and returns zero rows rather than
  every customer.
- Sorting is whitelisted; `hasOrders` filters on the computed `totalOrders`, not on a
  client-supplied number.
- The default `role` filter is `CUSTOMER`, so Super Admin accounts do not appear in the
  customer list unless explicitly requested.

The 360° detail response combines the statistics with addresses (max 50), the 20 most recent
orders, cart and wishlist summaries (counts and timestamps, not full contents), and the 20 most
recent reviews, returns, and refunds. A malformed id fails the `^[a-f\d]{24}$` param schema
with `400 VALIDATION_ERROR`; a well-formed unknown id returns `404 CUSTOMER_NOT_FOUND`. No
`CastError`, driver message, index name, or stack trace reaches a client.

## 6. Account status policy

`PATCH /api/v1/admin/customers/:id/status` is the **only** mutation the Customers ERP exposes,
and its body schema is exactly `{ status: 'ACTIVE' | 'SUSPENDED', reason?: string }`.

Refusals, all `409` and all writing **no** audit record:

| Case                                   | Code                        |
| -------------------------------------- | --------------------------- |
| Target is a `SUPER_ADMIN`              | `CUSTOMER_STATUS_FORBIDDEN` |
| Target is the caller's own account     | `CUSTOMER_STATUS_FORBIDDEN` |
| Already in the requested status        | `CUSTOMER_STATUS_UNCHANGED` |
| Status changed before the write landed | `CUSTOMER_STATUS_UNCHANGED` |

The write itself is a conditional `findOneAndUpdate({ _id, role: 'CUSTOMER', status: <observed> })`,
so a concurrent change cannot be overwritten and a Super Admin cannot be invalidated even in a
race. Successful transitions audit as `CUSTOMER_SUSPENDED` or `CUSTOMER_REACTIVATED` with
`{ from, to, reason }`.

**Suspension is enforced at authentication.** `requireAuth` rejects a suspended user's
existing token, so a suspended customer's session stops working immediately rather than at
next login. Status is never customer-controlled: no public or customer-facing route writes
`User.status`.

## 7. Privilege-escalation surface: closed

This is the security property Part A is built around.

- **There is no generic customer mutation endpoint.** No `PATCH /api/v1/admin/customers/:id`
  exists at all, so the shape `PATCH /admin/customers/:id {"role": "SUPER_ADMIN"}` has no
  route to hit — it is a `404`.
- **`role` is absent from every schema in this router**, and the status endpoint's `.strict()`
  body rejects `{ status, role }` with `400 VALIDATION_ERROR` before any database work. The
  update document is built from the parsed schema, so `role` is not merely ignored, it is
  never present.
- **No admin route anywhere writes `User.role`.** Role assignment is not an API operation in
  MansooriKart; it is a deliberate out-of-band act.
- **Public registration always creates `CUSTOMER`.** Submitting `role: 'SUPER_ADMIN'` to
  `POST /api/v1/auth/register` does not change that.

The integration test asserts all four: it attempts the generic route, attempts the escalating
status body, registers with an injected role, and finishes by asserting the total
`SUPER_ADMIN` count is unchanged.

## 8. Analytics

`GET /api/v1/admin/customers/analytics` accepts `days` (1–365, default 30) and `limit`
(1–50, default 10).

| Figure                        | Definition                                              |
| ----------------------------- | ------------------------------------------------------- |
| `totals.customers`            | `ACTIVE + SUSPENDED` accounts with `role: CUSTOMER`     |
| `totals.newInPeriod`          | Customers created within `days`                         |
| `totals.purchasing`           | Customers with at least one order                       |
| `totals.repeatPurchasers`     | Customers with more than one order                      |
| `totals.repeatRate`           | `repeatPurchasers / purchasing × 100`                   |
| `totals.averageLifetimeValue` | Mean `realizedSpend` **over purchasing customers only** |
| `segments`                    | Count per segment                                       |
| `topCustomers`                | Top `limit` by `realizedSpend`, with full statistics    |

Average lifetime value deliberately divides by purchasing customers, not by all customers, so
prospect accounts do not dilute it. The ranking pass is bounded to 500 customers.

## 9. Deferred in Phase E, Part A

- Any customer-facing or admin **frontend** (no customers table UI, no customer detail UI).
- Marketing on top of segments: campaigns, abandoned-cart email campaigns, SMS, push.
- Customer groups, loyalty tiers, store credit, wallets.
- Customer merge, GDPR erasure, and data-export workflows.
- Role/permission management of any kind (see §7 — deliberately not an API surface).

See [PURCHASING_ARCHITECTURE.md](./PURCHASING_ARCHITECTURE.md) for Phase E, Part B and
[ORDERS_SALES_ARCHITECTURE.md](./ORDERS_SALES_ARCHITECTURE.md) for the Phase D order,
return, and refund contracts this read model reports on.
