# MansooriKart Finance ERP Architecture

Phase F, Part A: operating expenses, the finance dashboard, finance analytics, and the
management profit-and-loss summary. Everything below describes the implemented `/api/v1`
runtime (`backend/src/models/expense.ts`, `backend/src/services/financeService.ts`,
`backend/src/routes/v1/adminFinance.ts`). The frozen legacy `/api/*` runtime is untouched,
and no frontend was built in this phase.

## 0. What this is, and what it deliberately is not

MansooriKart finance is a **management reporting layer over facts the system already
records**. It is not an accounting package.

There is deliberately **no** double-entry general ledger, chart of accounts, journal entry,
balance sheet, bank reconciliation, accounts-payable aging, accounts-receivable ledger,
payroll, depreciation schedule, or asset register. There is no FIFO, LIFO, weighted-average,
or standard-cost inventory layer. No response claims GAAP or IFRS compliance, no figure is
called audited net income, and nothing here is tax advice or a tax return.

Every number served is a **real Mongo aggregate over real documents**. There are no seeded
percentages, no illustrative constants, and no placeholder growth figures anywhere in the
finance surface.

## 1. Expense model

`Expense` (collection `expenses`) records money MansooriKart actually spent running the
store.

| Field                                   | Notes                                                     |
| --------------------------------------- | --------------------------------------------------------- |
| `expenseNumber`                         | Server-generated `EXP-YYYYMMDD-XXXXXX`. Never client-set. |
| `category`                              | One of 15 operating categories (below).                   |
| `description`, `reference`, `notes`     | Free text, length-bounded.                                |
| `amount`, `taxAmount`, `totalAmount`    | `totalAmount` is server-derived, never submitted.         |
| `currency`                              | `PKR`.                                                    |
| `expenseDate`                           | The date the spend belongs to.                            |
| `paymentMethod`                         | `CASH`, `BANK_TRANSFER`, `CARD`, `CHEQUE`, `OTHER`.       |
| `supplier`                              | Optional counterparty link, for traceability only.        |
| `purchaseOrder`                         | Optional soft link for traceability only.                 |
| `status`                                | `DRAFT` → `APPROVED` → `VOIDED`.                          |
| `createdBy`, `approvedBy`, `approvedAt` | Server-owned.                                             |
| `voidedBy`, `voidedAt`, `voidReason`    | Server-owned.                                             |
| `statusHistory[]`                       | Append-only `{ from, to, reason, actor, requestId, at }`. |

Categories: `SHIPPING`, `WAREHOUSING`, `MARKETING`, `SOFTWARE`, `UTILITIES`, `OFFICE`,
`RENT`, `PACKAGING`, `EQUIPMENT`, `MAINTENANCE`, `PROFESSIONAL_FEES`, `BANK_CHARGES`,
`TAXES_AND_LICENSES`, `TRAVEL`, `MISCELLANEOUS`.

**There is deliberately no salary or payroll category, and no employee reference.** Payroll
is out of scope for this phase, so the schema does not invite payroll data it cannot handle
correctly.

`purchaseOrder` is a **reference, not an accrual**. Linking an expense to a purchase order
does not make the purchase order a payable, and a purchase order never creates an expense.
See §5.

### Mass assignment

Every expense route validates with a `.strict()` Zod schema, so submitting
`expenseNumber`, `createdBy`, `approvedBy`, `approvedAt`, `voidedBy`, `voidedAt`,
`totalAmount`, `status`, `statusHistory`, `createdAt`, or `updatedAt` on create or update is
`400 VALIDATION_ERROR` — not silently ignored, and never persisted.

## 2. Expense lifecycle

```
DRAFT ──approve──► APPROVED ──void──► VOIDED
  │                                     ▲
  └──────────────── void ───────────────┘
```

