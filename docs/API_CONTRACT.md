# MansooriKart Core API Contract

All v1 endpoints return `{ "success": true, "data": ... }`; product lists also return pagination `meta`. Errors return `{ "success": false, "error": { "code", "message" }, "requestId" }`.

## Authentication

The official v1 header is `Authorization: Bearer <JWT>`. Registration accepts name, email and password and always creates `CUSTOMER`. Login issues a 48-hour JWT. Forgot-password responses are generic; reset tokens are hashed, expiring and single-use.

## Profile and addresses

`GET /api/v1/me` returns the authenticated user. `PATCH /api/v1/me` accepts only name, phone and HTTPS avatar. Email, roles, password and internal/security fields are rejected.

Addresses use `/api/v1/me/addresses`. Ownership is scoped in each database query. Marking an address default unsets only the caller's other default; deleting the default promotes the caller's most recently updated remaining address.

## Catalog

Categories, brands and products are public active-only reads. Products support page, limit (1–100), search (escaped and bounded to 80 characters), category, brand, price bounds, featured and whitelisted sorting (`newest`, `price_asc`, `price_desc`, `rating`). Product detail accepts a slug or valid Mongo ObjectId.

## Super Admin core and catalog

All `/api/v1/admin/*` endpoints require a current `SUPER_ADMIN` Bearer token. `GET /api/v1/admin/dashboard` returns real product, order, customer, low-stock, recent-order, and realized-revenue data. Realized revenue counts only `DELIVERED` orders with `PAID` payment status; unpaid COD, cancelled, and failed orders are excluded. The bounded dashboard analytics endpoints accept only `range=7d|30d|90d`.

`GET /api/v1/admin/audit-logs` supports safe pagination and action, resource type, actor, and date filters. It serializes safe audit fields only. `GET /api/v1/admin/system/health` returns status, database connection state, uptime, environment name, and optional application version without configuration values or credentials.

Admin catalog CRUD/archive routes are implemented for products, categories, brands, product types, generic attributes/values, and product badges. Product DELETE archives rather than physically removes a record. Product create/update uses strict request allowlists, escaped/bounded search, whitelisted sorting, safe pagination, and stable duplicate codes (`PRODUCT_SKU_EXISTS`, `SLUG_EXISTS`). Public catalog serializers never return cost price, stock, SEO, audit data, or admin-only status fields.

Size and color are generic `CatalogAttribute` kinds. Weight is deferred because the current sellable Product is the sole inventory authority. Product bases and product variants are deferred: the current cart, checkout, order snapshot, and inventory contract is product-level and is not variant-aware, so adding independent variant stock now would create conflicting inventory authorities. Product media metadata is implemented through `images` (`url`, `alt`, `position`, `isPrimary`); binary storage and provider selection remain deferred.

## Inventory ERP

Warehouse-aware inventory uses `InventoryBalance` as the target stock authority, keyed by product, warehouse, and location. Available stock is server-derived as on-hand minus reserved; launch reservations are zero/deferred. `Product.stock` is retained only as a service-maintained compatibility mirror. Existing products are lazily and idempotently backfilled into the default `MAIN` warehouse and `PRIMARY` location when inventory is first used.

Super Admin inventory APIs support warehouse/location CRUD and archival, balances, stock detail/listing, safe movement history, explicit adjustments, and idempotent transfers. Mutations use strict request allowlists and emit AuditLog records. Transfers require `Idempotency-Key`, reject self-transfers and insufficient source availability, preserve total stock, and produce immutable paired transfer movements. Online checkout fulfils from the default warehouse.

## Not implemented yet

CSV and expanded OpenAPI are deferred.

## Commerce foundation

Cart and wishlist require `Authorization: Bearer <JWT>`. Cart writes accept only product IDs and positive integer quantities. Cart prices and subtotals are recalculated from current products and cart operations do not reserve or decrement stock. Guest merge has a **partial** policy: duplicate guest lines are aggregated; each infeasible item is omitted and returned with an issue code, while feasible items are merged.

