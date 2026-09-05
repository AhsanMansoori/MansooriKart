# MansooriKart API Inventory

| Method       | Path                               | Access | Purpose                   | Implemented | Tested                 | Frontend needed |
| ------------ | ---------------------------------- | ------ | ------------------------- | ----------- | ---------------------- | --------------- |
| GET          | `/api/v1/health`                   | Public | TypeScript runtime health | Yes         | Legacy regression      | Later           |
| POST         | `/api/v1/auth/register`            | Public | Customer registration     | Yes         | Legacy regression      | Later           |
| POST         | `/api/v1/auth/login`               | Public | Bearer JWT login          | Yes         | Legacy regression      | Later           |
| POST         | `/api/v1/auth/forgot-password`     | Public | Generic reset initiation  | Yes         | Legacy regression      | Later           |
| POST         | `/api/v1/auth/reset-password`      | Public | Secure password reset     | Yes         | Legacy regression      | Later           |
| GET/PATCH    | `/api/v1/me`                       | Bearer | Own profile               | Yes         | Pending v1 integration | Later           |
| GET/POST     | `/api/v1/me/addresses`             | Bearer | Own address list/create   | Yes         | Pending v1 integration | Later           |
| PATCH/DELETE | `/api/v1/me/addresses/:id`         | Bearer | Own address update/delete | Yes         | Pending v1 integration | Later           |
| GET          | `/api/v1/categories`, `/:slug`     | Public | Active categories         | Yes         | Pending v1 integration | Later           |
| GET          | `/api/v1/brands`, `/:slug`         | Public | Active brands             | Yes         | Pending v1 integration | Later           |
| GET          | `/api/v1/products`, `/:identifier` | Public | Active catalog            | Yes         | Pending v1 integration | Later           |

Supplier CSV **import** is implemented in the TypeScript v1 runtime — see "CSV catalog import" below. Data and report **export** (CSV download, XLSX, scheduled delivery) and expanded OpenAPI remain outside it.

## Super Admin core and catalog additions

| Method             | Path                            | Access      | Purpose                                          | Implemented | Tested          | Frontend needed |
| ------------------ | ------------------------------- | ----------- | ------------------------------------------------ | ----------- | --------------- | --------------- |
| GET                | `/api/v1/admin/dashboard`       | Super Admin | Real KPI, recent orders, low stock, paid revenue | Yes         | Real-Mongo HTTP | Later           |
| GET                | `/api/v1/admin/dashboard/sales` | Super Admin | Bounded realized-revenue aggregate               | Yes         | Real-Mongo HTTP | Later           |
| GET                | `/api/v1/admin/audit-logs`      | Super Admin | Safe paginated audit listing                     | Yes         | Real-Mongo HTTP | Later           |
| GET                | `/api/v1/admin/system/health`   | Super Admin | Safe operational health                          | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/products`        | Super Admin | Product management; DELETE archives              | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/categories`      | Super Admin | Category management; DELETE archives             | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/brands`          | Super Admin | Brand management; DELETE archives                | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/product-types`   | Super Admin | Nullable/backfillable product-type management    | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/attributes`      | Super Admin | Generic attributes with controlled values        | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/badges`          | Super Admin | Reusable product badge management                | Yes         | Real-Mongo HTTP | Later           |

Product bases, sellable variants, independent variant inventory, provider-backed media uploads, and expanded OpenAPI are deferred. No legacy `/api/*` route was modified.

## Commerce foundation additions

| Method                | Path                                                                   | Access      | Purpose                                            | Implemented | Tested          | Frontend needed |
| --------------------- | ---------------------------------------------------------------------- | ----------- | -------------------------------------------------- | ----------- | --------------- | --------------- |
| GET                   | `/api/v1/cart`                                                         | Bearer      | Server-derived cart                                | Yes         | Real-Mongo HTTP | Later           |
| POST/PATCH/DELETE     | `/api/v1/cart/items`                                                   | Bearer      | Cart item mutation                                 | Yes         | Real-Mongo HTTP | Later           |
| POST                  | `/api/v1/cart/merge`                                                   | Bearer      | Partial guest-cart merge                           | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/DELETE       | `/api/v1/wishlist` and `/items`                                        | Bearer      | Owned wishlist                                     | Yes         | Real-Mongo HTTP | Later           |
| POST                  | `/api/v1/coupons/validate`                                             | Bearer      | Server-cart coupon preview                         | Yes         | Real-Mongo HTTP | Later           |
| GET/POST              | `/api/v1/admin/inventory`, `/adjust`                                   | Super Admin | Inventory queries/adjustment                       | Yes         | Real-Mongo HTTP | Later           |
| GET                   | `/api/v1/admin/inventory/low-stock`, `/out-of-stock`, `/:id/movements` | Super Admin | Balance-aggregated stock alerts and ledger history | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DELETE | `/api/v1/admin/coupons`                                                | Super Admin | Coupon management; DELETE disables                 | Yes         | Real-Mongo HTTP | Later           |
| POST                  | `/api/v1/checkout`                                                     | Customer    | Authoritative COD checkout                         | Yes         | Real-Mongo HTTP | Later           |
| GET/POST              | `/api/v1/orders`, `/:orderId/cancel`                                   | Customer    | Own orders and cancellation                        | Yes         | Real-Mongo HTTP | Later           |
| GET/PATCH             | `/api/v1/admin/orders`                                                 | Super Admin | Order management/statuses                          | Yes         | Real-Mongo HTTP | Later           |
| GET                   | `/api/v1/products/:productId/reviews`                                  | Public      | Published product reviews                          | Yes         | Real-Mongo HTTP | Later           |
| POST                  | `/api/v1/products/:productId/reviews`                                  | Customer    | Create one own product review                      | Yes         | Real-Mongo HTTP | Later           |
| PATCH/DELETE          | `/api/v1/reviews/:reviewId`                                            | Owner       | Edit/delete own review                             | Yes         | Real-Mongo HTTP | Later           |
| GET                   | `/api/v1/admin/reviews`                                                | Super Admin | Moderation review list                             | Yes         | Real-Mongo HTTP | Later           |
| PATCH                 | `/api/v1/admin/reviews/:reviewId/status`                               | Super Admin | Publish/hide a review                              | Yes         | Real-Mongo HTTP | Later           |

