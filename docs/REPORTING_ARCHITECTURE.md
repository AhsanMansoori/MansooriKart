# MansooriKart Reporting ERP Architecture

Phase F, Part B: the Super Admin report family. Everything below describes the implemented
`/api/v1` runtime (`backend/src/routes/v1/adminReports.ts`, backed by
`backend/src/services/financeService.ts`). The removed legacy `/api/*` runtime has no active consumer.
There is no reports UI, no chart, no P&L page, and
no CSV download screen.

Money definitions live in [FINANCE_ARCHITECTURE.md](./FINANCE_ARCHITECTURE.md). This document
covers the report surface: what each report answers, how it is bounded, and why the numbers
cannot disagree with each other.

## 0. Design rules

1. **One formula owner.** Every revenue, refund, COGS, and profit figure comes from
   `financeService`. No report re-implements arithmetic, so no report can contradict another.
2. **Database aggregation only.** No handler loads a collection into JavaScript to reduce it,
   and no handler runs a query per row. Every report is a Mongo aggregation pipeline.
3. **Bounded by construction.** Windowed reports cap at 366 days; row reports paginate at a
   maximum of 100 rows per page. There is no way to ask for an unbounded result.
4. **Whitelists, never passthrough.** Sort keys, group-by dimensions, filters, and search are
   fixed vocabularies. Nothing from the query string ever becomes a database path.
5. **Real aggregates only.** No fabricated percentage, no illustrative constant, no
   placeholder trend.
6. **History is read, not joined.** Sales figures come from immutable order-line snapshots, so
   editing the catalogue cannot rewrite the past.

## 1. The reports

`GET /api/v1/admin/reports` is a self-describing index. All ten reports below are
`SUPER_ADMIN`-only.

| Report                         | Answers                                                           | Windowed | Paginated    |
| ------------------------------ | ----------------------------------------------------------------- | -------- | ------------ |
| `/reports/sales`               | Revenue, refunds, units, status mix, daily trend, top products.   | Yes      | No           |
| `/reports/products`            | Per-product revenue, COGS, profit, returns, live stock posture.   | Yes      | Yes          |
| `/reports/inventory`           | Stock on hand, availability, valuation, coverage.                 | **No**   | Yes          |
| `/reports/inventory-movements` | Ledger activity summarised by type, date, or product.             | Yes      | Yes          |
| `/reports/customers`           | Acquisition, repeat rate, per-customer spend.                     | Yes      | Yes          |
| `/reports/orders`              | Fulfilment mix, cancellation rate, ship/deliver timing.           | Yes      | No           |
| `/reports/purchases`           | Commitment, receiving, acceptance, outstanding, supplier returns. | Yes      | No           |
| `/reports/finance`             | The finance figures in report shape.                              | Yes      | No           |
| `/reports/profit`              | Profitability by summary, date, product, or category.             | Yes      | When grouped |
| `/reports/tax`                 | Sales tax recorded, expense tax recorded, net position.           | Yes      | No           |

### Why the inventory report takes no date range

Stock on hand is a **point-in-time fact**. Accepting `from`/`to` would imply a historical
stock reconstruction that the movement ledger does not currently support, so a `range`,
`from`, or `to` parameter is rejected as an unknown key (`400 VALIDATION_ERROR`) rather than
silently ignored. The response carries `asOf` instead.

## 2. Cross-report consistency (§43)

For any one window, these must be mathematically identical, and the integration test asserts
it across three named ranges:

| Figure              | Endpoints that must agree                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `realizedRevenue`   | `/finance/dashboard`, `/reports/finance`, `/reports/sales`, `/reports/profit`, `/finance/profit-loss` |
| `refunds`           | the same five                                                                                         |
| `netSales`          | `/finance/dashboard`, `/reports/finance`, `/reports/sales`, `/finance/profit-loss`                    |
| `grossSales`        | `/reports/finance`, `/reports/sales`                                                                  |
| `costOfGoodsSold`   | `/reports/finance`, `/reports/profit`, `/finance/profit-loss`                                         |
| `grossProfit`       | the same three                                                                                        |
| `operatingProfit`   | the same three                                                                                        |
| sales tax collected | `/reports/tax`, `/finance/profit-loss`, `/finance/dashboard`                                          |

The Phase D sales dashboard (`GET /dashboard/sales`) is included: summing its per-day
`revenue` and `orders` must land exactly on `realizedRevenue` and `realizedOrders`. That is
the guard against silently redefining numbers an existing screen already shows (§3).

