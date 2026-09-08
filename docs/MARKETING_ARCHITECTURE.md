# MansooriKart Marketing Architecture

The marketing and merchandising layer provides Super Admin coupon, promotion, banner, and curated-homepage APIs. It uses separate public/admin projections and centralized bounds in `backend/src/config/storefront.ts`. The removed legacy `/api/*` runtime has no active consumer.

Companion documents: [CMS_ARCHITECTURE.md](./CMS_ARCHITECTURE.md), [STORE_CONFIGURATION_ARCHITECTURE.md](./STORE_CONFIGURATION_ARCHITECTURE.md), [SYSTEM_OPERATIONS_ARCHITECTURE.md](./SYSTEM_OPERATIONS_ARCHITECTURE.md), [API_CONTRACT.md](./API_CONTRACT.md), [API_INVENTORY.md](./API_INVENTORY.md).

## 1. There is exactly one discount authority

The coupon system predates this phase. `Coupon`, `CouponRedemption`, the redemption ledger and the discount arithmetic all shipped with the commerce foundation, and checkout has resolved coupon codes through `orderService.checkout` since then. Phase H did not add a second one.

What Phase H added is an _admin API over those records_. `adminCoupons.ts` lists, filters, reads, creates, updates, enables, disables and reports on coupons. It never computes a discount. Expiry, start date, usage limit, per-customer limit, minimum order amount, the percentage calculation and the maximum-discount ceiling are evaluated exactly once, at checkout, by `orderService.couponFor`, and that function was not modified by this phase. The separation is worth stating plainly because the alternative — a management API that reimplements eligibility so it can preview a discount — is how two subtly different definitions of "valid coupon" end up in one codebase.

The consequence for the storefront is that a promotion cannot make anything cheaper. A `Promotion` document carries a `couponCode` string, but that string is advertising copy: it tells a customer which code to type. When they type it, checkout resolves it against `Coupon` and applies exactly the rules it always has. Deleting the promotion does not revoke the coupon, and creating one does not create a coupon.

## 2. Coupon records and their lifecycle state

`GET /api/v1/admin/coupons` pages through coupons with an allowlisted filter set: `state`, `type`, an anchored `code` prefix, a `search` term, a bounded `from`/`to` creation range and a `sort` chosen from six fixed orders. Nothing in the query object reaches Mongo as a field name or an operator — `sort` selects a pre-declared sort document, `code` and `search` are escaped through `escapeRegex` and anchored with `^`, and the date range is refined to reject an inverted range or a span wider than 366 days.

`state` deserves its own note because it is derived, never stored. A coupon row has `enabled`, `startsAt`, `expiresAt`, `usageLimit` and `usageCount`; what an operator wants to filter by is the single word that summarises them. The five states are computed from those columns:

| State       | Condition                                          |
| ----------- | -------------------------------------------------- |
| `DISABLED`  | `enabled` is false                                 |
| `EXPIRED`   | `expiresAt` is in the past                         |
| `SCHEDULED` | `startsAt` is in the future                        |
| `EXHAUSTED` | `usageLimit` is set and `usageCount >= usageLimit` |
| `ACTIVE`    | none of the above                                  |

The list filter and the serializer agree by construction: `stateFilter` translates each state into a Mongo predicate and `adminCoupon` computes the same answer from a loaded row. The `EXHAUSTED` predicate is the only one that needs `$expr`, to compare two fields of the same document, and its expression is assembled from constants — `['$usageCount', '$usageLimit']` — with no request input anywhere inside it.

Writes are validated by strict Zod. A code must match `/^[A-Z0-9][A-Z0-9_-]{1,63}$/` after `normalizeCouponCode` has uppercased it and stripped internal whitespace, so `summer sale` and `SUMMERSALE` cannot both exist as distinct records that a customer would type identically. A percentage coupon whose `value` exceeds 100 is refused, as is a negative value, a negative or zero usage limit, a negative minimum order, a `startsAt` at or after `expiresAt`, and any money field above the central `MAX_MONEY` bound. Unknown fields are a 400 rather than a silent no-op, which is what stops a request from setting `usageCount`, `_id` or a timestamp.

## 3. Editing a coupon never rewrites history

Every order stores its own coupon snapshot at checkout: `coupon.couponId`, `coupon.code`, `coupon.type`, `coupon.value` and `coupon.actualDiscount` are written onto the order document when it is created and never touched again. Changing a coupon's percentage from 10 to 25 therefore changes what the _next_ customer receives and nothing about what a past customer received.

