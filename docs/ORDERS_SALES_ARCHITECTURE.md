# MansooriKart Orders & Sales ERP Architecture

Phase D scope: order visibility, cancellation, returns, refunds, invoices, order
confirmation email, abandoned carts, and sales reporting. Everything below describes the
implemented `/api/v1` runtime (`backend/src`). The removed legacy `/api/*` runtime has no active consumer.

## 1. Order state machine

`orderStatus` transitions (`backend/src/services/orderService.ts`):

| From                                       | Allowed next                         |
| ------------------------------------------ | ------------------------------------ |
| `PENDING`                                  | `CONFIRMED`, `CANCELLED`             |
| `CONFIRMED`                                | `PROCESSING`, `CANCELLED`            |
| `PROCESSING`                               | `SHIPPED`                            |
| `SHIPPED`                                  | `DELIVERED`                          |
| `DELIVERED`                                | `RETURN_REQUESTED`                   |
| `RETURN_REQUESTED`                         | `RETURN_APPROVED`, `RETURN_REJECTED` |
| `RETURN_APPROVED`                          | `RETURNED`                           |
| `CANCELLED`, `RETURNED`, `RETURN_REJECTED` | terminal                             |

Every accepted transition appends an immutable `statusHistory` entry
(`{ from, to, reason, actor, requestId, at }`) and writes an `AuditLog` record. Rejected
transitions return `400 ORDER_TRANSITION_INVALID` and write nothing — no status change, no
history entry, no audit record.

## 2. Payment state machine and COD policy

`paymentStatus` is one of `PENDING`, `UNPAID`, `PAID`, `FAILED`, `REFUNDED`,
`PARTIALLY_REFUNDED`. `CASH_ON_DELIVERY` is the only accepted `paymentMethod`; checkout
always persists `UNPAID`. Collection is an explicit Super Admin action
(`PATCH /api/v1/admin/orders/:orderId/payment-status`), which is how COD cash becomes
realized revenue. **No payment provider is integrated. Payment provider selection remains
TBD / NOT CONFIRMED**, so nothing in this phase authorises, captures, or settles money —
refunds are recorded ledger facts, not provider calls.

## 3. Money model

All amounts are PKR integers-with-cents rounded to two decimals by `money()`.

```
lineSubtotal            = unitPrice * quantity          (unitPrice snapshotted at checkout)
subtotal                = Σ lineSubtotal
discountedSubtotal      = subtotal - discount
shipping                = discountedSubtotal >= 5000 ? 0 : 250
tax                     = 0                              (not yet levied)
total                   = subtotal - discount + shipping + tax
```

Prices are always re-read from the catalog at checkout. A stored cart price or a
client-submitted price is never authoritative.

## 4. Admin order visibility

`GET /api/v1/admin/orders` is Super Admin only. The query schema is a strict Zod allowlist:
`page`, `limit` (1–100), `orderNumber`, `customer`, `orderStatus`, `paymentStatus`,
`paymentMethod`, `from`, `to`, `minAmount`, `maxAmount`, `sort`
(`createdAt|total|orderNumber`), `direction` (`asc|desc`). Consequences:

- Operator objects (`?orderStatus[$ne]=CANCELLED`, `?customer[$regex]=.*`) are rejected with
  `400 VALIDATION_ERROR` before touching Mongo — the values are typed as strings/enums, so an
  object never reaches the filter.
- `customer` resolves through an exact `email`/`name` lookup, not a regex, so a value such as
  `.*` matches literally and returns zero rows.
- `orderNumber` is upper-cased and matched exactly.
- Sorting is whitelisted; an unlisted sort key or direction is a 400.
- `__proto__[...]` keys are dropped by Express's `qs` parser before validation. The request is
  therefore a normal unfiltered list and `Object.prototype` is unchanged.

`GET /api/v1/admin/orders/:orderId` populates the customer with `name email` only. No
password hash, JWT, reset token, or internal user document is ever serialised. Malformed
ids fail the `^[a-f\d]{24}$` param schema with `400 VALIDATION_ERROR`; well-formed unknown
ids return `404 ORDER_NOT_FOUND`. No `CastError`, driver message, or stack trace is exposed.

## 5. Cancellation policy