## Warehouse-aware inventory ERP

All routes below require a current Super Admin Bearer token. Stock mutations use
strict request allowlists, write immutable movement records, and write safe audit
records. `Product.stock` is a compatibility mirror; `InventoryBalance` is the
warehouse-aware authority.

| Method             | Path                                         | Purpose                                                                   |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------- |
| GET                | `/api/v1/admin/inventory/dashboard`          | Aggregate inventory KPIs, including product-level low/out-of-stock counts |
| GET                | `/api/v1/admin/inventory/stock`, `/:id`      | Paginated balance list and product stock detail                           |
| GET/POST/PATCH/DEL | `/api/v1/admin/inventory/warehouses`, `/:id` | Warehouse list, CRUD, and archival                                        |
| GET/POST/PATCH/DEL | `/api/v1/admin/inventory/locations`, `/:id`  | Warehouse-owned location list, CRUD, and archival                         |
| POST               | `/api/v1/admin/inventory/adjustments`        | Audited non-zero integer stock correction                                 |
| POST               | `/api/v1/admin/inventory/transfers`          | Idempotent warehouse/location transfer; requires `Idempotency-Key`        |
| GET                | `/api/v1/admin/inventory/movements`          | Safe paginated movement history with product, reference, and date filters |
| GET                | `/api/v1/admin/inventory/low-stock`          | Products with aggregate `0 < available <= lowStockThreshold`              |
| GET                | `/api/v1/admin/inventory/out-of-stock`       | Products with aggregate `available <= 0`                                  |

Online checkout and cancellation use the default `MAIN` warehouse and `PRIMARY`
location. Reservation is deferred, so available quantity currently equals on-hand
quantity.

## Orders and sales ERP

Design notes: [ORDERS_SALES_ARCHITECTURE.md](./ORDERS_SALES_ARCHITECTURE.md).

| Method | Path                                           | Access      | Purpose                                                | Implemented | Tested          | Frontend needed |
| ------ | ---------------------------------------------- | ----------- | ------------------------------------------------------ | ----------- | --------------- | --------------- |
| GET    | `/api/v1/orders/:orderId/tracking`             | Customer    | Own order status timeline                              | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/orders/:orderId/invoice`              | Customer    | Own immutable invoice projection                       | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/orders/:orderId/invoice.pdf`          | Customer    | Own invoice as real pdfkit PDF bytes                   | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/orders/:orderId/returns`              | Customer    | Return request against a `DELIVERED` order             | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/returns`, `/:id`                      | Customer    | Own return list and detail                             | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/refunds`                              | Customer    | Refunds on own orders                                  | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/orders`                         | Super Admin | Filtered, sorted, paginated order list                 | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/orders/:orderId`                | Super Admin | Order detail with safe customer identity               | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/orders/:orderId/status`         | Super Admin | Audited order status transition                        | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/orders/:orderId/payment-status` | Super Admin | Audited COD collection / payment state                 | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/orders/:orderId/cancel`         | Super Admin | Atomic cancellation, restock exactly once              | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/orders/:orderId/invoice`        | Super Admin | Any order's immutable invoice                          | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/orders/:orderId/invoice.pdf`    | Super Admin | Any order's invoice as real PDF bytes                  | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/returns`, `/:id`                | Super Admin | Return list and detail                                 | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/returns/:id/status`             | Super Admin | Audited return workflow; no automatic restock          | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/orders/:orderId/refunds`        | Super Admin | Idempotent, cap-safe refund record                     | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/refunds`, `/:id`                | Super Admin | Refund list and detail                                 | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/refunds/:id/status`             | Super Admin | Refund state; `FAILED` releases refund headroom        | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/abandoned-carts`                | Super Admin | Carts derived from persisted `Cart`, current valuation | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/sales/dashboard`                | Super Admin | Gross, realized, refunds, net, AOV, top products       | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/sales/analytics`                | Super Admin | Per-day series and status breakdown                    | Yes         | Real-Mongo HTTP | Later           |

Payment provider integration, Google Login, anonymous/guest abandoned carts, and
automatic restock of returned goods are deferred. No legacy `/api/*` route and no
frontend application code was modified.

## Customers ERP

Design notes: [CUSTOMERS_ERP_ARCHITECTURE.md](./CUSTOMERS_ERP_ARCHITECTURE.md).

| Method | Path                                 | Access      | Purpose                                               | Implemented | Tested          | Frontend needed |
| ------ | ------------------------------------ | ----------- | ----------------------------------------------------- | ----------- | --------------- | --------------- |
| GET    | `/api/v1/admin/customers`            | Super Admin | Filtered, sorted, paginated customers with real stats | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/customers/analytics`  | Super Admin | Totals, segment counts, top customers                 | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/customers/:id`        | Super Admin | 360° view over existing domain collections            | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/customers/:id/orders` | Super Admin | Paginated order history                               | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/customers/:id/status` | Super Admin | Audited `ACTIVE` ⇄ `SUSPENDED`; the only mutation     | Yes         | Real-Mongo HTTP | Later           |

