# MansooriKart Pricing Architecture

Phase G: how a supplier cost becomes a MansooriKart selling price. Everything below describes the
implemented `/api/v1` runtime (`backend/src/services/pricingService.ts`,
`backend/src/services/bulkPricingService.ts`, `backend/src/routes/v1/adminPricing.ts`,
`backend/src/models/pricingRule.ts`). The removed legacy `/api/*` runtime has no active consumer.

Companion documents: [CSV_CATALOG_IMPORT_ARCHITECTURE.md](./CSV_CATALOG_IMPORT_ARCHITECTURE.md) for
where supplier costs come from, [DROPSHIPPING_ARCHITECTURE.md](./DROPSHIPPING_ARCHITECTURE.md) for
publication and fulfilment.

## 1. Who controls what

**A supplier controls their cost. MansooriKart controls the selling price.** A supplier CSV writes
`SupplierCatalogItem.supplierCost` and can never write `Product.price`; there is no mapping target
that reaches the selling price, and the update patch a repeat import builds does not contain
`price` at all.

A supplier's own MSRP, when they publish one, is stored in the separately named optional field
`Product.supplierSuggestedRetailPrice`. It is reference data. Nothing computes from it and nothing
displays it as the price.

The pricing engine only ever **computes a suggestion**. Writing `Product.price` is always the
caller's explicit act, through `POST /api/v1/admin/pricing/apply`, a direct admin catalog update, or
the initial price of a newly created draft when the operator opted in at mapping time.

## 2. `PricingRule`

`PricingRule` (collection `pricingrules`): `name`, `description`, `supplier`, `category`, `brand`,
`minCost`, `maxCost`, `markupType`, `markupValue`, `minimumProfit`, `roundingRule`, `priority`,
`isActive`, `createdBy`, `updatedBy`, timestamps.

Scope fields (`supplier`, `category`, `brand`, `minCost`/`maxCost`) are all optional and **ANDed**:
an empty field matches anything, a populated one must match. A rule with `supplier` and `category`
therefore governs only products sourced from that supplier in that category. Category and brand
match case-insensitively and stay free text on purpose — a rule may legitimately outlive a renamed
category.

`markupType` is `PERCENTAGE` (25 means +25%) or `FIXED` (an absolute currency amount).
`markupValue` and `minimumProfit` are non-negative by schema, so a rule cannot be authored to
discount below cost.

An inverted cost band is `400 PRICING_RULE_COST_BAND_INVALID` and a rule scoped to a non-existent
supplier is `400 PRICING_RULE_SUPPLIER_NOT_FOUND`, both checked before the write rather than
silently matching nothing later.

## 3. Computation order

Fixed, documented, and identical everywhere because operators reconcile these numbers by hand:

```
1. markup            PERCENTAGE: cost + cost * markupValue / 100
                     FIXED:      cost + markupValue
2. minimum profit     price = max(price, cost + minimumProfit)
3. rounding           END_99, and only if it does not break the floor from step 2
```

Worked examples:

| Cost | Rule                                                | Result                                                              |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------- |
| 2000 | `PERCENTAGE` 25                                     | **2500**                                                            |
| 2000 | `FIXED` 500                                         | **2500**                                                            |
| 2000 | markup yielding 2150, `minimumProfit` 300           | **2300** — the floor raises it                                      |
| 2000 | `PERCENTAGE` 25, `END_99`                           | **2499**                                                            |
| 2000 | markup yielding 2300, `minimumProfit` 300, `END_99` | **2300** — rounding to 2299 would break the floor, so it is skipped |

The response reports `appliedMinimumProfit` and `appliedRounding`, so an operator can see which
steps moved the number rather than inferring it.

## 4. Rounding

`NONE` keeps the computed value. `END_99` lowers the price to the largest value ending in `99` that
is not above it (2500 → 2499, 2450 → 2399, 2599 → 2599 unchanged); a price below 99 has no `…99`
beneath it and is returned unchanged.

Rounding is the only step that can lower a price, it is applied last, and it is **skipped entirely
when it would push the price below cost plus `minimumProfit`**.

## 5. Never a negative margin