This is tested rather than asserted. The regression places an order with a coupon, edits the coupon's `type` and `value`, and reads the order back to confirm the snapshot still reports the original terms; a second case edits a coupon while its redemption ledger is non-empty and confirms `usageCount` and `CouponRedemption` rows are untouched. `PATCH /api/v1/admin/coupons/:id` has no path to either counter — they are not in the schema, so a request naming them fails validation.

`DELETE /api/v1/admin/coupons/:id` is a soft disable. It sets `enabled: false`, writes a `COUPON_ARCHIVED` audit entry and returns `{ id, archived: true }`. Nothing in Phase H physically removes a coupon, because a removed coupon would orphan the redemption rows and the order snapshots that reference it.

## 4. Usage statistics report what happened, not what would happen now

`GET /api/v1/admin/coupons/:id/usage` answers "what did this coupon actually do". It counts `CouponRedemption` rows, counts distinct customers among them, reads the coupon's own `usageCount` and `usageLimit`, derives `remainingUses`, and aggregates the orders that carry this coupon in their snapshot to produce `orders`, `totalDiscountGiven`, `orderRevenue` and `lastUsedAt`.

`totalDiscountGiven` sums `$coupon.actualDiscount` from the order snapshots. It is deliberately not recomputed from the coupon's current `value`: a coupon edited from 10% to 25% halfway through its life would otherwise report that every earlier customer received 25%, which is false. The same reasoning governs `orderRevenue`, which sums the historical order totals.

## 5. Promotions are merchandising, not pricing

`Promotion` is a storefront announcement. Its fields are `name`, `slug`, `headline`, `description`, `badgeText`, `couponCode`, `imageUrl`, a structured destination, a `status`, a `[startAt, endAt)` window and a `priority`. There is no percentage, no fixed amount, no stacking rule, no eligibility expression and no product scope, and that absence is the design: adding any one of them would make `Promotion` a second thing that decides what a customer pays.

Slugs are unique and normalised. A create request may supply a slug or let the server derive one from the name through `slugify`, and a collision is a 409 `PROMOTION_SLUG_EXISTS` rather than a silent overwrite. Status is one of `DRAFT`, `SCHEDULED`, `ACTIVE`, `EXPIRED` or `ARCHIVED`, and a client never sets it directly on the public side — `POST /promotions/:id/activate` and `POST /promotions/:id/archive` are the transitions, and `DELETE /promotions/:id` is a soft archive returning `{ id, archived: true }`.

## 6. Visibility is derived, so there is no scheduler

`marketingService.visibilityFilter` builds the Mongo predicate for "may a customer see this right now":

```js
{
  status: { $in: ['SCHEDULED', 'ACTIVE'] },
  $and: [
    { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
    { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
  ],
}
```

Each boundary is an `$or` against `null` because in MongoDB `{ startAt: null }` matches an explicit null _and_ an absent field, so an open-ended campaign needs no sentinel date. The window is half-open — `$lte` on the start, `$gt` on the end — so a promotion that ends at midnight is invisible at midnight rather than for one more millisecond.

Nothing flips a stored boolean when a campaign begins or ends. There is no cron job, no queue and no background worker in MansooriKart, and a scheduled promotion becomes visible because the clock moved, not because a process woke up. The corollary is that a forgotten process cannot leave an expired campaign on the storefront.

`effectiveStatus` applies the same clock for the admin console: a record left as `ACTIVE` whose window has closed reads as `EXPIRED`, and one whose window has not opened reads as `SCHEDULED`. `DRAFT` and `ARCHIVED` are decisions rather than schedules, so the clock never overrides them. The stored `status` is returned alongside `effectiveStatus` so an operator can see both what they set and what it currently means.

Visibility is never a request parameter. `GET /api/v1/store/promotions` has no `status`, `includeExpired` or `now` input; the server decides, and there is no query string that reveals a draft.

## 7. Banners and structured destinations

A `Banner` occupies one of three closed placements — `HOME_HERO`, `HOME_PROMO`, `CATEGORY_HERO` — and a `CATEGORY_HERO` must name its `category`, since a category hero with no category has nowhere to appear. Its status vocabulary is narrower than a promotion's (`DRAFT`, `ACTIVE`, `ARCHIVED`) because a banner has no announcement lifecycle of its own; the window handles scheduling.

Destinations are structured rather than free text. `linkType` selects which one field is meaningful:

| `linkType`      | Required field  | Validation                                                                                         |
| --------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `NONE`          | —               | —                                                                                                  |
| `INTERNAL_PATH` | `linkPath`      | `safeInternalPath`: single leading `/`, no `//`, no `:`, no `..`, no backslash or markup character |
| `PRODUCT`       | `linkProduct`   | 24-hex identifier, must exist                                                                      |
| `CATEGORY`      | `linkCategory`  | 24-hex identifier, must exist                                                                      |
| `PROMOTION`     | `linkPromotion` | 24-hex identifier, must exist                                                                      |
| `EXTERNAL_URL`  | `linkUrl`       | `safeUrl`: parses as an absolute URL with a hostname and an `http:`/`https:` scheme                |

`refineLink` in `utils/contentSchemas.ts` enforces the coherence rule — a `PRODUCT` link with no product is a 400 — while each field's own schema enforces the safety rule. Because the two checks are separate, a request cannot satisfy one by evading the other. Promotions share the same fragment minus `PROMOTION`, which a promotion pointing at another promotion has no use for.

## 8. URL safety, and the fetch that does not happen

`javascript:`, `data:`, `file:` and `vbscript:` URLs fail because `safeUrl` allowlists schemes rather than blocklisting them: `ALLOWED_URL_SCHEMES` is `['http:', 'https:']`, and anything the `URL` parser reports as another protocol — or fails to parse at all — returns `null` and becomes a 400. `//evil.example` fails the internal-path check for the same structural reason: a protocol-relative value is an off-site redirect wearing a relative path's clothes.

The second half of URL safety is what the server does _not_ do. It never dereferences an operator-supplied address. `imageUrl`, `mobileImageUrl` and `linkUrl` are validated structurally, stored as strings and handed to the client, which is the browser that eventually loads the image. There is no server-side fetch, no thumbnailing pass and no link preview, so none of these fields can be used to make the backend issue a request to an address of the submitter's choosing.

Text fields are plain text by the time they reach MongoDB. `plainText` and `optionalPlainText` transform through `stripMarkup`, which drops `<script>` and `<style>` elements _with their contents_, removes every remaining tag, neutralises bracket-bearing HTML entities, strips control characters and collapses tabs and newlines to spaces. A title of `<script>alert(1)</script>` therefore stores as an empty result and is refused for being shorter than the minimum, rather than storing `alert(1)` as visible text. A value that was only markup fails; a value that merely contained some is stored clean.

## 9. Ordering is an operator decision, applied server-side

Banners and homepage sections are ordered lists, and both expose a reorder endpoint that takes the whole list rather than a pairwise swap. `POST /api/v1/admin/banners/reorder` accepts an array of ids and assigns `priority: ids.length - index` in one `bulkWrite`, so the first id ends up with the highest priority. `POST /api/v1/admin/homepage/reorder` rewrites `position: index * 10`, leaving gaps an operator can later insert into.

`PUT /api/v1/admin/homepage` replaces the entire layout for the same reason: partial updates to an ordered collection race with each other, and two concurrent "move this section up" requests can leave a list that neither operator asked for. Sending an empty `sections` array restores `defaultHomepageSections()` rather than producing a blank homepage.

## 10. The curated homepage is not a page builder

`HomepageConfiguration` is a singleton keyed `HOME` holding an ordered list of typed sections. `type` comes from a closed vocabulary of eight values — `HERO`, `FEATURED_PRODUCTS`, `NEW_ARRIVALS`, `BEST_SELLERS`, `FEATURED_CATEGORIES`, `PROMOTION`, `BANNER`, `TRUST_FEATURES` — and each type's settings are validated by its own `.strict()` branch of a discriminated union. A `FEATURED_PRODUCTS` section may carry `limit` and a bounded `products` array; it may not carry `features`, and a `TRUST_FEATURES` section may not carry `products`.

There is no field anywhere in that schema that can hold HTML, a script, a template expression or a style block. That is the structural reason MansooriKart has no page builder: an operator chooses which supported sections appear, in what order, with which references, and the server decides how each one resolves.

`buildHomepage` assembles the public payload in three passes. The first walks the section list and collects what the layout needs — which placements, which curated product and category ids, which promotions, whether featured, new-arrival or best-seller rails are required — without touching the database. The second issues at most one bounded query per _kind_ of data, all in parallel. The third shapes each section from the in-memory indexes and queries nothing. Twenty `FEATURED_PRODUCTS` sections therefore cost the same as one, and the response has a fixed query budget regardless of how the layout grows.

Best sellers are computed from orders in the last 90 days, grouping `items.productId` by summed quantity and excluding cancelled orders. The aggregation over-fetches — `limit * 3`, capped — because some past best sellers may since have been unpublished and will be dropped when the products are loaded through the public filter. A store with no recent orders shows its newest stock rather than an empty rail.

## 11. Publication eligibility is applied in the query