Cancellable states: `PENDING` and `CONFIRMED`. Both the customer route
(`POST /api/v1/orders/:orderId/cancel`, own orders only) and the admin route
(`POST /api/v1/admin/orders/:orderId/cancel`, any order) call the same `cancelOrder`
service.

**Invariant — inventory is restored exactly once.** The cancellation is _claimed_ with a
single atomic conditional update before any inventory work happens:

```js
Order.findOneAndUpdate(
  { ...scope, orderStatus: { $in: ['PENDING', 'CONFIRMED'] } },
  [{ $set: { orderStatus: 'CANCELLED', statusHistory: { $concatArrays: [...] } } }],
  { new: true }
)
```

Only the request whose update matched a still-cancellable document proceeds to restock; every
other request sees `null` and returns `400 ORDER_NOT_CANCELLABLE`. A simultaneous
customer-vs-admin cancellation therefore yields exactly one `200`, one `CANCELLATION`
inventory movement, one restored balance, and one audit record
(`ORDER_CANCELLED` or `ORDER_ADMIN_CANCELLED`). Restock movements carry
`referenceType: 'Order'` and `referenceId: <orderId>`, which is what makes "exactly once"
verifiable. Cancellation does not restore coupon eligibility.

## 6. Return policy

`ReturnRequest` transitions: `REQUESTED → APPROVED|REJECTED`, `APPROVED → RECEIVED`,
`RECEIVED → COMPLETED`; `REJECTED` and `COMPLETED` are terminal. Only `DELIVERED` orders are
returnable (`RETURN_NOT_ELIGIBLE` otherwise). Requested quantities are validated against the
purchased snapshot and reserved through `ReturnAllocation`, whose conditional upsert prevents
the same unit being claimed twice across concurrent requests
(`RETURN_QUANTITY_INVALID`). Rejecting a return releases its allocation.

Customers see only their own returns; admin list/detail/status endpoints are Super Admin
only and audited (`RETURN_REQUESTED`, `RETURN_STATUS_UPDATED`).

## 7. Return inventory policy (explicit)

**A return does not restore sellable inventory at any stage.** `updateReturnStatus` performs
no `adjustStock` call: moving `REQUESTED → APPROVED → RECEIVED → COMPLETED` leaves
`InventoryBalance.quantityOnHand` and the `Product.stock` mirror unchanged and creates zero
`RETURN` inventory movements.

This is deliberate. A returned unit is not automatically sellable — it must be physically
received and inspected first, and it may be damaged, incomplete, or destined for scrap. Making
it sellable on a status change would let a customer-triggered workflow inflate warehouse stock
without anyone inspecting the goods. Returned units therefore re-enter sellable stock only
through an explicit, audited Inventory ERP adjustment
(`POST /api/v1/admin/inventory/adjustments`) once inspection passes. Automated
grading/restock on `RECEIVED` is deferred to the Inventory phase, not silently assumed here.

## 8. Refund policy

`POST /api/v1/admin/orders/:orderId/refunds` is Super Admin only, requires an
`Idempotency-Key` header (8–128 chars), and accepts only `{ amount, reason, returnId? }`.
Refunds are ledger records; no provider is called.

**Idempotency.** `Refund` carries a unique compound index on `(order, idempotencyKey)`. That
index — not an in-memory guard — is the durable authority. A replay under the same key returns
the original refund (same `_id`, same `refundNumber`) without creating a second record, and a
replay that tries to smuggle a different `amount` still returns the originally stored amount.
Three concurrent requests under one key produce one refund; the losers of the unique-index race
re-read and return the winner's document.

**Amount invariant.** The sum of non-`FAILED` refunds for an order may never exceed
`order.total`. This is guaranteed atomically by reserving headroom on a persisted accumulator
(`Order.refundedTotal`) _before_ the `Refund` document is written:

```js
Order.findOneAndUpdate(
  { _id, $expr: { $lte: [{ $add: [{ $ifNull: ['$refundedTotal', 0] }, amount] }, '$total'] } },
  { $inc: { refundedTotal: amount } },
  { new: true }
);
```

A single document update evaluates the cap and applies the increment, so two concurrent
refunds that would jointly exceed the total cannot both reserve. The loser receives
`400 REFUND_AMOUNT_INVALID`. Reserved headroom is released (`$inc` negative) if the refund
insert fails, if the key turns out to be a duplicate, and when a refund is later moved to
`FAILED` — which keeps `refundedTotal` consistent with the refund figure the sales dashboard
reports. Refund status transitions are `APPROVED`, `COMPLETED`, `FAILED`, and are audited.