Coupon preview accepts only a code and recalculates the authenticated user's cart subtotal. Codes normalize to uppercase. Percentage and fixed discounts use two-decimal rounding, honour dates, enabled state, minimums, limits and maximum discount, and cannot reduce the subtotal below zero. Preview does not increment usage. `perCustomerLimit` is stored but enforcement is deferred until checkout creates persisted redemption history.

Inventory adjustments are Super Admin-only and require a non-zero integer delta and bounded reason. The inventory service performs conditional atomic decrements and records previous/new stock in `InventoryMovement`; it compensates stock if ledger persistence fails. Low-stock and out-of-stock endpoints aggregate available inventory (`quantityOnHand - quantityReserved`) across all balances for a product: low stock is `0 < available <= lowStockThreshold` (default 5), while out of stock is `available <= 0`. Real-Mongo HTTP verification covers compensation and one-unit competing-decrement cases.

Super Admin coupon DELETE is a soft archive: the record remains and `enabled` becomes false. Admin inventory/coupon mutations write safe AuditLog records.

## Checkout and orders

`POST /api/v1/checkout` accepts only a saved `addressId`, optional `couponCode`, and `paymentMethod: CASH_ON_DELIVERY`; an `Idempotency-Key` header is required. Items, prices, stock, totals, and order number are server-derived. COD begins `UNPAID`; shipping is PKR 250 below discounted PKR 5,000 and free otherwise; tax is currently zero.

Checkout revalidates and consumes coupons only after an Order persists, records per-customer redemptions, and compensates inventory on failure. Cancellation is allowed from `PENDING` and `CONFIRMED`, restores stock exactly once, and does not restore coupon eligibility. Admin transitions are `PENDING→CONFIRMED/CANCELLED`, `CONFIRMED→PROCESSING/CANCELLED`, `PROCESSING→SHIPPED`, `SHIPPED→DELIVERED`; COD payment collection is `UNPAID→PAID`.

Checkout also persists a server-generated `invoiceNumber` and fires a post-commit order confirmation email. See [ORDERS_SALES_ARCHITECTURE.md](./ORDERS_SALES_ARCHITECTURE.md) for the full state machines and invariants.

## Reviews and ratings

`GET /api/v1/products/:productId/reviews` is public and returns only `PUBLISHED` reviews with pagination and whitelisted `newest`, `oldest`, `highest-rating`, or `lowest-rating` sorting. Public entries expose only review ID, rating, title, body, verified-purchase flag, creation time, and reviewer display name—never email, credentials, addresses, order/payment details, moderation metadata, or audit data.

Authenticated customers create reviews with only `rating`, optional `title`, and `body`. Ratings are integer 1–5; title is 1–120 trimmed characters when supplied; body is 3–2,000 trimmed characters. Product identity comes from the route, customer identity and mutation ownership come from the JWT, and only `ACTIVE` products are reviewable. Customer PATCH accepts the same editable fields; DELETE physically removes only the caller's persisted review.

There is one review per customer/product. A compound unique database index on `customer + product` is initialized before review writes and is the race-safe authority; duplicate attempts return `409 REVIEW_EXISTS` without exposing Mongo duplicate-key details. `verifiedPurchase` is server-derived: it is true only if the customer has a persisted `DELIVERED` Order containing the product; non-purchasers may still review with the flag false.

Reviews begin `PUBLISHED`. Super Admin may use `PATCH /api/v1/admin/reviews/:reviewId/status` with only `status` (`PUBLISHED` or `HIDDEN`) and `reason`; moderation is audited. Hidden reviews are excluded from public results and product aggregates. `ratingAverage` (rounded to two decimals) and `ratingCount` are server-maintained from published reviews and recalculated after create, edit, delete, hide, and republish. All review inputs are strict allowlists and use the standard v1 error envelope.

## Orders and sales ERP

Full design notes live in [ORDERS_SALES_ARCHITECTURE.md](./ORDERS_SALES_ARCHITECTURE.md).