Markup is added to cost and `markupValue` cannot be negative, the profit floor can only raise a
price, and rounding can never breach that floor. The computed price is therefore always at least
cost. A cost that is not a finite non-negative number is `400 PRICING_COST_INVALID`, and a computed
price above the 100,000,000 ceiling is `400 PRICING_PRICE_TOO_LARGE` rather than a stored absurdity.

## 6. Deterministic rule selection

When several active rules match, exactly one is chosen, in this order:

1. **Scope specificity.** `supplier` (8) + `category` (4) + `brand` (2) + a cost band (1), summed —
   so supplier+category beats supplier, which beats category, which beats a global rule.
2. **`priority` descending.** The explicit operator tie-breaker within an equally specific scope.
3. **Older rule first**, then id.

Two rules can therefore never tie, and the same product and cost always resolve to the same rule.
Selection never depends on the order the driver happened to return documents in, and there is no
random or "first match wins" behaviour anywhere.

A disabled rule is invisible to the engine: `loadActiveRules` filters on `isActive`, and asking to
apply one explicitly is `400 PRICING_RULE_INACTIVE`. Retiring a rule is its own route rather than a
patched flag, so the audit trail names the decision.

## 7. A manual price survives everything

`Product.sellingPriceOverridden` marks a price a human decided. It is set whenever an admin applies
a price through the pricing endpoints or edits the price directly, and it is `false` on a
freshly imported draft.

An overridden product is **excluded from automatic repricing by default**. A bulk run reports it as
`PRICE_MANUALLY_OVERRIDDEN` — "the selling price was set by an admin and is preserved" — and counts
it in `summary.preservedOverrides` rather than quietly changing it. Moving such a price requires the
explicit `includeOverridden: true` opt-in on the request.

A later supplier cost import does not disturb it either. An import refreshes cost, stock, and
availability; a cost rise is _reported_ (`changes.cost` with old, new, difference, and percent, plus a
`CATALOG_IMPORT_COST_CHANGES` audit entry above 10%) and the selling price is left exactly as the
admin set it. The suggestion is available whenever the operator wants it; nothing applies it on their
behalf.

## 8. Preview, then apply

Two requests over one computation, so an operator sees the exact numbers and then decides.

A target set is product ids (max 1,000, no duplicates) or a `supplierId` / `status` /
`fulfillmentType` filter. A request that selects nothing at all is
`400 PRICING_TARGETS_REQUIRED` — there is deliberately no way to say "reprice the whole catalogue"
by omission. Both endpoints return the same per-product rows:

```
productId, name, sku, status, fulfillmentType,
supplierId, supplierSku, supplierCost, currentPrice, sellingPriceOverridden,
rule { id, name }, newPrice, grossUnitMargin, grossMarginPercent,
appliedMinimumProfit, appliedRounding, willChange, eligible, issues[]
```

plus a summary of `targets`, `eligible`, `willChange`, `preservedOverrides`, `blocked`, and
`updated`.

Cost comes from the governing supplier source, falling back to `Product.costPrice` for an own-stock
product with no source, so one engine serves both fulfilment types. When several sources exist, the
same deterministic choice checkout makes is used (lowest cost, then oldest, then id), so a preview
and the eventual order snapshot never disagree about which supplier is in play.

Per-product problems are reported as row issues, never thrown, so one unpriceable product cannot
abort a batch: `SUPPLIER_COST_MISSING`, `PRICING_RULE_NOT_MATCHED`, `PRICE_MANUALLY_OVERRIDDEN`, or a
computation failure.

`preview` writes nothing at all. `apply` writes only the rows a preview would have marked
`willChange`, in a single `bulkWrite` rather than a query per product, sets
`sellingPriceOverridden: true` on each (the admin has now decided this price, so a later automatic
pass leaves it alone), and **never touches `status`** — repricing a `DRAFT` leaves it `DRAFT`, so no
pricing operation can publish anything.

## 9. Pricing at import time

At mapping confirmation an operator may name a `pricingRuleId` and set
`applyPricingToNewProducts`. The effect is narrow by design:

- A **new** product's initial `price` is the suggestion when the operator opted in, and `0`
  otherwise — which publication validation then refuses until someone sets a real price.
- An **existing** product is never repriced by an import, whatever the flags say.
- A named rule pins the whole run to it; otherwise each row resolves through the normal precedence
  using the job's supplier and the row's category and brand.
- A rule that cannot price a particular cost yields "no suggestion" for that row rather than failing
  it.

The preview's `priceWillBeApplied` states plainly, per row, whether the import would set a price.

## 10. Margin is labelled honestly

Every margin figure this phase exposes is **gross merchandise margin**:

```
grossUnitMargin    = sellingPrice - supplierCost
grossMarginPercent = grossUnitMargin / sellingPrice * 100
```

The label travels with the payload (`marginBasis: 'gross merchandise margin'`, `basis` on a single
computation) because that is all it is: it excludes shipping, payment fees, returns, refunds, and
every operating expense, and it is **not final business profit**. Phase F's finance module remains
the authority for profit; the dropship cost snapshot feeds the same COGS mechanism own-stock lines
use, so there is one profit formula, not two. See
[FINANCE_ARCHITECTURE.md](./FINANCE_ARCHITECTURE.md).

Margin fields appear only on `SUPER_ADMIN` surfaces. No customer-facing serializer exposes
`supplierCost`, margin, or any pricing-rule internal — the storefront sees the MansooriKart selling
price and the public compare-at price, and nothing else.

## 11. API surface

All routes are `SUPER_ADMIN`-only (`requireAuth` + `requireSuperAdmin`): no token is `401`, a
`CUSTOMER` token is `403`. All bodies and queries are `.strict()`.

| Method  | Path                                      | Purpose                                |
| ------- | ----------------------------------------- | -------------------------------------- |
| `POST`  | `/api/v1/admin/pricing-rules`             | Create a rule                          |
| `GET`   | `/api/v1/admin/pricing-rules`             | Rule book, in engine resolution order  |
| `GET`   | `/api/v1/admin/pricing-rules/:id`         | One rule                               |
| `PATCH` | `/api/v1/admin/pricing-rules/:id`         | Amend a rule (non-empty body required) |
| `POST`  | `/api/v1/admin/pricing-rules/:id/disable` | Retire a rule                          |
| `POST`  | `/api/v1/admin/pricing-rules/:id/enable`  | Reinstate a rule                       |
| `POST`  | `/api/v1/admin/pricing/preview`           | Proposed prices; writes nothing        |
| `POST`  | `/api/v1/admin/pricing/apply`             | Write the proposal                     |

`createdBy` and `updatedBy` are stamped from the token and are `400 VALIDATION_ERROR` as input, as
is `isActive` (the enable/disable routes own it). An explicit `null` in a patch clears a scope field,
so absence and `null` are meaningfully different. Listing is paginated (`limit` ≤ 100) and ordered
exactly as the engine resolves, so the list reads as the rule book it is.

## 12. Audit

`PRICING_RULE_CREATED`, `PRICING_RULE_UPDATED`, `PRICING_RULE_DISABLED`, `PRICING_RULE_ENABLED`, and
`PRICING_BULK_APPLIED`.

Rule entries record rule metadata — scope, markup, floor, rounding, priority — never a product list
or a computed price list. The bulk entry records the rule, the counts, the `includeOverridden` flag,
and at most 50 product ids. An audit entry records the decision, not a price list.

## 13. Performance

Active rules are loaded **once** per run and matched in memory over that bounded set; there is no
query per product and no query per row. Targets and their supplier sources load in a bounded number
of queries, capped at 1,000 products. Writes go through one `bulkWrite`.

`{ isActive, priority: -1, createdAt: 1 }` indexes the hot resolution path, and
`{ supplier, isActive }` serves the per-supplier rule list. Scope fields are low-cardinality filters
applied over that bounded set rather than indexed separately, so no redundant index was added.

## 14. Deferred

Currency conversion (all amounts are PKR), competitor or dynamic repricing, scheduled repricing
runs, per-customer or per-channel price lists, tax-inclusive pricing rules, promotional pricing
beyond the existing coupon module, and all frontend work.