No duplicate customer collection was created, no admin route writes `User.role`, and there is
deliberately no generic `PATCH /api/v1/admin/customers/:id`. Customer groups, loyalty tiers,
marketing campaigns, and GDPR erasure/export are deferred.

## Purchasing ERP

Design notes: [PURCHASING_ARCHITECTURE.md](./PURCHASING_ARCHITECTURE.md).

| Method | Path                                         | Access      | Purpose                                                   | Implemented | Tested          | Frontend needed |
| ------ | -------------------------------------------- | ----------- | --------------------------------------------------------- | ----------- | --------------- | --------------- |
| GET    | `/api/v1/admin/suppliers`                    | Super Admin | Filtered, sorted, paginated supplier list                 | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/suppliers`                    | Super Admin | Create supplier; no banking or credential fields          | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/suppliers/:id`                | Super Admin | Supplier with open-order count and goods-in value         | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/suppliers/:id`                | Super Admin | Update supplier                                           | Yes         | Real-Mongo HTTP | Later           |
| DELETE | `/api/v1/admin/suppliers/:id`                | Super Admin | Archive; refused while purchase orders are open           | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/suppliers/:id/performance`    | Super Admin | Real order, receiving, and return statistics              | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/purchase-orders`              | Super Admin | List by status, supplier, warehouse, product, date, total | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/purchase-orders`              | Super Admin | Create `DRAFT`; server-computed totals and `poNumber`     | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/purchase-orders/:id`          | Super Admin | Detail with receipts and supplier returns                 | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/purchase-orders/:id`          | Super Admin | Edit `DRAFT` only                                         | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/purchase-orders/:id/submit`   | Super Admin | → `PENDING_APPROVAL`                                      | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/purchase-orders/:id/approve`  | Super Admin | → `APPROVED`; moves no stock                              | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/purchase-orders/:id/cancel`   | Super Admin | → `CANCELLED`; blocked once goods are received            | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/purchase-orders/:id/close`    | Super Admin | → `CLOSED`                                                | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/purchase-orders/:id/receipts` | Super Admin | Idempotent goods receipt; accepted units increase stock   | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/purchase-orders/:id/receipts` | Super Admin | Receipts for one purchase order                           | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/goods-receipts`, `/:id`       | Super Admin | Receipt list and detail                                   | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/purchase-orders/:id/returns`  | Super Admin | Idempotent supplier return; decreases stock               | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/purchase-returns`             | Super Admin | Supplier return list                                      | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/purchasing/dashboard`         | Super Admin | Live procurement aggregates; no accounting semantics      | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/purchasing/reports`           | Super Admin | Grouped by supplier, product, or date                     | Yes         | Real-Mongo HTTP | Later           |

`InventoryBalance` remains the stock authority and `Product.stock` remains its synchronized
mirror; only accepted received quantity increases stock, and only through the existing
inventory service. Purchase returns are implemented (not deferred). Cost price policy is
`LATEST_PURCHASE_COST` — FIFO, LIFO, weighted average, and standard costing are explicitly not
implemented. The expense ledger and profit-and-loss statement listed as deferred here landed in
the Finance phase below; accounts payable, supplier payment, supplier refunds, accounting
journals, payment providers, supplier portals/logins, and all purchasing frontend surfaces
remain deferred. No legacy `/api/*` route and no frontend application code was modified in this
phase.

## Finance ERP

Design notes: [FINANCE_ARCHITECTURE.md](./FINANCE_ARCHITECTURE.md).

| Method | Path                                | Access      | Purpose                                                          | Implemented | Tested          | Frontend needed |
| ------ | ----------------------------------- | ----------- | ---------------------------------------------------------------- | ----------- | --------------- | --------------- |
| GET    | `/api/v1/admin/expenses`            | Super Admin | Whitelisted filter, sort, and pagination over the expense ledger | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/expenses`            | Super Admin | Create `DRAFT`; server owns `expenseNumber` and `totalAmount`    | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/expenses/summary`    | Super Admin | Range totals by status and category                              | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/expenses/:id`        | Super Admin | Expense detail with status history                               | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/expenses/:id`        | Super Admin | Edit `DRAFT` only; amounts immutable once approved               | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/expenses/:id/status` | Super Admin | `SUBMITTED` / `APPROVED` / `VOIDED`; void replaces deletion      | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/finance/dashboard`   | Super Admin | Revenue, refunds, COGS, expenses, profit for one window          | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/finance/analytics`   | Super Admin | Daily revenue, refund, expense, and tax series                   | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/finance/profit-loss` | Super Admin | Operating statement; not audited net income                      | Yes         | Real-Mongo HTTP | Later           |

`financeService` owns every money formula, so no endpoint invents its own arithmetic. Realized
revenue is `DELIVERED` **and** `PAID` order totals only — a cancelled order and an unpaid COD
order are both excluded. Refunds in any status except `FAILED` reduce revenue. COGS reads the
immutable `Order.items.lineCost` snapshot under the `LATEST_PURCHASE_COST` basis, so later
`Product.costPrice` edits cannot rewrite history. Only `APPROVED` expenses reach operating
profit; `DRAFT`, `SUBMITTED`, and `VOIDED` never do, and raising or approving a purchase order
still creates no expense. A dedicated `Payment` collection is deliberately deferred because
`Order.paymentStatus` plus `Refund` records are sufficient for a COD launch. No double-entry
ledger, chart of accounts, journal entry, balance sheet, accounts-payable aging, payroll, or
depreciation exists, and no payment provider is integrated.

## Reporting ERP

Design notes: [REPORTING_ARCHITECTURE.md](./REPORTING_ARCHITECTURE.md).

| Method | Path                                        | Access      | Purpose                                                        | Implemented | Tested          | Frontend needed |
| ------ | ------------------------------------------- | ----------- | -------------------------------------------------------------- | ----------- | --------------- | --------------- |
| GET    | `/api/v1/admin/reports`                     | Super Admin | Self-describing index; declares export unavailable             | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/reports/sales`               | Super Admin | Revenue, refunds, units, status mix, daily trend, top products | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/reports/products`            | Super Admin | Per-product revenue, COGS, profit, returns, stock posture      | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/reports/inventory`           | Super Admin | Point-in-time stock, availability, valuation; takes no range   | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/reports/inventory-movements` | Super Admin | Ledger activity grouped by type, date, or product              | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/reports/customers`           | Super Admin | Acquisition, repeat rate, per-customer spend                   | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/reports/orders`              | Super Admin | Fulfilment mix, cancellation rate, ship and deliver timing     | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/reports/purchases`           | Super Admin | Commitment, receiving, acceptance, outstanding, returns        | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/reports/finance`             | Super Admin | The finance figures in report shape                            | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/reports/profit`              | Super Admin | Profitability by summary, date, product, or category           | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/reports/tax`                 | Super Admin | Sales tax recorded, expense tax recorded, net position         | Yes         | Real-Mongo HTTP | Later           |

Every report is a Mongo aggregation — no handler loads a collection into JavaScript to reduce
it. Windowed reports cap at 366 days and row reports cap at 100 rows per page, so no request can
ask for an unbounded result. Sort keys, `groupBy` dimensions, filters, and search terms are fixed
vocabularies; search input is regex-escaped, so `.*` matches literally. Sales, product, profit,
order, customer, finance, and tax figures read order and purchase-order snapshots and therefore
do not move when the catalogue or a supplier is edited; inventory valuation
(`LATEST_PURCHASE_COST`) and supplier display labels are the two deliberate current-value views.
`InventoryBalance` is the only stock authority — no report reads `Product.stock`. Report **export**
— CSV download, XLSX generation, scheduled report delivery — remains deferred, which the report
index states machine-readably; the supplier CSV **import** below is inbound catalog data and gives
no report a download. No report writes data, and no reporting warehouse, materialised summary
collection, or rollup job was created.

## CSV catalog import

Design notes: [CSV_CATALOG_IMPORT_ARCHITECTURE.md](./CSV_CATALOG_IMPORT_ARCHITECTURE.md).

| Method | Path                                            | Access      | Purpose                                                   | Implemented | Tested          | Frontend needed |
| ------ | ----------------------------------------------- | ----------- | --------------------------------------------------------- | ----------- | --------------- | --------------- |
| GET    | `/api/v1/admin/catalog-imports/mapping-targets` | Super Admin | Mapping targets, required fields, overwritable set        | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/catalog-imports`                 | Super Admin | Raw CSV upload; parses and stores rows, writes no product | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/catalog-imports/:id/mapping`     | Super Admin | Confirm column mapping; optional pricing-rule opt-in      | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/catalog-imports/:id/preview`     | Super Admin | Exactly what the import would do; writes nothing          | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/catalog-imports/:id/import`      | Super Admin | Atomically claimed run; creates `DRAFT` products only     | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/catalog-imports/:id/cancel`      | Super Admin | Cancel a job that has not run                             | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/catalog-imports`                 | Super Admin | Job list by supplier, status, and date                    | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/catalog-imports/:id`             | Super Admin | Job detail with counters and honest completion status     | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/catalog-imports/:id/rows`        | Super Admin | Paginated per-row outcome, changes, and issues            | Yes         | Real-Mongo HTTP | Later           |

Every product an import creates is `DRAFT`, and no mapping target reaches `Product.status` or
`Product.price` — **a supplier file can neither publish a product nor set its selling price**.
Bounds are declared in `config/dropshipping.ts` (5 MiB, 5,000 rows, 60 columns, 20 preview rows,
500-document batches); an unsupported content type is `415 CSV_CONTENT_TYPE_UNSUPPORTED` and an
oversize body is `413 REQUEST_BODY_TOO_LARGE`. No upload or CSV dependency was added — the parser
is `src/utils/csv.ts`. Image URLs are validated and never fetched. A supplier stock change writes
no `InventoryMovement`, so the warehouse ledger still describes only owned goods. Supplier portals
and logins, supplier API/EDI feeds, scheduled or automatic imports, XLSX and JSON import formats,
image downloading or rehosting, and all import frontend surfaces are deferred. No legacy `/api/*`
route and no frontend application code was modified.

## Pricing

Design notes: [PRICING_ARCHITECTURE.md](./PRICING_ARCHITECTURE.md).

| Method | Path                                      | Access      | Purpose                                               | Implemented | Tested          | Frontend needed |
| ------ | ----------------------------------------- | ----------- | ----------------------------------------------------- | ----------- | --------------- | --------------- |
| POST   | `/api/v1/admin/pricing-rules`             | Super Admin | Create a markup/floor/rounding rule                   | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/pricing-rules`             | Super Admin | The rule book, in engine resolution order             | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/pricing-rules/:id`         | Super Admin | One rule                                              | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/pricing-rules/:id`         | Super Admin | Amend a rule; `null` clears a scope field             | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/pricing-rules/:id/disable` | Super Admin | Retire a rule; the engine stops seeing it             | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/pricing-rules/:id/enable`  | Super Admin | Reinstate a rule                                      | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/pricing/preview`           | Super Admin | Proposed prices and gross margin; writes nothing      | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/pricing/apply`             | Super Admin | Write the proposal in one `bulkWrite`; never `status` | Yes         | Real-Mongo HTTP | Later           |

The engine computes a **suggestion**; writing `Product.price` is always an explicit caller act.
Rule selection is deterministic (scope specificity, then `priority`, then age, then id), so the
same product and cost always resolve to the same rule and two rules can never tie. Markup, then
the `minimumProfit` floor, then `END_99` rounding — which is skipped when it would breach the
floor — so **a computed price is never below cost**. A manually set price is preserved unless
`includeOverridden: true` is sent, and it is reported as `PRICE_MANUALLY_OVERRIDDEN` rather than
quietly changed. Targets cap at 1,000 and an empty target set is `400 PRICING_TARGETS_REQUIRED`,
so the whole catalogue cannot be repriced by omission. Margin is labelled `gross merchandise
margin` and appears only on Super Admin surfaces. Currency conversion (all amounts are PKR),
competitor and dynamic repricing, scheduled repricing runs, per-customer and per-channel price
lists, tax-inclusive rules, and all pricing frontend surfaces are deferred.

## Dropshipping and publication

Design notes: [DROPSHIPPING_ARCHITECTURE.md](./DROPSHIPPING_ARCHITECTURE.md).

| Method | Path                                                      | Access      | Purpose                                              | Implemented | Tested          | Frontend needed |
| ------ | --------------------------------------------------------- | ----------- | ---------------------------------------------------- | ----------- | --------------- | --------------- |
| GET    | `/api/v1/admin/supplier-sources`                          | Super Admin | Sourcing records with cost, stock, and freshness     | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/supplier-sources/:id`                      | Super Admin | One sourcing record                                  | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/products/:productId/supplier-sources`      | Super Admin | Every supplier offering one product                  | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/dropship-fulfillments/cancellation-policy` | Super Admin | What cancelling means at each status                 | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/dropship-fulfillments`                     | Super Admin | List by supplier, status, order, and date            | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/admin/dropship-fulfillments/:id`                 | Super Admin | Detail with timeline and allowed transitions         | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/dropship-fulfillments/:id`                 | Super Admin | Atomically advance status; record tracking and notes | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/products/publish-preview`                  | Super Admin | Per-product publishability verdict; writes nothing   | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/products/:id/publish`                      | Super Admin | Publish one product through the validation gate      | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/products/publish`                          | Super Admin | Bulk publish, capped at 200 unique ids               | Yes         | Real-Mongo HTTP | Later           |
| POST   | `/api/v1/admin/products/archive`                          | Super Admin | Bulk archive, capped at 200 unique ids               | Yes         | Real-Mongo HTTP | Later           |

There is one canonical `Product`; `fulfillmentType: OWN_STOCK | DROPSHIP` says how a line is
fulfilled and no parallel catalogue was created. Supplier stock lives only in
`SupplierCatalogItem`, is advisory, and **never touches `InventoryBalance`** — a dropship line
reserves, decrements, and restores nothing, and writes no `InventoryMovement`. Sourcing records
are read-only over HTTP because cost and stock arrive from a supplier file rather than being typed
in. Checkout creates one fulfilment per supplier under the order's `Idempotency-Key`, unique on
`{ order, supplier }`; there is deliberately **no route that creates a fulfilment by hand**, and
fulfilment status is independent of `Order.orderStatus`. Publication is enforced in the service
layer, so creating or patching a product into `ACTIVE` passes the same gate as the publish route,
and no import, pricing run, or fulfilment transition can publish anything. Customer-facing
payloads never expose `fulfillmentType`, supplier identity, `supplierCost`, `unitCost`, or margin.
Supplier logins and portals, supplier API/EDI transmission, supplier stock webhooks, carrier
tracking lookups, supplier invoicing, payouts, commission and margin settlement, multi-currency
supplier costs, and all dropshipping frontend surfaces are deferred. No legacy `/api/*` route and
no frontend application code was modified.

## Marketing and merchandising

Design notes: [MARKETING_ARCHITECTURE.md](./MARKETING_ARCHITECTURE.md).

| Method   | Path                                    | Access      | Purpose                                            | Implemented | Tested          | Frontend needed |
| -------- | --------------------------------------- | ----------- | -------------------------------------------------- | ----------- | --------------- | --------------- |
| GET      | `/api/v1/admin/coupons`                 | Super Admin | Paged coupon list with derived lifecycle state     | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/coupons`                 | Super Admin | Create a coupon on the existing coupon authority   | Yes         | Real-Mongo HTTP | Later           |
| GET      | `/api/v1/admin/coupons/:id`             | Super Admin | One coupon with its derived state                  | Yes         | Real-Mongo HTTP | Later           |
| GET      | `/api/v1/admin/coupons/:id/usage`       | Super Admin | Redemption statistics from order snapshots         | Yes         | Real-Mongo HTTP | Later           |
| PATCH    | `/api/v1/admin/coupons/:id`             | Super Admin | Edit a coupon; never rewrites order snapshots      | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/coupons/:id/activate`    | Super Admin | Enable; idempotent, no duplicate audit             | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/coupons/:id/disable`     | Super Admin | Disable; idempotent, no duplicate audit            | Yes         | Real-Mongo HTTP | Later           |
| DELETE   | `/api/v1/admin/coupons/:id`             | Super Admin | Soft archive; record and redemptions retained      | Yes         | Real-Mongo HTTP | Later           |
| GET/POST | `/api/v1/admin/promotions`              | Super Admin | Merchandising promotion list and create            | Yes         | Real-Mongo HTTP | Later           |
| GET      | `/api/v1/admin/promotions/:id`          | Super Admin | One promotion                                      | Yes         | Real-Mongo HTTP | Later           |
| PATCH    | `/api/v1/admin/promotions/:id`          | Super Admin | Edit a promotion; no discount authority            | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/promotions/:id/activate` | Super Admin | Move to `ACTIVE`; idempotent                       | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/promotions/:id/archive`  | Super Admin | Move to `ARCHIVED`; idempotent                     | Yes         | Real-Mongo HTTP | Later           |
| DELETE   | `/api/v1/admin/promotions/:id`          | Super Admin | Soft archive                                       | Yes         | Real-Mongo HTTP | Later           |
| GET/POST | `/api/v1/admin/banners`                 | Super Admin | Banner list and create with structured links       | Yes         | Real-Mongo HTTP | Later           |
| GET      | `/api/v1/admin/banners/:id`             | Super Admin | One banner                                         | Yes         | Real-Mongo HTTP | Later           |
| PATCH    | `/api/v1/admin/banners/:id`             | Super Admin | Edit a banner; scheme-validated destinations       | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/banners/:id/activate`    | Super Admin | Move to `ACTIVE`; idempotent                       | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/banners/:id/archive`     | Super Admin | Move to `ARCHIVED`; idempotent                     | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/banners/reorder`         | Super Admin | Rewrite priorities from an ordered id list         | Yes         | Real-Mongo HTTP | Later           |
| DELETE   | `/api/v1/admin/banners/:id`             | Super Admin | Soft archive                                       | Yes         | Real-Mongo HTTP | Later           |
| GET      | `/api/v1/admin/homepage`                | Super Admin | Curated homepage layout with resolved references   | Yes         | Real-Mongo HTTP | Later           |
| PUT      | `/api/v1/admin/homepage`                | Super Admin | Replace the whole ordered layout                   | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/homepage/reorder`        | Super Admin | Rewrite section positions from an ordered key list | Yes         | Real-Mongo HTTP | Later           |
| PATCH    | `/api/v1/admin/homepage/sections/:key`  | Super Admin | Enable or disable one section                      | Yes         | Real-Mongo HTTP | Later           |

The existing `Coupon` model remains the **only** discount authority; these routes manage it and
never compute a discount, and `orderService` is unchanged. Editing a coupon cannot rewrite an
order's frozen `couponId`, `code`, `type`, `value` or `actualDiscount`, which a regression test
asserts. Lifecycle state is derived from `enabled`, the date window and `usageCount` rather than
stored, so it can never disagree with the coupon. `Promotion` carries no percentage, amount or
stacking field and is merchandising only; visibility is derived at read time from status and a
half-open window, so there is no scheduler. Banner and menu destinations are structured — `NONE`,
`INTERNAL_PATH`, `PRODUCT`, `CATEGORY`, `PROMOTION`, `EXTERNAL_URL` — with `http:`/`https:` only,
so `javascript:`, `data:` and `file:` are rejected, and **no URL is ever fetched server-side**. The
homepage is a closed section vocabulary with per-section caps, not a page builder, and eligibility
is applied in the query so a `DRAFT` supplier-import product cannot reach it. Email, SMS and push
campaigns, marketing automation, affiliate, loyalty and referral programmes, ad-platform
integrations, AI marketing generation, A/B testing, and all marketing frontend surfaces are
deferred. No legacy `/api/*` route and no frontend application code was modified.

## Content: CMS pages, FAQs and navigation

Design notes: [CMS_ARCHITECTURE.md](./CMS_ARCHITECTURE.md).

| Method   | Path                              | Access      | Purpose                                        | Implemented | Tested          | Frontend needed |
| -------- | --------------------------------- | ----------- | ---------------------------------------------- | ----------- | --------------- | --------------- |
| GET/POST | `/api/v1/admin/pages`             | Super Admin | Page list and create with typed content blocks | Yes         | Real-Mongo HTTP | Later           |
| GET      | `/api/v1/admin/pages/:id`         | Super Admin | One page with its blocks                       | Yes         | Real-Mongo HTTP | Later           |
| PATCH    | `/api/v1/admin/pages/:id`         | Super Admin | Edit a page                                    | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/pages/:id/publish` | Super Admin | Publish, stamping `publishedAt` once           | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/pages/:id/archive` | Super Admin | Archive, preserving `publishedAt`              | Yes         | Real-Mongo HTTP | Later           |
| DELETE   | `/api/v1/admin/pages/:id`         | Super Admin | Soft archive; slugs are never freed            | Yes         | Real-Mongo HTTP | Later           |
| GET/POST | `/api/v1/admin/faqs`              | Super Admin | FAQ list and create                            | Yes         | Real-Mongo HTTP | Later           |
| POST     | `/api/v1/admin/faqs/reorder`      | Super Admin | Rewrite positions in one `bulkWrite`           | Yes         | Real-Mongo HTTP | Later           |
| GET      | `/api/v1/admin/faqs/:id`          | Super Admin | One FAQ                                        | Yes         | Real-Mongo HTTP | Later           |
| PATCH    | `/api/v1/admin/faqs/:id`          | Super Admin | Edit an FAQ                                    | Yes         | Real-Mongo HTTP | Later           |
| DELETE   | `/api/v1/admin/faqs/:id`          | Super Admin | Soft archive                                   | Yes         | Real-Mongo HTTP | Later           |
| GET      | `/api/v1/admin/navigation`        | Super Admin | Both menus, ordered                            | Yes         | Real-Mongo HTTP | Later           |
| GET      | `/api/v1/admin/navigation/:menu`  | Super Admin | One menu (`HEADER` or `FOOTER`)                | Yes         | Real-Mongo HTTP | Later           |
| PUT      | `/api/v1/admin/navigation/:menu`  | Super Admin | Replace one menu whole                         | Yes         | Real-Mongo HTTP | Later           |

Page bodies are a bounded array of typed blocks — `HEADING`, `PARAGRAPH`, `LIST`, `QUOTE`, `IMAGE`,
`DIVIDER` — over a `.strict()` discriminated union capped at 120 blocks, so **no HTML, script,
style or template field exists to store or render**, and every text value is stripped of markup by
a transform that runs during validation rather than at render time. Slugs are unique and
lowercase; a collision is `409 PAGE_SLUG_EXISTS` from the unique index, and `publishedAt` is
stamped once and never rewritten. CMS pages hold **current** policy — the five policy documents are
ordinary pages and carry no legal versioning, because what a customer agreed to lives in that
order's own snapshot. Navigation is one singleton per menu with children bounded structurally at
one level, capped at 30 items and 20 children. References are checked for existence at write time
(`400 REFERENCE_NOT_FOUND`) and for eligibility at read time, so **draft or archived products and
unpublished pages are never serialized into a public menu** — the entry is simply absent. A draft,
archived, unknown or malformed slug all return the identical `404 PAGE_NOT_FOUND`, so unpublished
pages cannot be enumerated. A WYSIWYG or drag-and-drop editor, arbitrary HTML or template code,
scheduled publication workers, content versioning and revisions, draft previews, multi-language
content, a media library and uploads, blog or comment domains, per-page access control, nested
navigation beyond one level, and all content frontend surfaces are deferred. No legacy `/api/*`
route and no frontend application code was modified.

## Store configuration

Design notes: [STORE_CONFIGURATION_ARCHITECTURE.md](./STORE_CONFIGURATION_ARCHITECTURE.md).

| Method | Path                                 | Access      | Purpose                                            | Implemented | Tested          | Frontend needed |
| ------ | ------------------------------------ | ----------- | -------------------------------------------------- | ----------- | --------------- | --------------- |
| GET    | `/api/v1/admin/settings`             | Super Admin | The whole singleton configuration                  | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/settings/store`       | Super Admin | Store identity, currency, timezone, thresholds     | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/settings/contact`     | Super Admin | Support email, phone, address, country             | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/settings/social`      | Super Admin | Replace the social-link list; six known channels   | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/settings/seo`         | Super Admin | Meta text, canonical URL, enum `robots`, OpenGraph | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/settings/shipping`    | Super Admin | Fees, free-shipping threshold, city overrides, COD | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/settings/tax`         | Super Admin | Tax foundation; disabled by default                | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/settings/invoice`     | Super Admin | Invoice presentation only                          | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/settings/email`       | Super Admin | Notification behaviour; never credentials          | Yes         | Real-Mongo HTTP | Later           |
| PATCH  | `/api/v1/admin/settings/maintenance` | Super Admin | Maintenance mode and its safe public message       | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/store/config`               | Public      | Customer-safe configuration; served in maintenance | Yes         | Real-Mongo HTTP | Later           |

`StoreConfiguration` is one singleton pinned by a unique `key` index; `ensureStoreConfiguration()`
awaits `init()`, upserts with `$setOnInsert` and re-reads on `11000`, so **concurrent
initialisation cannot create a second document** — a test races parallel initialisers and asserts
one. Settings are typed sections with their own `.strict()` schemas and numeric bounds, never a
generic `key/value: any` store, and each PATCH diffs before writing so a no-op writes and audits
nothing. Currency defaults to **PKR** and relabels only — there is no conversion — and timezone
defaults to **Asia/Karachi** as a display clock, with every timestamp still stored in UTC so **no
historical timestamp is ever rewritten**. Shipping configuration is what checkout charges:
`quoteShipping` resolves disabled → free-shipping threshold (`>=`) → city override → standard fee,
the defaults reproduce the previous PKR 250 / free-at-5,000 behaviour exactly, **no client-supplied
shipping or tax value is read anywhere**, and an order's snapshot is never restated by a later
configuration change. Tax ships disabled so totals stay zero-tax until an operator enables it.
`codEnabled` defaults true and COD continues to work unchanged; setting it false makes checkout
answer `PAYMENT_METHOD_UNAVAILABLE`. Email settings are `.strict()`, so a body containing
`smtpPassword` or `apiKey` is `400 VALIDATION_ERROR` — **SMTP passwords and provider secrets stay
in environment/deployment secrets and are never stored in MongoDB**. Maintenance mode returns
`503 STORE_MAINTENANCE` on the seven public content routes while `/store/config`, both health
endpoints and every Super Admin route keep working. Configuration is read per request, so a change
needs no restart. Multi-currency and conversion, a tax-jurisdiction engine, per-product tax
classes, a second invoice engine, credential storage, and all settings frontend surfaces are
deferred. No legacy `/api/*` route and no frontend application code was modified.

## Public storefront content

Design notes: [CMS_ARCHITECTURE.md](./CMS_ARCHITECTURE.md), [MARKETING_ARCHITECTURE.md](./MARKETING_ARCHITECTURE.md).

| Method | Path                        | Access | Purpose                                          | Implemented | Tested          | Frontend needed |
| ------ | --------------------------- | ------ | ------------------------------------------------ | ----------- | --------------- | --------------- |
| GET    | `/api/v1/store/home`        | Public | One bounded homepage aggregation                 | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/store/navigation`  | Public | `header` and `footer` with destinations resolved | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/store/faqs`        | Public | Active FAQs, position-ordered, optional category | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/store/pages`       | Public | Published page references, title-ordered         | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/store/pages/:slug` | Public | One published page with blocks and SEO           | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/store/promotions`  | Public | Currently visible promotions                     | Yes         | Real-Mongo HTTP | Later           |
| GET    | `/api/v1/store/banners`     | Public | Currently visible banners by placement           | Yes         | Real-Mongo HTTP | Later           |

Every public payload comes from an explicit allowlist serializer, never a delete list, so a field
added to a model later stays internal until somebody publishes it deliberately. Tests assert that
these endpoints expose no `supplierCost`, `unitCost`, supplier identity, `fulfillmentType`,
`PricingRule` or `CatalogImport` data, no admin emails, no `createdBy`/`updatedBy`, no audit
metadata, no internal ids beyond what a storefront needs, and no JWT or environment configuration.
`/store/home` is a single bounded aggregation with per-section caps; ordering is server-authoritative,
disabled sections are omitted, and future-dated or expired banners and promotions are excluded by
the window in the query rather than filtered afterwards. All seven routes sit behind the
maintenance guard; `/store/config` deliberately does not, so a maintenance page can render. These
reads perform no writes and require no token, and Phase G publication rules remain intact — only
`status: 'ACTIVE'` products are ever loaded.

## System operations and audit administration

Design notes: [SYSTEM_OPERATIONS_ARCHITECTURE.md](./SYSTEM_OPERATIONS_ARCHITECTURE.md).

| Method | Path                               | Access      | Purpose                                          | Implemented | Tested                 | Frontend needed |
| ------ | ---------------------------------- | ----------- | ------------------------------------------------ | ----------- | ---------------------- | --------------- |
| GET    | `/health`                          | Public      | Liveness — `{ "status": "ok" }` and nothing more | Yes         | Real-Mongo HTTP        | Later           |
| GET    | `/api/v1/admin/audit-logs/actions` | Super Admin | Distinct action and resource-type vocabulary     | Yes         | Real-Mongo HTTP        | Later           |
| GET    | `/api/v1/admin/audit-logs/:id`     | Super Admin | One redacted audit entry                         | Yes         | Real-Mongo HTTP        | Later           |
| GET    | `/api/v1/admin/dashboard/orders`   | Super Admin | Order counts by status over a bounded range      | Yes         | Pending v1 integration | Later           |
| GET    | `/api/v1/admin/dashboard/products` | Super Admin | Product counts by status over a bounded range    | Yes         | Pending v1 integration | Later           |

`/api/v1/health`, `/api/v1/admin/audit-logs`, `/api/v1/admin/dashboard`, `/api/v1/admin/dashboard/sales`
and `/api/v1/admin/system/health` are listed in the tables above and are unchanged in shape; the
rows here complete the router's surface. The public health endpoints stay minimal by design, and
both they and every Super Admin route are exempt from maintenance mode. Admin health reports
status, database connectivity, uptime, an environment label narrowed to a three-value set, and a
version string from `APP_VERSION` falling back to `unknown`; it **never** publishes environment
variables, the Mongo URI, the JWT secret, a filesystem path or a stack trace, a disconnected
database is reported as `degraded` with a 200 rather than an error, and calling it initialises the
store-configuration singleton as a documented side effect.

**Phase H added no second audit model.** `/audit-logs` exposes three GETs and no write verb
anywhere, so records are append-only structurally rather than by policy — there is no route that
edits or deletes one. Filters are `page`, `limit`, `action`, `resourceType`, `resourceId`, `actor`,
`search`, `sort`, `from` and `to` under a `.strict()` schema: `actor` must be 24-hex, `sort` is an
enum mapped to a fixed `createdAt` direction, `search` is an escaped anchored prefix regex over
`action` only, and the date span is validated as a range capped at 366 days. Pagination is
mandatory and capped at 100. `redactAuditMetadata` runs on every returned entry, matching key names
case-insensitively as substrings and bounding strings at 512 characters, objects at 40 keys, arrays
at 20 items and recursion at depth 4, so **password hashes, JWTs, environment secrets, raw CSV
bodies, supplier credentials and sensitive headers cannot be published**; `actor` is projected as
`'name email role'`, so the password hash is never loaded at all. A malformed id returns the same
clean `404 AUDIT_LOG_NOT_FOUND` as an unknown one, never a CastError. Log shipping to an external
aggregator, metrics and tracing endpoints, alerting and incident tooling, audit retention, archival
or export, per-dependency outbound health checks, feature flags, and all operations frontend
surfaces are deferred. No legacy `/api/*` route and no frontend application code was modified.
