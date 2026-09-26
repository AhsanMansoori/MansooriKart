# MansooriKart Purchasing / Procurement ERP Architecture

Phase E, Part B: suppliers, purchase orders, goods receipt, supplier returns, and procurement
reporting. Everything below describes the implemented `/api/v1` runtime
(`backend/src/services/purchasingService.ts`, `backend/src/routes/v1/adminPurchasing.ts`). The
removed legacy `/api/*` runtime has no active consumer.

**Inventory authority is unchanged.** `InventoryBalance` remains the stock authority,
`Product.stock` remains a service-maintained compatibility mirror, and `MAIN` / `PRIMARY`
remains the default destination. Purchasing never writes stock itself — every unit goes
through the existing inventory service (`adjustStock`). See
[INVENTORY_ARCHITECTURE.md](./INVENTORY_ARCHITECTURE.md).

## 1. Supplier model

`Supplier` (collection `suppliers`) is an **operational contact record only**:
`name`, unique uppercased `code`, `contactName`, `email`, `phone`, address fields, `taxId`,
`paymentTerms`, `leadTimeDays`, `currency`, `notes`, `status`.

**There is deliberately no bank account, IBAN, card, or portal credential field, and no
supplier login.** Procurement in this phase records who supplies goods, not how they are paid;
`paymentTerms` is descriptive text (`PREPAID`, `COD`, `NET_7|15|30|45|60`), not a settlement
instruction. Submitting an unknown field such as `bankAccount` is `400 VALIDATION_ERROR`
because every supplier schema is `.strict()`.

`DELETE /api/v1/admin/suppliers/:id` is an **archive, never a hard delete** — historical
purchase orders must keep resolving their supplier. It refuses with
`409 SUPPLIER_HAS_OPEN_ORDERS` while the supplier still has a `DRAFT`, `PENDING_APPROVAL`,
`APPROVED`, or `PARTIALLY_RECEIVED` order. A duplicate code is `409 SUPPLIER_CODE_TAKEN`, from
the unique index rather than a read-then-write check. Purchase orders can only be raised
against an `ACTIVE` supplier (`400 SUPPLIER_NOT_ACTIVE`).

## 2. Purchase order state machine

| From                 | Allowed next                                  |
| -------------------- | --------------------------------------------- |
| `DRAFT`              | `PENDING_APPROVAL`, `APPROVED`, `CANCELLED`   |
| `PENDING_APPROVAL`   | `APPROVED`, `DRAFT`, `CANCELLED`              |
| `APPROVED`           | `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED` |
| `PARTIALLY_RECEIVED` | `RECEIVED`, `CLOSED`                          |
| `RECEIVED`           | `CLOSED`                                      |
| `CLOSED`             | terminal                                      |
| `CANCELLED`          | terminal                                      |

Explicit transitions are `POST /purchase-orders/:id/{submit,approve,cancel,close}`. Receiving
transitions (`PARTIALLY_RECEIVED`, `RECEIVED`) are **never** requested by a client — they are
recomputed from the receiving counters inside the same atomic update that claims receipt
capacity. Every accepted transition appends an immutable `statusHistory` entry
(`{ from, to, reason, actor, requestId, at }`) and writes an `AuditLog` record. A rejected
transition returns `409 PURCHASE_ORDER_TRANSITION_INVALID` and writes nothing.

**Approval moves no stock.** `APPROVED` sets `approvedAt` / `approvedBy` only; inventory is
touched exclusively by goods receipt.

Completeness is measured against **delivered** quantity (`quantityReceived`, i.e. accepted +
rejected) rather than accepted quantity, because a supplier who delivered every ordered unit
has fulfilled the order even when some units failed inspection. Rejected units are recorded
and never enter stock.

## 3. Money model and server-owned fields

```
lineSubtotal = unitCost * quantityOrdered        (both server-validated)
subtotal     = Σ lineSubtotal
discount     = min(submitted discount, subtotal + shippingCost + taxAmount)
total        = max(0, subtotal + shippingCost + taxAmount - discount)
```

All amounts are PKR rounded to two decimals by `money()`. Product `name` and `sku` are
snapshotted from the catalog at line construction, so renaming a product later cannot rewrite
a historical purchase order.

**A submitted `total` is never trusted** — `total` is not in the create/update schema at all,
so sending it is `400 VALIDATION_ERROR`, and the stored value is always recomputed from the
lines. The same applies to `poNumber`, `status`, `statusHistory`, `quantityReceived`,
`quantityAccepted`, `quantityRejected`, `quantityReturned`, `subtotal`, `approvedBy`, and
every other server-owned field.