| Rule                                   | Behaviour                           |
| -------------------------------------- | ----------------------------------- |
| Edit a `DRAFT`                         | Allowed.                            |
| Edit an `APPROVED` or `VOIDED` expense | `409 EXPENSE_NOT_EDITABLE`.         |
| Approve anything other than a `DRAFT`  | `409 EXPENSE_NOT_APPROVABLE`.       |
| Void an already-voided expense         | `409 EXPENSE_ALREADY_VOIDED`.       |
| Void without a reason                  | `400 EXPENSE_VOID_REASON_REQUIRED`. |
| Delete an expense                      | Not implemented. Void instead.      |

**Amounts are immutable once approved (§9).** Correcting an approved expense means voiding it
and recording a corrected one, so the history of what was approved is never rewritten. There
is no destructive delete anywhere in the expense surface.

Approval is an **atomic conditional update** —
`findOneAndUpdate({ _id, status: 'DRAFT' }, …)` — so two concurrent approvals cannot both
succeed and cannot leave a contradictory `statusHistory`. The loser gets
`409 EXPENSE_NOT_APPROVABLE`. Voiding is guarded the same way.

Every accepted transition writes an `AuditLog` entry: `EXPENSE_CREATED`, `EXPENSE_UPDATED`,
`EXPENSE_APPROVED`, `EXPENSE_VOIDED`. Rejected transitions write nothing.

## 3. Revenue semantics — reused from Phase D, not redefined

`financeService.ts` is the **single owner of every money formula**. The finance dashboard,
finance analytics, profit and loss, and all nine reports call into it rather than
re-implementing arithmetic. This is what makes cross-endpoint agreement structural instead of
coincidental.

```
grossSales           = Σ Order.total                      (every order, any status)
realizedRevenue      = Σ Order.total   WHERE orderStatus = 'DELIVERED'
                                         AND paymentStatus = 'PAID'
refunds              = Σ Refund.amount WHERE status ≠ 'FAILED'
netSales             = grossSales      − refunds
netRealizedRevenue   = realizedRevenue − refunds
costOfGoodsSold      = Σ Order.items.lineCost  on realized orders only
grossProfit          = netRealizedRevenue − costOfGoodsSold
operatingExpenses    = Σ Expense.totalAmount   WHERE status = 'APPROVED'
operatingProfit      = grossProfit − operatingExpenses
grossMargin          = grossProfit     / netRealizedRevenue × 100   (null when ≤ 0)
operatingMargin      = operatingProfit / netRealizedRevenue × 100   (null when ≤ 0)
```

These are the Phase D definitions unchanged. A margin over zero revenue is reported as
`null`, not `0` — an undefined ratio is not a zero ratio.

### Order status and payment status effects

| Situation                                  | Counted as realized revenue? | Rationale                                                     |
| ------------------------------------------ | ---------------------------- | ------------------------------------------------------------- |
| `DELIVERED` + `PAID`                       | **Yes**                      | Goods delivered and cash collected.                           |
| `DELIVERED` + `UNPAID` (COD not collected) | **No**                       | Delivery is not collection. Surfaced as `unpaidCodOrders`.    |
| `PENDING` / `PROCESSING` / `SHIPPED`       | No                           | Not yet delivered.                                            |
| `CANCELLED`                                | **No**                       | Never realized. Still counted in `grossSales` and `byStatus`. |
| `REFUNDED` / partially refunded            | Realized, then reduced       | Refunds are a period fact subtracted once at summary level.   |

**Cancelled orders (§46).** A cancelled order can never satisfy
`orderStatus = 'DELIVERED'`, so it contributes nothing to `realizedRevenue`,
`netRealizedRevenue`, COGS, gross profit, or operating profit. It remains visible in
`grossSales`, in `byOrderStatus`, and in the order-count totals, because it is a real order
that was really placed. Reports state the cancelled count explicitly rather than hiding it.

**Unpaid COD (§47).** Delivery never infers payment. `updateOrderStatus` does not touch
`paymentStatus` under any circumstances. The **only** `UNPAID → PAID` path is an explicit
admin confirmation:

```
PATCH /api/v1/admin/orders/:orderId/payment-status
body: { "paymentStatus": "PAID", "reason": "Cash collected on delivery" }
audit: ORDER_PAYMENT_UPDATED
```

Until that call is made, a delivered COD order sits in the finance dashboard as
`orders.unpaidCodOrders` / `orders.unpaidCodValue` — visible, quantified, and excluded from
revenue.

### Refunds (§12)

There is exactly **one** refund collection: the existing `Refund` model from the Orders /
Returns phase. Finance does not create a parallel finance-refund record. `FAILED` refunds
never moved money and are excluded; every other status reduces revenue. The dashboard states
this as `refundsByStatus.basis = 'ALL_REFUNDS_EXCEPT_FAILED_REDUCE_REVENUE'`.

## 4. Cost of goods sold

COGS uses the **`LATEST_PURCHASE_COST`** basis established in Phase E and nothing else.

At checkout, `orderService` copies the product's current `costPrice` onto the order line as
`items.unitCost` / `items.lineCost`. That snapshot is immutable. Reports read the snapshot;
they never join to the live product. Consequently a later `Product.costPrice` change — from a
new goods receipt or a manual edit — **cannot move historical profit**. This is asserted
directly in both integration tests.

A product with no recorded cost at order time stores **no cost snapshot at all** rather than a
fabricated zero. Those lines contribute revenue but no cost, which would silently overstate
profit if it were hidden — so every COGS-bearing response carries explicit coverage:

```json
"cogsCoverage": { "linesTotal": 2, "linesWithCostSnapshot": 1, "coverage": 50, "complete": false }
```

`coverage` is `null` when there are no lines at all. `complete` is `true` only when every
realized line carries a snapshot.

**Not implemented, and not to be introduced casually:** FIFO, LIFO, weighted average,
standard costing, cost layers, or revaluation of already-sold goods.

## 5. Purchasing is not an expense (§34, §48)

Raising or approving a purchase order **creates no inventory and no operating expense**.

| Fact                          | Where it appears                                | Where it never appears |
| ----------------------------- | ----------------------------------------------- | ---------------------- |
| Ordered / committed value     | `purchasing.orderedValue`                       | `operatingExpenses`    |
| Received (accepted) value     | `purchasing.receivedValue`                      | `operatingExpenses`    |
| Outstanding commitment        | `purchasing.outstandingQuantity` / `…Value`     | `operatingExpenses`    |
| Goods actually sold           | `costOfGoodsSold`, from the order-line snapshot | —                      |
| Money spent running the store | `operatingExpenses`, from `APPROVED` expenses   | —                      |

The purchasing block is stamped
`basis: 'PURCHASE_COMMITMENT_NOT_OPERATING_EXPENSE'` and carries the note _"Ordered and
received purchase value are procurement facts. Neither is an operating expense and neither
appears in operating profit; only APPROVED Expense records do."_

Stock only moves on goods receipt, through the existing inventory service. Purchase value
becomes a cost of _goods sold_ only when the goods are actually sold, via the order-line cost
snapshot.

## 6. Expense status and realized totals (§17)

Only `APPROVED` expenses count toward `operatingExpenses`, `operatingProfit`,
`operatingMargin`, `expenseTax`, and the P&L expense block. `DRAFT` and `VOIDED` expenses are
**never** included in a realized total. They remain listable and filterable, and
`GET /expenses/summary` reports per-status counts so a draft backlog is visible without
contaminating profit.

## 7. Tax (§19)

Tax reporting is strictly **"what was recorded"**:

- `salesTax.collectedOnSales` = Σ `Order.tax` on realized orders.
- `expenseTax.total` = Σ `Expense.taxAmount` on `APPROVED` expenses.
- `netTaxPosition` = `collectedOnSales − expenseTax.total`.

No jurisdiction is determined, no rate table is applied, no exemption or registration
threshold is evaluated, no filing is produced, and no compliance with any tax regime is
claimed. Checkout currently records zero sales tax, so `collectedOnSales` is zero until tax is
configured — a faithful report, not a gap in the arithmetic.