### Differences that are real, and why

Three pairs of numbers legitimately differ. Each is intentional, documented, and asserted, so
a future change cannot quietly turn one of them into a bug:

| Pair                                                               | Why they differ                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary `grossProfit` vs the daily `grossProfit` in `byDate`       | Refunds are a **period** fact, subtracted once from the summary. Per-day rows are `realizedRevenue − COGS` with no refund allocation, because a refund cannot be honestly attributed to the day the original sale happened.                                                         |
| Order-level `realizedRevenue` vs line-level `realizedRevenue`      | Order level is `Σ order.total`, which includes shipping and tax. Line level is `Σ items.lineSubtotal`, which is goods only.                                                                                                                                                         |
| `topSuppliers[].committedValue` vs `purchaseOrders.committedValue` | `topSuppliers` ranks all non-`CANCELLED` purchase orders including `DRAFT`, because an operator ranking suppliers wants the full picture. `committedValue` counts only live statuses (`APPROVED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CLOSED`), because a draft is not a commitment. |

Similarly, `purchaseOrders.total` and `byStatus` include `DRAFT` rows — a draft is a real
document worth seeing — while every **money** figure derived from purchase orders is
live-status only.

## 3. Historical immutability (§15, §44)

Sales, product, profit, order, customer, finance, and tax reports read **snapshots**:

- `Order.items.name`, `.sku`, `.unitPrice`, `.lineSubtotal` — captured at checkout.
- `Order.items.unitCost`, `.lineCost` — the COGS snapshot, `LATEST_PURCHASE_COST` basis.
- `PurchaseOrder.items.unitCost`, `.lineSubtotal`, `.total` — captured at line construction.
- `GoodsReceipt.items.unitCost`, `.acceptedValue` — captured at receipt.

The integration test renames a product, triples its `price`, changes its `costPrice`, renames
the supplier and changes its code and payment terms — then re-fetches ten report views and
asserts each response is **byte-identical** to the pre-change body.

Two things deliberately **do** move, and are asserted to move:

1. **Inventory valuation.** `/reports/inventory` is a _current replacement-cost_ view of goods
   still on hand, so a new purchase cost must change `stockValue` and `retailValue`. Unit
   counts must not change. This is stamped `valuationBasis: 'LATEST_PURCHASE_COST'` and is
   explicitly **not** FIFO, LIFO, weighted average, or a historical cost layer.
2. **Supplier labels.** `topSuppliers[].supplier.name` / `.code` follow the current supplier
   record, because they identify a counterparty rather than state an amount. The money on the
   same row does not move.

## 4. Stock authority

Every availability figure in every report is aggregated from **`InventoryBalance`**
(`quantityOnHand − quantityReserved`), summed across locations.

`Product.stock` is a service-maintained compatibility mirror for the frozen legacy API and is
**never read** by a report. See [INVENTORY_ARCHITECTURE.md](./INVENTORY_ARCHITECTURE.md).

## 5. Range contract

Identical to finance, because it is the same `resolveRange` function.

| Input                                 | Result                            |
| ------------------------------------- | --------------------------------- |
| `range=7d\|30d\|90d\|180d\|365d`      | Window ending now. Default `30d`. |
| `from` + `to` (ISO)                   | Explicit window.                  |
| Both a named range and `from`/`to`    | `400 RANGE_INVALID`               |
| Only one of `from` / `to`             | `400 RANGE_INVALID`               |
| `from` after `to`                     | `400 RANGE_INVALID`               |
| Span over `maxRangeDays` (366)        | `400 RANGE_TOO_LARGE`             |
| Unparseable date, unknown named range | `400 VALIDATION_ERROR`            |

A span of exactly 366 days is accepted; the boundary is inclusive. `maxRangeDays` is
advertised in every windowed response.

## 6. Sorting, grouping, filtering, searching

Nothing from the query string reaches Mongo as a field path or an operator.

| Report                         | `sort`                                                        | Other vocabularies                                        |
| ------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------- |
| `/reports/products`            | `unitsSold`, `grossRevenue`, `realizedRevenue`, `grossProfit` | `direction`, `search`                                     |
| `/reports/inventory`           | `available`, `stockValue`, `name`                             | `filter` = `all` / `low-stock` / `out-of-stock`, `search` |
| `/reports/customers`           | `realizedSpend`, `grossSpend`, `orders`                       | `direction`                                               |
| `/reports/inventory-movements` | —                                                             | `groupBy` = `type` / `date` / `product`                   |
| `/reports/profit`              | —                                                             | `groupBy` = `summary` / `date` / `product` / `category`   |