`poNumber` is server-generated as `PO-YYYYMMDD-XXXXXX` (6 hex chars from
`crypto.randomBytes`), regenerated on a unique-index collision up to five times. `GRN-` and
`PRT-` numbers follow the same scheme, matching the Phase C/D `MK-`, `INV-`, `RET-`, `RFD-`
convention.

**Creating a purchase order does not change stock**, and each product may appear only once per
order (`400 PURCHASE_ITEMS_DUPLICATED`). Only a `DRAFT` order is editable
(`409 PURCHASE_ORDER_NOT_EDITABLE`); after approval the order is a commitment and must be
cancelled and re-raised.

## 4. Goods receipt — the critical path

`POST /api/v1/admin/purchase-orders/:id/receipts` requires an `Idempotency-Key` header of
8–128 characters (`400 IDEMPOTENCY_KEY_REQUIRED` otherwise) and accepts per line
`{ purchaseOrderItemId, quantityAccepted, quantityRejected?, rejectionReason? }`.

Ordering is the whole design:

1. **Replay check** against the unique `(purchaseOrder, idempotencyKey)` index.
2. **Eligibility**: only `APPROVED` or `PARTIALLY_RECEIVED`
   (`409 PURCHASE_ORDER_NOT_RECEIVABLE`).
3. **Atomic capacity claim** across every requested line in one conditional update.
4. **Receipt document write** — the durable idempotency authority, consulted before any stock
   moves.
5. **Inventory application** of accepted units only, through `adjustStock`.
6. **Cost-price sync** (§7).
7. **Audit**, in the same transaction (§6).

### Atomic multi-line capacity claim

One `findOneAndUpdate` both validates and applies, using `$expr` over each requested line:

```js
PurchaseOrder.findOneAndUpdate(
  {
    _id,
    status: { $in: ['APPROVED', 'PARTIALLY_RECEIVED'] },
    $expr: {
      $and: deltas.map(d => ({
        $and: [
          { $ne: [lineField(d.lineId, 'quantityOrdered'), null] },
          { $lte: [{ $add: [lineField(d.lineId, 'quantityReceived'), d.received] }, lineField(d.lineId, 'quantityOrdered')] },
        ],
      })),
    },
  },
  [
    /* $map + $switch apply every line delta, then recompute status */
  ],
  { new: true }
);
```

Consequences that the integration test verifies directly:

- **Either the whole claim applies or none of it does.** A multi-line receipt where one line is
  valid and another exceeds its ordered quantity is refused with nothing applied — no partial
  stock, no partial counters.
- **Concurrent receipts cannot jointly over-receive.** Five simultaneous receipts of 2 units
  against 5 remaining each return a clean `201` or `409`; total received never exceeds ordered,
  and the movement ledger reconciles with the balance.
- **Over-receipt is `409`, pre-flight or raced.** The per-line guard and the atomic claim both
  return `409 PURCHASE_RECEIPT_QUANTITY_INVALID`, so the same condition never has two statuses.
  A zero-quantity line (`accepted + rejected < 1`) is a `400` — malformed input, not a
  conflict.

### Idempotency

The unique compound index `(purchaseOrder, idempotencyKey)` on both `GoodsReceipt` and
`PurchaseReturn` — not an in-memory guard — is the durable authority. A replay returns the
original document with `200` (a first application returns `201`), moves no additional stock,
and creates no second receipt. A replay carrying a **different body** still returns the
originally stored receipt. Three simultaneous same-key requests produce exactly one receipt;
the losers of the unique-index race re-read and return the winner's document.

### Inventory contract

Only `quantityAccepted` reaches inventory, and only via `adjustStock` with
`type: 'PURCHASE_RECEIPT'`, `referenceType: 'PurchaseOrder'`, `referenceId: <purchaseOrderId>`,
into the purchase order's `warehouse` / `location`. Supplier returns use
`type: 'PURCHASE_RETURN'` and a negative delta. **No purchasing code writes
`InventoryBalance` or `Product.stock` directly**, so the balance stays authoritative, the
mirror stays synchronised, and every purchasing stock change is traceable to its purchase
order in the movement ledger.

## 5. Purchase returns — IMPLEMENTED (not deferred)

Safe semantics were achievable, so purchase returns are implemented rather than documented as
`PURCHASE RETURNS: DEFERRED`.

`POST /api/v1/admin/purchase-orders/:id/returns` requires an `Idempotency-Key` and a `reason`,
and is eligible only for `PARTIALLY_RECEIVED`, `RECEIVED`, or `CLOSED` orders
(`409 PURCHASE_RETURN_NOT_ELIGIBLE`). Returning goods that were never received is impossible.

Two independent caps make the inventory effect safe:

1. **Per line**, `quantityReturned + quantity <= quantityAccepted`, reserved by the same style
   of atomic `$expr` conditional update used for receipts. Exceeding it — pre-flight or raced —
   is `409 PURCHASE_RETURN_QUANTITY_INVALID`.