## 9. Invoice and receipt policy

An invoice is a _projection_, not a second source of truth: `buildInvoice` reads only the
persisted order snapshot (item name, sku, unit price, line subtotal, address, totals) and never
loads a `Product`. Renaming, repricing, or archiving a product after purchase therefore cannot
change a historical invoice. There is no separate `Invoice` collection.

| Endpoint                                        | Access                                   |
| ----------------------------------------------- | ---------------------------------------- |
| `GET /api/v1/orders/:orderId/invoice`           | Customer, own order only (404 otherwise) |
| `GET /api/v1/orders/:orderId/invoice.pdf`       | Customer, own order only                 |
| `GET /api/v1/admin/orders/:orderId/invoice`     | Super Admin, any order                   |
| `GET /api/v1/admin/orders/:orderId/invoice.pdf` | Super Admin, any order                   |

Admin invoices expose the customer as `{ id, name, email }` — operational identity only, never
credentials, tokens, or the internal user object.

### Invoice number design

`invoiceNumber` is server-generated at checkout as `INV-<orderNumber>`, i.e.
`INV-MK-YYYYMMDD-XXXXXX`. It is persisted on the order, derived from the already-unique
`orderNumber` (so it is collision-safe without a counter collection), never accepted from a
client (the checkout schema is strict and rejects `invoiceNumber`), and never regenerated —
status transitions and payment changes leave it untouched. Orders created before the field
existed fall back to the same deterministic derivation, so historical invoices keep a stable
number.

### PDF behaviour

`renderInvoicePdf` (`backend/src/services/invoicePdf.ts`) uses **pdfkit** and returns a real
`application/pdf` byte stream — a `%PDF-` header, an `%%EOF` trailer, and the invoice content
laid out as a document. The response sets `Content-Type: application/pdf`,
`Content-Disposition: attachment; filename="<invoiceNumber>.pdf"`, and an accurate
`Content-Length`. The document is generated with `compress: false` so the content stream stays
inspectable by support staff and tests without a PDF parser; invoices are a few kilobytes
either way. There is no JSON-pretending-to-be-PDF endpoint.

## 10. Order confirmation email

Delivery is provider-agnostic and **no provider is integrated**. `transactionalEmail.ts`
exposes an `EmailAdapter` seam; the default `queue-only` adapter records intent and holds no
credentials and no transport. Production wiring (SMTP or an API adapter) belongs to the
Production Configuration & Secrets phase and only needs to call `setEmailAdapter`. No real
SMTP credentials are required to run or test this.

**Side-effect policy.** Sending happens strictly post-commit: the order, inventory movements,
coupon redemption, audit record, and cart clearing are all durable before an adapter is
invoked. `sendOrderConfirmation` never throws and never rethrows. A provider outage is
recorded as a bounded, safe failure (`{ orderNumber, adapter, reason, at }`, message text only,
capped at 50 entries) and the committed checkout stays a `201` with correct inventory and an
emptied cart. `flushEmailDeliveries()` lets callers and tests await in-flight deliveries
without blocking checkout.

**Content contract.** The message is exactly `{ to, subject, template, data }` with
`template: 'ORDER_CONFIRMATION'`. `data` is built only from the immutable order snapshot plus
the customer's display name: order number, invoice number, order date, customer name, items
(name, sku, quantity, unit price, line subtotal), subtotal, discount, shipping, tax, total,
currency, payment method, payment status, a flattened shipping-address summary, and the order
reference. It deliberately excludes passwords, password hashes, JWTs, reset tokens, secrets,
and the internal user document.

## 11. Abandoned carts

`GET /api/v1/admin/abandoned-carts` (Super Admin) is derived entirely from the existing
persisted `Cart` collection — no new collection, no duplicated cart data, no separate
snapshot to drift.

- **Definition.** A cart is abandoned when it has at least one item and has been inactive past
  the threshold (`updatedAt <= now - olderThanHours`, default **24 hours**, overridable 1 to
  2160). Checkout empties the cart, so a non-empty cart is by construction unconverted.
