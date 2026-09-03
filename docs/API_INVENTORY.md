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

CSV and expanded OpenAPI remain outside the TypeScript v1 runtime.

## Super Admin core and catalog additions

| Method             | Path                                      | Access      | Purpose                                          | Implemented | Tested          | Frontend needed |
| ------------------ | ----------------------------------------- | ----------- | ------------------------------------------------ | ----------- | --------------- | --------------- |
| GET                | `/api/v1/admin/dashboard`                 | Super Admin | Real KPI, recent orders, low stock, paid revenue | Yes         | Real-Mongo HTTP | Later           |
| GET                | `/api/v1/admin/dashboard/sales`           | Super Admin | Bounded realized-revenue aggregate               | Yes         | Real-Mongo HTTP | Later           |
| GET                | `/api/v1/admin/dashboard/orders/products` | Super Admin | Bounded order/product aggregates                 | Yes         | Real-Mongo HTTP | Later           |
| GET                | `/api/v1/admin/audit-logs`                | Super Admin | Safe paginated audit listing                     | Yes         | Real-Mongo HTTP | Later           |
| GET                | `/api/v1/admin/system/health`             | Super Admin | Safe operational health                          | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/products`                  | Super Admin | Product management; DELETE archives              | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/categories`                | Super Admin | Category management; DELETE archives             | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/brands`                    | Super Admin | Brand management; DELETE archives                | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/product-types`             | Super Admin | Nullable/backfillable product-type management    | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/attributes`                | Super Admin | Generic attributes with controlled values        | Yes         | Real-Mongo HTTP | Later           |
| GET/POST/PATCH/DEL | `/api/v1/admin/badges`                    | Super Admin | Reusable product badge management                | Yes         | Real-Mongo HTTP | Later           |

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
`InventoryBalance` is the only stock authority — no report reads `Product.stock`. CSV and XLSX
export, scheduled report delivery, and the whole Import/Export ERP module are deferred, which
the report index states machine-readably. No report writes data, and no reporting warehouse,
materialised summary collection, or rollup job was created.