`GET /api/v1/admin/orders` is Super Admin-only with a strict query allowlist: pagination, `orderNumber` (upper-cased exact), `customer` (exact email or name lookup — never a regex), `orderStatus`, `paymentStatus`, `paymentMethod`, `from`/`to`, `minAmount`/`maxAmount`, and whitelisted `sort`/`direction`. Operator objects and unknown keys are rejected with `VALIDATION_ERROR` before reaching Mongo; `__proto__` keys are stripped by the query parser and neither filter nor pollute. Order detail populates the customer as `name` and `email` only. Malformed IDs return `400 VALIDATION_ERROR` and unknown IDs `404 ORDER_NOT_FOUND`, with no `CastError`, driver text, or stack trace.

Cancellation is claimed with a single atomic conditional update before any restock, so a simultaneous customer and admin cancellation produces exactly one success, one `CANCELLATION` movement, one restored balance, and one audit record. Repeat cancellations return `400 ORDER_NOT_CANCELLABLE` and touch no inventory.

Returns require a `DELIVERED` order and follow `REQUESTED→APPROVED|REJECTED`, `APPROVED→RECEIVED`, `RECEIVED→COMPLETED`. Quantities are reserved against the purchased snapshot through `ReturnAllocation`, so the same unit cannot be claimed twice. **A return never restores sellable inventory**: no stage performs a restock and no `RETURN` movement is written. Returned units re-enter stock only through an explicit audited Inventory ERP adjustment after inspection.

Refunds are Super Admin-only ledger records; no payment provider is called. `POST /api/v1/admin/orders/:orderId/refunds` requires an `Idempotency-Key` and accepts only `amount`, `reason`, and optional `returnId`. A unique compound index on `(order, idempotencyKey)` is the durable idempotency authority: sequential and concurrent replays return one refund, and a replay cannot smuggle a different amount. The sum of non-`FAILED` refunds can never exceed `order.total`, enforced atomically by reserving headroom on `Order.refundedTotal` with an `$expr` conditional `$inc` before the refund is written; the loser of a cap race receives `400 REFUND_AMOUNT_INVALID`. Headroom is released on insert failure, duplicate key, and `FAILED` status.

Invoices are projections of the immutable order snapshot — product documents are never consulted, so post-purchase renames or repricing cannot alter a historical invoice. `invoiceNumber` is server-generated at checkout as `INV-<orderNumber>`, persisted, never client-settable, and never regenerated. `GET /api/v1/orders/:orderId/invoice` and `/invoice.pdf` are scoped to the caller's own orders (404 otherwise); the `/api/v1/admin/orders/:orderId` equivalents serve any order and expose the customer as `id`, `name`, `email` only. The `.pdf` routes return real pdfkit-rendered PDF bytes with `Content-Type: application/pdf`, an attachment `Content-Disposition` naming the invoice number, and an accurate `Content-Length`.

Order confirmation email is provider-agnostic; **no provider is integrated and no credentials are required**. The default adapter records intent only, and production wiring just calls `setEmailAdapter`. Delivery is a post-commit side effect that never throws: a provider outage is recorded as a safe bounded failure while the order, inventory, audit record, and emptied cart remain committed. The message is exactly `{ to, subject, template, data }` with `ORDER_CONFIRMATION` content built from the order snapshot — never passwords, JWTs, reset tokens, secrets, or the internal user object.

`GET /api/v1/admin/abandoned-carts` derives abandoned carts from persisted `Cart` documents with no duplicated data: at least one item and inactive past a threshold (default 24 hours, 1–2160 overridable). `estimatedValue` is recomputed from the current catalog price of `ACTIVE` products (`meta.valuation: CURRENT_CATALOG_PRICE`); a stored cart price is never authoritative. Anonymous carts are **deferred** because `Cart.user` is required and guest carts are not persistently identifiable — no anonymous identity is fabricated.

`GET /api/v1/admin/sales/dashboard` accepts either `range=7d|30d|90d` or both `from` and `to`. `grossSales` sums `order.total` for all orders in range; `realizedRevenue` sums only `DELIVERED` **and** `PAID` orders, so unpaid COD and cancelled orders are never realized revenue; `refunds` sums non-`FAILED` refunds in range; `netSales` is gross minus refunds. `GET /api/v1/admin/sales/analytics` reports per-day series and status breakdown from the same aggregates.