A real Mongo field name that is not on the list (`_id`, `createdAt`, `price`, `costPrice`,
`$natural`, `password`, `__proto__`) is rejected exactly like nonsense. Every sort is tie-broken
by `_id` so paging is stable.

**Search is literal-safe (§41).** User input is escaped with
`value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` before it becomes a `RegExp`, so `.*`, `^Report`,
`.+`, `(alpha|beta)`, `RPT-[AB]`, and `\w+` match **literally** and return no rows rather than
selecting the whole collection.

Because every query schema is `.strict()` with per-field coercion:

- Unknown keys (`status`, `customer`, `fields`, `select`, `sortBy`, `skip`, `perPage`) →
  `400 VALIDATION_ERROR`.
- Operator objects (`from[$gt]`, `search[$ne]`, `page[$gt]`, `sort[$ne]`) → `400`, because
  Express parses them into real objects and the schema rejects non-primitives.
- Prototype-pollution attempts (`__proto__[polluted]`, `constructor[prototype][polluted]`)
  cannot reach `Object.prototype`, whether the parser drops the key or the schema rejects it.

## 7. Pagination

Row-style reports share one envelope:

```json
"meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3,
          "hasNextPage": true, "hasPreviousPage": false,
          "from": "…", "to": "…", "days": 30 }
```

`limit` defaults to 20 and is capped at 100. `limit=0`, `limit=101`, `page=0`, a negative
page, a fractional page, and a non-numeric page are all `400 VALIDATION_ERROR`. A page past
the end is an empty `data` array with a truthful `total` — not an error and not a wrapped
result.

`/reports/profit` is only row-style once grouped by `product` or `category`; its `summary` and
`date` views are single documents and carry the range meta instead of a page meta rather than
pretending to be paginated.

## 8. Null versus zero

A ratio with no denominator is reported as `null`, never as `0`, so an empty window is never
mistaken for a bad one: `grossMargin`, `operatingMargin`, `repeatRate`, `fulfilmentRate`,
`cancellationRate`, `acceptanceRate`, per-product `grossMargin`, and `cogsCoverage.coverage`
all behave this way. Counts and sums are real zeroes.

## 9. Export — deferred (§42)

The Import/Export ERP module is **not** implemented. The report index says so machine-readably
rather than leaving a client to guess:

```json
"export": { "available": false,
            "reason": "The Import/Export ERP module, including CSV export and scheduled delivery, is deferred to a later phase." }
```

There is no CSV endpoint, no XLSX generation, no scheduled report delivery, and no download UI.

## 10. Error contract

`AUTH_UNAUTHORIZED` (401) with no token, `AUTH_FORBIDDEN` (403) for a `CUSTOMER`, success for
`SUPER_ADMIN` — asserted for all eleven report paths. Every failure is
`{ success: false, error: { code, message } }` with a stable code.

No response body ever contains a `CastError`, a `ValidationError`, an `E11000` string, a raw
`ObjectId`, a Mongo URI, a `BSON` reference, or a stack trace.

## 11. What reports deliberately do not do

- No second copy of ERP data. Reports aggregate the live collections; there is no reporting
  warehouse, no materialised summary collection, and no nightly rollup job to fall out of sync
  (§27, §31).
- No writes. Every report endpoint is read-only, which is why there are no concurrency tests
  for them; the concurrency guarantees that matter are on expense approval and voiding (§55).
- No forecasting, no anomaly detection, no attribution modelling, no cohort projection.
- No `netIncome`, no GAAP or IFRS claim, no audited statement, no tax filing.

## 12. Test coverage

`backend/tests/reports-erp.integration.test.ts` seeds a dataset built so that every semantic
distinction is provable rather than coincidental: a realized order, a delivered-but-unpaid COD
order, a cancelled order, a legacy line with **no** cost snapshot, a completed refund, a failed
refund, an approved return, a live purchase order, a draft purchase order, a goods receipt with
a rejection, a supplier return, stock across two locations, six movement types, and three
expenses in three different statuses.

It covers all of §54: each of the nine data reports plus the index, date filtering,
authorization, safe sorting, pagination, and cross-report consistency — together with range
security, operator rejection, prototype-pollution safety, literal-safe search, historical
immutability, and the refund-status effect.