## 8. Profit and loss (§18, §22)

`GET /finance/profit-loss` is a **management summary**, stamped
`basis: 'MANAGEMENT_PROFIT_AND_LOSS_SUMMARY'`, and it names its own exclusions rather than
implying completeness:

`CORPORATE_INCOME_TAX`, `DEPRECIATION_AND_AMORTISATION`,
`FINANCING_COSTS_AND_INTEREST`, `BANK_FEES_NOT_RECORDED_AS_EXPENSES`,
`ACCRUALS_AND_PERIOD_CUT_OFF_ADJUSTMENTS`, `INVENTORY_WRITE_DOWNS_AND_SHRINKAGE`,
`REFUND_COST_REVERSAL`.

The bottom line is `operatingProfit`. It is **not** called net income. The response carries:
_"Management summary only. Not a GAAP or IFRS financial statement, not audited net income, and
not a substitute for statutory accounting or tax filing."_

`REFUND_COST_REVERSAL` deserves a note: refunds reduce revenue but the cost of the refunded
goods is not reversed out of COGS, because a refund does not currently restock through a cost
layer. That makes gross profit conservative rather than optimistic, and it is disclosed rather
than hidden.

## 9. Payment records — deliberately deferred (§10)

**Decision: DEFER a dedicated `Payment` collection.** No payment model was created in this
phase.

Rationale: the only usable payment method is cash on delivery, and the pair
`Order.paymentStatus` + the existing `Refund` collection already records everything the
business can currently know — whether cash was collected, when, by whom (via `AuditLog`
`ORDER_PAYMENT_UPDATED`), and what went back out. A `Payment` collection would duplicate
those facts into a second place (§4) without adding information.

There is deliberately **no payment-gateway abstraction**, no provider adapter, no webhook
handler, and no settlement or capture state machine — building one now would pretend money
moves externally when it does not. The payment provider remains **TBD / NOT CONFIRMED**; no
Payoneer, Stripe, PayPal, or other SDK is present in `package.json`. When a provider is
confirmed, the natural shape is a `Payment` record per collection attempt referencing the
order, with `Order.paymentStatus` remaining the derived summary — but that is a later phase.

## 10. Range contract

Every windowed finance endpoint resolves its range through one function, `resolveRange`, so
the rules cannot drift per endpoint.

| Input                                  | Result                            |
| -------------------------------------- | --------------------------------- |
| `range=7d\|30d\|90d\|180d\|365d`       | Window ending now. Default `30d`. |
| `from` + `to` (ISO)                    | Explicit window.                  |
| Both a named range and `from`/`to`     | `400 RANGE_INVALID`               |
| Only one of `from` / `to`              | `400 RANGE_INVALID`               |
| `from` after `to`                      | `400 RANGE_INVALID`               |
| Span over 366 days                     | `400 RANGE_TOO_LARGE`             |
| Unparseable date, unknown named range  | `400 VALIDATION_ERROR`            |
| Any unknown query key, operator object | `400 VALIDATION_ERROR`            |

`maxRangeDays` (366) is advertised in the response so a client never has to discover the limit
by being rejected.

## 11. Error contract