Every product and category the homepage loads is fetched through the public catalog filter, which is the same predicate `routes/v1/catalog.ts` uses: `{ $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }] }`, the second branch covering pre-Phase-F rows that never had a status. A `DRAFT` supplier-import product curated into a `FEATURED_PRODUCTS` section is therefore _absent from the query result_, not filtered out after serialization. There is no code path on which it could be published, which is a stronger guarantee than a post-filter and the reason the Phase G publication rules survive Phase H unchanged.

`resolveLinkTargets` applies the same principle to destinations. It batch-loads the products, categories and promotions a set of banners or promotions references, each with its eligibility filter attached, and returns three maps. `publicLink` looks a target up in the appropriate map and degrades to `{ type: 'NONE' }` when it is missing — so a banner pointing at an unpublished product renders as an image with no call to action, rather than as a dead link or as evidence that a hidden record exists.

## 12. Two serializers, one direction

`serializers/marketingAdmin.ts` and `serializers/storefront.ts` are both allowlists, never delete lists. A field added to `Promotion` or `Banner` later is invisible to both surfaces until somebody adds it on purpose, so the default for new marketing data is "internal".

The admin projection publishes what an operator needs to work: `status` and `effectiveStatus`, `startAt`, `endAt`, `priority`, the raw reference ids, `createdBy`, `updatedBy` and both timestamps. The public projection publishes none of them. `publicBanner` returns `id`, `title`, `subtitle`, `placement`, `imageUrl`, `mobileImageUrl`, `altText` (falling back to the title), `ctaLabel` and the resolved `link`. `publicPromotion` returns `id`, `name`, `slug`, `headline`, `description`, `badgeText`, `couponCode`, `imageUrl`, `endsAt` and the resolved `link` — `endsAt` because a campaign may legitimately advertise a deadline, and `startAt`, `status` and `priority` not at all, because they are scheduling internals.

Supplier identity, `supplierCost`, pricing rules, import batches, operator email addresses, audit metadata and internal authorship never appear in a public marketing response, and the tests assert their absence field by field rather than trusting the review.

## 13. API surface

All admin routes are `SUPER_ADMIN`-only: each router calls `requireAuth` and `requireSuperAdmin` before any handler, so a request with no token is `401 AUTH_UNAUTHORIZED`, a `CUSTOMER` token is `403 AUTH_FORBIDDEN`, and every body and query is parsed by a `.strict()` schema that rejects unknown fields with `400 VALIDATION_ERROR`. A malformed identifier is a clean `404`, never a CastError.

| Method | Path                                    | Purpose                                                       |
| ------ | --------------------------------------- | ------------------------------------------------------------- |
| GET    | `/api/v1/admin/coupons`                 | Paged, filtered coupon list with derived state                |
| POST   | `/api/v1/admin/coupons`                 | Create a coupon                                               |
| GET    | `/api/v1/admin/coupons/:id`             | One coupon                                                    |
| GET    | `/api/v1/admin/coupons/:id/usage`       | Redemption and discount statistics from history               |
| PATCH  | `/api/v1/admin/coupons/:id`             | Update a coupon without touching counters                     |
| POST   | `/api/v1/admin/coupons/:id/activate`    | Enable                                                        |
| POST   | `/api/v1/admin/coupons/:id/disable`     | Disable                                                       |
| DELETE | `/api/v1/admin/coupons/:id`             | Soft disable                                                  |
| GET    | `/api/v1/admin/promotions`              | Paged promotion list                                          |
| POST   | `/api/v1/admin/promotions`              | Create a promotion                                            |
| GET    | `/api/v1/admin/promotions/:id`          | One promotion                                                 |
| PATCH  | `/api/v1/admin/promotions/:id`          | Update a promotion                                            |
| POST   | `/api/v1/admin/promotions/:id/activate` | Transition to `ACTIVE`                                        |
| POST   | `/api/v1/admin/promotions/:id/archive`  | Transition to `ARCHIVED`                                      |
| DELETE | `/api/v1/admin/promotions/:id`          | Soft archive                                                  |
| GET    | `/api/v1/admin/banners`                 | Paged banner list, filterable by placement                    |
| POST   | `/api/v1/admin/banners`                 | Create a banner                                               |
| GET    | `/api/v1/admin/banners/:id`             | One banner                                                    |
| PATCH  | `/api/v1/admin/banners/:id`             | Update a banner                                               |
| POST   | `/api/v1/admin/banners/:id/activate`    | Transition to `ACTIVE`                                        |
| POST   | `/api/v1/admin/banners/:id/archive`     | Transition to `ARCHIVED`                                      |
| POST   | `/api/v1/admin/banners/reorder`         | Rewrite priorities from an ordered id list                    |
| DELETE | `/api/v1/admin/banners/:id`             | Soft archive                                                  |
| GET    | `/api/v1/admin/homepage`                | Current curated layout                                        |
| PUT    | `/api/v1/admin/homepage`                | Replace the layout                                            |
| POST   | `/api/v1/admin/homepage/reorder`        | Rewrite section positions                                     |
| PATCH  | `/api/v1/admin/homepage/sections/:key`  | Enable or disable one section without resubmitting the layout |