2. **In the inventory service**, which refuses to drive a balance negative. Returning more than
   the warehouse physically holds fails with `INSUFFICIENT_STOCK` (surfaced as `409`), persists
   no `PurchaseReturn`, and leaves `quantityReturned` untouched.

**No financial settlement is implied or recorded.** A purchase return is a goods-out movement
plus a document; there is no supplier refund, credit note, debit note, payable adjustment, or
expense entry anywhere in this phase.

## 6. Transaction policy — no phantom inventory

Purchase-order state, receipt or return documents, balance and mirror changes, immutable
movements, cost-price updates, and audit records use one MongoDB transaction. An audit or
persistence fault aborts the whole unit and returns the applicable safe domain error. The
database retains the exact state from before the attempt: no partial counters, document,
stock, cost update, movement, or artificial compensating movement.

`backend/tests/purchasing-compensation.test.ts` forces real audit-index violations against a
single-member replica set. It proves the aborted state and then retries the same idempotency
key successfully after the fault is removed.

## 7. Cost price policy: `LATEST_PURCHASE_COST`

**Decision — Option B.** On each accepted receipt line, `Product.costPrice` is updated to that
line's `unitCost`, and the receipt line stores `previousCostPrice` so the change is auditable.
The receipt carries `costPriceSynced: boolean`.

**This is explicitly not a valuation method. FIFO, LIFO, moving/weighted average, and
standard costing are NOT implemented** — there are no cost layers, no cost pools, and no
revaluation of existing on-hand stock. `costPrice` is the most recent price paid, i.e.
descriptive metadata for the next purchase decision.

Cost-price sync is deliberately **non-fatal**: it runs after inventory has been applied, and a
failure sets `costPriceSynced: false` on the receipt instead of reverting physically received
goods. Stock authority must not depend on descriptive metadata.

## 8. Dashboard and reports — real aggregates, no accounting semantics

`GET /api/v1/admin/purchasing/dashboard` (`days` 1–365 default 30, `limit` 1–50 default 10)
and `GET /api/v1/admin/purchasing/reports` (`groupBy=supplier|product|date`) are live
aggregations over `Supplier`, `PurchaseOrder`, `GoodsReceipt`, and `PurchaseReturn`. **No
figure is fabricated, seeded, or hard-coded.**

| Figure                          | Definition                                                                |
| ------------------------------- | ------------------------------------------------------------------------- |
| `suppliers.*`                   | Counts by `ACTIVE` / `INACTIVE` / `ARCHIVED`                              |
| `purchaseOrders.open`           | Count in `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PARTIALLY_RECEIVED`    |
| `purchaseOrders.committedValue` | `Σ order.total` excluding `CANCELLED`                                     |
| `outstanding.units/value`       | `Σ (quantityOrdered − quantityReceived)` and its cost, open orders only   |
| `receiving.*`                   | Receipts, units accepted, units rejected, `Σ acceptedValue` within `days` |
| `supplierReturns.*`             | Returns, units, `Σ returnedValue` within `days`                           |
| `topSuppliers`                  | Top suppliers by committed value within `days`, `CANCELLED` excluded      |
| `fulfillmentRate`               | `unitsReceived / unitsOrdered × 100` (supplier report)                    |
| `acceptanceRate`                | `unitsAccepted / unitsDelivered × 100` (supplier performance)             |

**Deliberate boundary.** `committedValue` is a procurement commitment; `receivedValue` /
`acceptedValue` is a goods-in value. Neither is an expense, a payable, cost of goods sold, or
input to profit. The payload states this as `basis: 'PROCUREMENT_COMMITMENT_AND_GOODS_IN'`, and
the response contains no `profit`, `expense`, `payable`, `grossMargin`, or `costOfGoodsSold`
field — asserted by the integration test. Accounting semantics belong to a later Finance
phase.

`acceptanceRate` and `fulfillmentRate` are receiving/logistics statistics, not accounting
ratios. An unknown `groupBy` is `400 VALIDATION_ERROR`.

## 9. Endpoints

All require a current `SUPER_ADMIN` Bearer token: no token → `401`, customer token → `403`.