## Customers ERP

Full design notes live in [CUSTOMERS_ERP_ARCHITECTURE.md](./CUSTOMERS_ERP_ARCHITECTURE.md).

There is **no duplicate customer collection**. A customer is the existing `User` document with `role: CUSTOMER`; the ERP is a read model over the existing `Order`, `Address`, `Cart`, `Wishlist`, `Review`, `ReturnRequest`, and `Refund` architecture. Refunds carry no customer reference and are reached through the customer's own orders, so a refund cannot be attributed to the wrong account.

Only `name`, `email`, `phone`, `avatar`, `role`, `status`, `createdAt`, and `updatedAt` ever leave the ERP. Aggregation uses an explicit inclusive `$project` allowlist rather than relying on `select: false`, so password hashes, reset-token hashes, reset expiry, JWT material, and `__v` are structurally unable to appear in any response.

Statistics are real aggregates over `orders` and are never stored or client-supplied: `totalOrders` and `grossSpend` count every status, while `realizedSpend` sums only `DELIVERED` **and** `PAID` orders — the same condition as the sales dashboard, so lifetime value and realized revenue cannot disagree. Segments (`PROSPECT`, `NEW`, `REPEAT`, `VIP`, `AT_RISK`) are derived read-only reporting labels; nothing acts on them and no campaign, email, SMS, or push mechanism is attached.

`GET /api/v1/admin/customers` uses a strict query allowlist (pagination, `search`, `status`, `role`, `segment`, `hasOrders`, `from`/`to`, whitelisted `sort`/`direction`); `search` is regex-escaped so an operator-looking value matches literally, and unknown keys are `400 VALIDATION_ERROR`. `GET /api/v1/admin/customers/:id` returns a 360° view (statistics, addresses, recent orders, cart/wishlist summaries, reviews, returns, refunds). Malformed IDs are `400 VALIDATION_ERROR` and unknown IDs `404 CUSTOMER_NOT_FOUND`, with no `CastError` or driver text.

`PATCH /api/v1/admin/customers/:id/status` is the **only** mutation, and its strict body is exactly `{ status: ACTIVE|SUSPENDED, reason? }`. Suspending a `SUPER_ADMIN` or the caller's own account is `409 CUSTOMER_STATUS_FORBIDDEN`; a no-op is `409 CUSTOMER_STATUS_UNCHANGED`; both write no audit record. The write is a conditional `findOneAndUpdate` scoped to `role: CUSTOMER` and the observed status. `requireAuth` rejects a suspended user's existing token, so suspension takes effect immediately.

**Customer ERP is not a privilege-escalation path.** No generic `PATCH /api/v1/admin/customers/:id` route exists, `role` is absent from every schema in the router, no admin route anywhere writes `User.role`, and public registration always creates `CUSTOMER` even when a role is submitted.

## Purchasing ERP

Full design notes live in [PURCHASING_ARCHITECTURE.md](./PURCHASING_ARCHITECTURE.md).

Suppliers are an operational contact record only — **no bank account, IBAN, card, or portal credential field, and no supplier login**. `paymentTerms` (`PREPAID`, `COD`, `NET_7|15|30|45|60`) is descriptive, not a settlement instruction. Codes are uppercased and unique (`409 SUPPLIER_CODE_TAKEN`); DELETE archives rather than removes and is refused with `409 SUPPLIER_HAS_OPEN_ORDERS` while open purchase orders exist. Purchase orders may only be raised against an `ACTIVE` supplier.

Purchase orders move `DRAFT→PENDING_APPROVAL→APPROVED` and then through receiving; only `DRAFT` is editable (`409 PURCHASE_ORDER_NOT_EDITABLE`). `poNumber` is server-generated (`PO-YYYYMMDD-XXXXXX`) and never client-settable; `total`, `subtotal`, `status`, `statusHistory`, and every receiving counter are server-owned and rejected by the strict allowlists. Totals are always recomputed from lines, each product may appear once per order (`PURCHASE_ITEMS_DUPLICATED`), and neither creation nor approval moves stock.