| Code                               | Status | Meaning                                    |
| ---------------------------------- | ------ | ------------------------------------------ |
| `AUTH_UNAUTHORIZED`                | 401    | No or invalid token.                       |
| `AUTH_FORBIDDEN`                   | 403    | Authenticated but not `SUPER_ADMIN`.       |
| `VALIDATION_ERROR`                 | 400    | Schema rejection, including unknown keys.  |
| `RANGE_INVALID`                    | 400    | Semantically impossible window.            |
| `RANGE_TOO_LARGE`                  | 400    | Window over `maxRangeDays`.                |
| `AMOUNT_RANGE_INVALID`             | 400    | `minAmount` above `maxAmount`.             |
| `EXPENSE_NOT_FOUND`                | 404    | Unknown or malformed expense id.           |
| `EXPENSE_SUPPLIER_NOT_FOUND`       | 404    | Bad `supplier` link on create/update.      |
| `EXPENSE_PURCHASE_ORDER_NOT_FOUND` | 404    | Bad `purchaseOrder` link on create/update. |
| `EXPENSE_NOT_EDITABLE`             | 409    | Not a `DRAFT`.                             |
| `EXPENSE_NOT_APPROVABLE`           | 409    | Not a `DRAFT` (or lost an approval race).  |
| `EXPENSE_ALREADY_VOIDED`           | 409    | Terminal state.                            |
| `EXPENSE_VOID_REASON_REQUIRED`     | 400    | Void with no reason.                       |

No response body ever contains a `CastError`, a `ValidationError`, a driver message, an
`E11000` string, a raw `ObjectId`, a Mongo URI, or a stack trace. A malformed id — including a
malformed `purchaseOrder` reference — is a clean `404`, never a 500 (§25, §50).

## 12. Performance and indexes (§51, §52)

Every aggregate runs **in the database**. No finance or report handler loads a collection into
JavaScript and reduces it there, and no handler issues one query per row. The two places that
need per-row detail (`products` report stock and returns) issue exactly two bounded queries for
the current page only.

Indexes added in this phase, each backing a real query pattern:

| Collection | Index                              | Serves                                       |
| ---------- | ---------------------------------- | -------------------------------------------- |
| `expenses` | `{ expenseNumber: 1 }` unique      | Number lookup and collision safety.          |
| `expenses` | `{ status: 1, expenseDate: -1 }`   | Realized-expense windows and status listing. |
| `expenses` | `{ category: 1, expenseDate: -1 }` | Category breakdowns.                         |
| `expenses` | `{ expenseDate: 1 }`               | Unfiltered date windows.                     |
| `expenses` | `{ supplier: 1 }`                  | Counterparty filter.                         |
| `expenses` | `{ purchaseOrder: 1 }`             | Traceability filter and §48 assertions.      |
| `orders`   | `{ createdAt: -1 }`                | Every windowed revenue aggregate.            |
| `refunds`  | `{ createdAt: -1 }`                | Windowed refund aggregates.                  |
| `users`    | `{ role: 1, createdAt: -1 }`       | Customer acquisition counts.                 |

`status` and `category` are deliberately **not** indexed on their own: each is already the
prefix of a compound index, so a separate single-field index would only add write cost. No
redundant index was added elsewhere either — `orders` already indexed `customer`,
`orderNumber`, `orderStatus`, and `paymentStatus`, and those were left alone rather than
duplicated into compound variants no query needs.

## 13. Endpoints

All routes are `/api/v1/admin/...`, all require `SUPER_ADMIN`, and all are additive — the
legacy `/api/*` surface is frozen and unchanged.

| Method  | Path                   | Purpose                                          |
| ------- | ---------------------- | ------------------------------------------------ |
| `GET`   | `/expenses`            | Paginated, whitelist-filtered expense list.      |
| `GET`   | `/expenses/summary`    | Counts and totals by status and category.        |
| `GET`   | `/expenses/:id`        | One expense with its status history.             |
| `POST`  | `/expenses`            | Create a `DRAFT`.                                |
| `PATCH` | `/expenses/:id`        | Edit a `DRAFT`.                                  |
| `PATCH` | `/expenses/:id/status` | Approve or void.                                 |
| `GET`   | `/finance/dashboard`   | Headline finance figures plus period comparison. |
| `GET`   | `/finance/analytics`   | Revenue, cost, and tax time series.              |
| `GET`   | `/finance/profit-loss` | Management P&L summary.                          |

See [REPORTING_ARCHITECTURE.md](./REPORTING_ARCHITECTURE.md) for the report family, and
[API_CONTRACT.md](./API_CONTRACT.md) for full request and response shapes.