- **Valuation.** `estimatedValue` is recomputed from the **current catalog price of `ACTIVE`
  products** (`meta.valuation: 'CURRENT_CATALOG_PRICE'`). A stored or client-submitted cart
  price is never treated as authoritative; lines whose product is archived, draft, or deleted
  contribute nothing. Repricing a product changes the estimate, which is the intended meaning
  of "what this cart is worth to recover today".
- **Shape.** `{ cartId, customer: { id, name, email } | null, itemCount, distinctItems,
estimatedValue, currency, lastActivityAt, ageHours, createdAt, updatedAt }`. Only
  operational customer identity is exposed.
- **Anonymous carts: DEFERRED.** `Cart.user` is required, so guest carts are not persistently
  identifiable in the current model. Rather than fabricate anonymous identities, they are
  excluded and left for a future guest-cart-persistence decision.
- Recovery campaigns (emails, discounts, scheduling) are out of scope.

## 12. Sales and revenue formulas

`GET /api/v1/admin/sales/dashboard` accepts either `range=7d|30d|90d` **or** both `from` and
`to`; anything else is a 400. All figures are scoped to `createdAt` within the window.

| Figure              | Definition                                                                     |
| ------------------- | ------------------------------------------------------------------------------ |
| `orders`            | Count of orders created in range, any status                                   |
| `grossSales`        | `Σ order.total` for orders created in range, any status                        |
| `realizedRevenue`   | `Σ order.total` where `orderStatus = DELIVERED` **and** `paymentStatus = PAID` |
| `refunds`           | `Σ refund.amount` for refunds created in range with `status ≠ FAILED`          |
| `netSales`          | `grossSales − refunds`                                                         |
| `averageOrderValue` | `avg(order.total)` over orders created in range                                |
| `cancelledOrders`   | Count where `orderStatus = CANCELLED`                                          |
| `returnedOrders`    | Count where `orderStatus ∈ {RETURN_REQUESTED, RETURN_APPROVED, RETURNED}`      |
| `topProducts`       | Top 10 order-item groups by summed quantity, with summed `lineSubtotal`        |
| `recentOrders`      | 10 most recent orders (safe fields only)                                       |

Deliberate consequences:

- **Unpaid COD is never realized revenue.** A `DELIVERED` order whose cash was never collected
  stays `UNPAID` and contributes to `grossSales` only.
- **Cancelled orders are never realized revenue.** They contribute to `grossSales` and to
  `cancelledOrders`, never to `realizedRevenue`.
- **`FAILED` refunds are excluded** from `refunds`, matching the `refundedTotal` headroom that
  a failed refund releases.

`GET /api/v1/admin/sales/analytics` reports `salesByDate` (per-day `orders`, `grossSales`,
`realizedRevenue` using the same `DELIVERED + PAID` condition) and `statusBreakdown` from the
same aggregates.

## 13. Security posture for this phase

- Every `/api/v1/admin/*` route requires a current `SUPER_ADMIN` Bearer token: no token → 401,
  customer token → 403, in that order, before any handler logic.
- Customer order, tracking, invoice, invoice PDF, cancel, return, and refund reads are scoped
  by `customer: <caller>` **inside the database query**. Another customer's order is a `404`,
  not a `403`, so existence is not disclosed.
- All request bodies and query strings are strict Zod allowlists. `customer`, `total`,
  `subtotal`, `discount`, `shipping`, `orderStatus`, `paymentStatus`, `statusHistory`,
  `orderNumber`, `invoiceNumber`, `refundedTotal`, `refundNumber`, `returnNumber`,
  `reviewedBy`, `resolution`, `idempotencyKey`, `createdAt` and similar server-owned fields are
  rejected with `400 VALIDATION_ERROR` wherever a client might try to set them.
- Malformed ids are rejected by a `^[a-f\d]{24}$` param schema, so no `CastError`, Mongo driver
  message, index name, or stack trace reaches a client.
- Rejected and unauthorized operations write **no** business audit events; audit records exist
  only for operations that actually succeeded.

## 14. Deferred in Phase D

- Payment provider integration (selection still TBD / NOT CONFIRMED).
- Google Login (approved for MansooriKart, deliberately not implemented in this phase).
- Anonymous/guest abandoned carts (not persistently identifiable).
- Automatic restock of returned goods (requires physical inspection; explicit adjustment only).
- Any frontend surface for invoices, PDFs, dashboards, or abandoned carts.