`POST /api/v1/admin/purchase-orders/:id/receipts` requires an `Idempotency-Key` (8–128 chars, else `400 IDEMPOTENCY_KEY_REQUIRED`) and is eligible only for `APPROVED` or `PARTIALLY_RECEIVED` orders (`409 PURCHASE_ORDER_NOT_RECEIVABLE`). Line capacity is claimed for every requested line in a single `$expr` conditional update, so a mixed-validity multi-line receipt applies nothing and concurrent receipts can never jointly exceed the ordered quantity; over-receipt is `409 PURCHASE_RECEIPT_QUANTITY_INVALID` whether caught pre-flight or in the race, while a zero-quantity line is `400`. Unique compound indexes on `(purchaseOrder, idempotencyKey)` are the durable idempotency authority for receipts and returns: a first application is `201`, any replay is `200` returning the original document, a replay carrying a different body still returns the stored one, and three simultaneous same-key requests produce exactly one document.

**Only accepted received quantity increases stock**, and only through the existing inventory service (`type: PURCHASE_RECEIPT`, `referenceType: PurchaseOrder`). `InventoryBalance` remains the authority, `Product.stock` remains a synchronized mirror, and no purchasing code writes stock directly. Rejected units are recorded and never enter inventory; completeness is measured against delivered quantity (accepted + rejected).

If inventory succeeds but receipt persistence or the audit write fails, the operation is fully compensated — inventory reversed, receipt document deleted, line capacity released, status recomputed — so **no phantom inventory is ever left behind**, and the compensating reversal is retained in the movement ledger rather than hidden. Failures surface as `500 PURCHASE_RECEIPT_AUDIT_FAILED` / `PURCHASE_RETURN_AUDIT_FAILED`, and the same idempotency key succeeds once the fault clears.

**Purchase returns are IMPLEMENTED, not deferred.** They are eligible only for `PARTIALLY_RECEIVED`, `RECEIVED`, or `CLOSED` orders, capped per line at `quantityAccepted - quantityReturned` (`409 PURCHASE_RETURN_QUANTITY_INVALID`) and capped again by the inventory service's non-negative balance guard (`INSUFFICIENT_STOCK`, surfaced as `409`, persisting nothing). No supplier refund, credit note, payable adjustment, or financial settlement is implied or recorded.

A purchase order with any received units cannot be cancelled (`409 PURCHASE_ORDER_NOT_CANCELLABLE`), enforced both before the transition table and as a filter condition on the atomic update; historical received inventory is never erased.

**Cost price policy is `LATEST_PURCHASE_COST`**: `Product.costPrice` becomes the latest accepted unit cost, with `previousCostPrice` recorded per receipt line and `costPriceSynced` on the receipt. **FIFO, LIFO, weighted average, and standard costing are explicitly NOT implemented** — there are no cost layers and no revaluation of existing stock. The sync is non-fatal; a failure flags the receipt instead of reverting physically received goods.

`GET /api/v1/admin/purchasing/dashboard` and `/reports` (`groupBy=supplier|product|date`) are live aggregates over suppliers, purchase orders, receipts, and returns — no fabricated numbers. `committedValue` and `receivedValue` are procurement commitments and goods-in values, declared as `basis: PROCUREMENT_COMMITMENT_AND_GOODS_IN`; they are **not** expenses, payables, cost of goods sold, or profit inputs, and no such field is returned. Expense ledger, accounts payable, supplier payment, profit and loss, and accounting journals are deferred to a later Finance phase.

Audit records exist only for operations that actually succeeded (`SUPPLIER_CREATED`, `SUPPLIER_UPDATED`, `SUPPLIER_ARCHIVED`, `PURCHASE_ORDER_CREATED`, `PURCHASE_ORDER_UPDATED`, `PURCHASE_ORDER_<STATUS>`, `PURCHASE_GOODS_RECEIVED`, `PURCHASE_RETURN_CREATED`); refused cancels, rejected transitions, and unauthorized calls write nothing. No `CastError`, driver message, index name, or stack trace is ever returned.