| Method | Path                                         | Purpose                                                   |
| ------ | -------------------------------------------- | --------------------------------------------------------- |
| GET    | `/api/v1/admin/suppliers`                    | Filtered, sorted, paginated supplier list                 |
| POST   | `/api/v1/admin/suppliers`                    | Create supplier (code uppercased, unique)                 |
| GET    | `/api/v1/admin/suppliers/:id`                | Supplier with open-order count and goods-in value         |
| PATCH  | `/api/v1/admin/suppliers/:id`                | Update supplier                                           |
| DELETE | `/api/v1/admin/suppliers/:id`                | Archive (refused while orders are open)                   |
| GET    | `/api/v1/admin/suppliers/:id/performance`    | Real order / receiving / return statistics                |
| GET    | `/api/v1/admin/purchase-orders`              | List by status, supplier, warehouse, product, date, total |
| POST   | `/api/v1/admin/purchase-orders`              | Create `DRAFT`, server-computed totals                    |
| GET    | `/api/v1/admin/purchase-orders/:id`          | Detail with receipts and supplier returns                 |
| PATCH  | `/api/v1/admin/purchase-orders/:id`          | Edit `DRAFT` only                                         |
| POST   | `/api/v1/admin/purchase-orders/:id/submit`   | → `PENDING_APPROVAL`                                      |
| POST   | `/api/v1/admin/purchase-orders/:id/approve`  | → `APPROVED` (no stock movement)                          |
| POST   | `/api/v1/admin/purchase-orders/:id/cancel`   | → `CANCELLED` (blocked once goods received)               |
| POST   | `/api/v1/admin/purchase-orders/:id/close`    | → `CLOSED`                                                |
| POST   | `/api/v1/admin/purchase-orders/:id/receipts` | Idempotent goods receipt; increases stock                 |
| GET    | `/api/v1/admin/purchase-orders/:id/receipts` | Receipts for one order                                    |
| GET    | `/api/v1/admin/goods-receipts`, `/:id`       | Receipt list and detail                                   |
| POST   | `/api/v1/admin/purchase-orders/:id/returns`  | Idempotent supplier return; decreases stock               |
| GET    | `/api/v1/admin/purchase-returns`             | Supplier return list                                      |
| GET    | `/api/v1/admin/purchasing/dashboard`         | Live procurement aggregates                               |
| GET    | `/api/v1/admin/purchasing/reports`           | Grouped by supplier, product, or date                     |

## 10. Cancellation policy

A purchase order with **any** received units cannot be cancelled:
`409 PURCHASE_ORDER_NOT_CANCELLABLE`. The check runs before the generic transition table so the
refusal names its real cause, and it is repeated as a filter condition
(`items: { $not: { $elemMatch: { quantityReceived: { $gt: 0 } } } }`) on the atomic update so a
receipt landing concurrently cannot slip past it. Historical received inventory is never
erased — a fully or partially received order is closed, not cancelled, and goods physically in
the warehouse are removed only through an explicit supplier return or inventory adjustment.

## 11. Error and audit hygiene

- Domain errors map onto stable codes (`PURCHASE_ORDER_NOT_FOUND`,
  `PURCHASE_ORDER_NOT_RECEIVABLE`, `PURCHASE_RECEIPT_QUANTITY_INVALID`,
  `SUPPLIER_HAS_OPEN_ORDERS`, `IDEMPOTENCY_KEY_REQUIRED`, …). Unknown errors fall through to
  the shared error handler's generic envelope.
- **No `CastError`, driver message, index name, or stack trace is ever returned.** Malformed
  ids fail the `^[a-f\d]{24}$` param schema as `400 VALIDATION_ERROR`. The integration test
  sweeps error responses asserting no `CastError`, no `at Object.`, and no `mongo` appears in
  any body.
- Audit records exist **only for operations that actually succeeded**: `SUPPLIER_CREATED`,
  `SUPPLIER_UPDATED`, `SUPPLIER_ARCHIVED`, `PURCHASE_ORDER_CREATED`, `PURCHASE_ORDER_UPDATED`,
  `PURCHASE_ORDER_<STATUS>`, `PURCHASE_GOODS_RECEIVED`, `PURCHASE_RETURN_CREATED`. A refused
  cancel, a rejected transition, and a `403` all write nothing — asserted explicitly.

## 12. Deferred in Phase E, Part B

- Any **frontend**: no supplier UI, purchase forms, receiving UI, or purchasing dashboard UI.
- **Finance and accounting**: expense ledger, accounts payable, supplier payment, supplier
  refunds, profit and loss, accounting journals, financial settlement.
- **Inventory valuation methods**: FIFO, LIFO, weighted average, standard costing (see §7 —
  `LATEST_PURCHASE_COST` is deliberately not a valuation method).
- Payment provider integration (selection remains TBD / NOT CONFIRMED).
- Supplier portal or supplier login, and any banking credential storage.
- Requisitions, RFQs, supplier quotations, multi-level approval chains, drop-ship and
  back-to-back purchasing, landed-cost allocation, and lot/serial/expiry tracking.

See [CUSTOMERS_ERP_ARCHITECTURE.md](./CUSTOMERS_ERP_ARCHITECTURE.md) for Phase E, Part A and
[INVENTORY_ARCHITECTURE.md](./INVENTORY_ARCHITECTURE.md) for the inventory authority this
phase writes through.