Public marketing reads require no token and perform no writes. They are served behind the maintenance guard described in [STORE_CONFIGURATION_ARCHITECTURE.md](./STORE_CONFIGURATION_ARCHITECTURE.md).

| Method | Path                       | Purpose                                                    |
| ------ | -------------------------- | ---------------------------------------------------------- |
| GET    | `/api/v1/store/home`       | Assembled homepage: ordered sections with resolved content |
| GET    | `/api/v1/store/promotions` | Currently visible promotions, highest priority first       |
| GET    | `/api/v1/store/banners`    | Currently visible banners for a placement                  |

## 14. Audit

Every meaningful marketing mutation writes one `AuditLog` entry through the existing model — Phase H added no second audit store. A `PATCH` that changes nothing writes nothing: each update handler diffs the submitted patch against the loaded record and audits only when that field list is non-empty, so an idempotent save does not accumulate no-op history.

| Domain    | Actions                                                                                       |
| --------- | --------------------------------------------------------------------------------------------- |
| Coupon    | `COUPON_CREATED`, `COUPON_UPDATED`, `COUPON_ENABLED`, `COUPON_DISABLED`, `COUPON_ARCHIVED`    |
| Promotion | `PROMOTION_CREATED`, `PROMOTION_UPDATED`, `PROMOTION_ACTIVATED`, `PROMOTION_ARCHIVED`         |
| Banner    | `BANNER_CREATED`, `BANNER_UPDATED`, `BANNER_ACTIVATED`, `BANNER_ARCHIVED`, `BANNER_REORDERED` |
| Homepage  | `HOMEPAGE_UPDATED`, `HOMEPAGE_REORDERED`                                                      |

Each entry records the acting Super Admin, the resource type and id, the request id and a metadata object naming the fields that changed. Reading the trail is covered in [SYSTEM_OPERATIONS_ARCHITECTURE.md](./SYSTEM_OPERATIONS_ARCHITECTURE.md).

## 15. Performance

The indexes added by this phase follow the queries that exist rather than the queries that might, and no index duplicates the prefix of another.

| Collection   | Index                                       | Serves                                               |
| ------------ | ------------------------------------------- | ---------------------------------------------------- |
| `promotions` | `{ slug: 1 }` unique                        | Slug uniqueness and lookup                           |
| `promotions` | `{ status: 1, startAt: 1, endAt: 1 }`       | The public visibility filter                         |
| `promotions` | `{ priority: -1, createdAt: -1 }`           | The admin priority listing and the public sort       |
| `banners`    | `{ placement: 1, status: 1, priority: -1 }` | The public placement read, which is always all three |
| `banners`    | `{ status: 1, startAt: 1, endAt: 1 }`       | The window filter when no placement narrows it       |

A single-field index on `promotions.status`, `banners.status` or `banners.placement` would be redundant — each is already the leading field of a compound index above — so none is declared. `homepageconfigurations` needs only the unique index on `key` that makes it a singleton; the document is fetched by that key and its sections are ordered in memory. The coupon indexes were left exactly as the commerce foundation defined them.

Public reads are bounded before they are cheap: `maxPublicPromotions` is 20, `maxPublicBanners` is 12, `maxSectionProducts` is 24, `maxSectionCategories` is 12, `maxHomepageSections` is 20, and every one of those caps is applied with `Math.min` against the caller's requested limit rather than trusting it. There is no cache layer and no Redis, which is what makes an admin change visible on the storefront immediately.

## 16. Deferred

Deliberately out of scope for this phase, and unimplemented: email, SMS and push campaigns; marketing automation and drip sequences; affiliate, loyalty and referral programmes; ad-platform integrations; AI-generated marketing copy; A/B testing of layouts or banners; per-segment or per-customer promotion targeting; scheduled publishing via a background worker; a free-form page builder; a second discount, stacking or eligibility engine of any kind. Promotions carry no discount semantics and are not planned to; if MansooriKart ever needs campaign-scoped pricing, it belongs in the coupon authority or in the pricing rules described in [PRICING_ARCHITECTURE.md](./PRICING_ARCHITECTURE.md), not here.
