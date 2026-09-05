# MansooriKart CMS Architecture

Phase H added the content layer: CMS pages, FAQs and the header/footer navigation menus, together with the public endpoints that serve them. The implementation is `backend/src/routes/v1/adminCms.ts` and `backend/src/routes/v1/storefront.ts` over `backend/src/services/cmsService.ts`, with `backend/src/models/cmsPage.ts` (both `CmsPage` and `Faq`) and `backend/src/models/navigationMenu.ts` as the persistence, `backend/src/utils/contentSchemas.ts` and `backend/src/utils/sanitize.ts` as the validation and sanitisation layer, and `backend/src/serializers/marketingAdmin.ts` and `backend/src/serializers/storefront.ts` as the two projections. The legacy `/api/*` runtime is untouched, and no frontend was built in this phase.

Companion documents: [MARKETING_ARCHITECTURE.md](./MARKETING_ARCHITECTURE.md), [STORE_CONFIGURATION_ARCHITECTURE.md](./STORE_CONFIGURATION_ARCHITECTURE.md), [SYSTEM_OPERATIONS_ARCHITECTURE.md](./SYSTEM_OPERATIONS_ARCHITECTURE.md), [API_CONTRACT.md](./API_CONTRACT.md), [API_INVENTORY.md](./API_INVENTORY.md).

## 1. Content is structured blocks, not HTML

A CMS page body is not a string of markup. It is a bounded array of typed blocks, and the type vocabulary is closed:

| Block       | Fields                               | Bound                         |
| ----------- | ------------------------------------ | ----------------------------- |
| `HEADING`   | `level` (2–4), `text`                | 200 characters                |
| `PARAGRAPH` | `text`                               | 5,000 characters              |
| `LIST`      | `style` (`BULLET`/`NUMBER`), `items` | 40 items, 500 characters each |
| `QUOTE`     | `text`                               | 1,000 characters              |
| `IMAGE`     | `url`, `alt`                         | absolute `http:`/`https:` URL |
| `DIVIDER`   | —                                    | —                             |

`blockSchema` is a Zod discriminated union over those six literals, each branch `.strict()`, and `blocksField` caps a page at 120 blocks. A `HEADING` may not carry `items`; an `IMAGE` may not carry `text`; a block with an unrecognised `type` fails discrimination. There is no `html`, `raw`, `script`, `style`, `template` or `embed` field anywhere in the union, and no field whose contents a browser would execute.

That is the whole answer to "how is stored HTML sanitised": none is stored. `stripMarkup` runs as a _transform_ inside `plainText` and `optionalPlainText`, so sanitisation happens during validation and cannot be forgotten by a route author. It removes `<script>` and `<style>` elements together with their contents — so `<script>alert(1)</script>` does not leave `alert(1)` behind as visible text — then strips every remaining tag, neutralises HTML entities that could reintroduce a bracket, drops control characters, and collapses tabs and newlines to single spaces. A value that consisted only of markup ends up empty and fails the minimum-length refinement; a value that merely contained some is stored clean. Because the transform is applied before persistence, there is nothing to sanitise at render time.

Headings start at `h2`. `h1` belongs to the page title, and letting an operator emit a second `h1` inside the body is a document-outline bug waiting to happen.

## 2. Slugs, publication and `publishedAt`

`slug` is unique, lowercase and matched by `isSlug` — `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 120 characters. A create request may supply one or let the server derive it from the title with `slugify`; a title of pure punctuation yields no usable slug and returns `400 PAGE_INVALID` telling the operator to supply one explicitly, rather than silently storing an empty slug. A collision is `409 PAGE_SLUG_EXISTS`, raised from the unique index rather than from a prior read, so two concurrent creates cannot both succeed. `CmsPage.init()` is awaited before the first insert so that index is guaranteed to exist when it is relied upon.

Status is `DRAFT`, `PUBLISHED` or `ARCHIVED`. `publishFields` in `cmsService.ts` owns the `publishedAt` rule: it is stamped the first time a page becomes `PUBLISHED` and never rewritten afterwards. Editing published text does not restate the publication date, re-publishing after an archive keeps the original, and archiving preserves it so an operator can still see when the page first went live.

`POST /pages/:id/publish` and `POST /pages/:id/archive` are the explicit transitions; `DELETE /pages/:id` is a soft archive returning `{ id, archived: true }`. Nothing in this router removes a page, because a slug that has been published may be linked from elsewhere and a 404 is a better outcome than a resurrected slug pointing at different content later.

## 3. Pages record current policy, and orders record their own

The five policy documents — shipping, returns, refunds, privacy and terms — are ordinary CMS pages. They get no bespoke model, no separate table and no versioning machinery, and that is a deliberate decision rather than an omission.

A CMS page holds the store's _current_ text. What a past customer agreed to is captured in that customer's own order: each order snapshots its totals, its coupon terms and its line items at checkout, and nothing in this router touches an order. Editing the returns policy therefore changes what the next visitor reads and changes nothing about any order already placed. Adding legal versioning here would create a second, weaker record of the same fact — weaker because it would live beside the order rather than inside it.

## 4. FAQs

An FAQ entry is a `question`, an `answer`, a `category` defaulting to `General`, a `position` and a status of `DRAFT`, `ACTIVE` or `ARCHIVED`. Question and answer are plain text through the same transform as page blocks.

Ordering is explicit. `POST /faqs/reorder` takes an array of ids, verifies every id exists, and applies `position: index` in a single `bulkWrite` so the list never has two entries claiming the same position part-way through an update. The route is declared _before_ `/faqs/:id` so the literal path always wins over the parameter — otherwise `reorder` would be read as an identifier and answered with a 404.

The category filter is an exact anchored match built with `escapeRegex`:

```js
{
  category: {
    $regex: new RegExp(`^${escapeRegex(query.category)}$`, 'i');
  }
}
```

Anchored at both ends so `General` does not also match `General knowledge`, case-insensitive so an operator's capitalisation does not fragment a group, and escaped so a value like `.*` matches the literal characters rather than everything. `search` uses the same escaping across an allowlisted field set (`question`, `answer`, `category`); `sort` selects from a fixed map of three orders rather than accepting a field name.

## 5. Navigation is bounded, structured and resolved

`NavigationMenu` is one singleton document per menu, `HEADER` or `FOOTER`, enforced by a unique index on `menu`. Depth stops at one level of children, and it stops _structurally_: `navChild` has no `children` key at all, so a deeper tree cannot be submitted. An unbounded recursive menu would make the public serialization unbounded too, and a storefront menu that needs three levels is a design problem rather than a schema requirement.

Destinations are structured exactly as banners' are:

| `type`          | Required field | Validation                                                                                         |
| --------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| `INTERNAL_PATH` | `path`         | `safeInternalPath`: single leading `/`, no `//`, no `:`, no `..`, no backslash or markup character |
| `CATEGORY`      | `category`     | 24-hex identifier, must exist                                                                      |
| `PRODUCT`       | `product`      | 24-hex identifier, must exist                                                                      |
| `CMS_PAGE`      | `page`         | 24-hex identifier, must exist                                                                      |
| `EXTERNAL_URL`  | `url`          | `safeUrl`: absolute, has a hostname, scheme is `http:` or `https:`                                 |

`refineNavTarget` runs on both levels and rejects a `CATEGORY` item with no category. `PUT /navigation/:menu` replaces one menu whole — the same reasoning as the homepage layout: a menu is an ordered list, and patching it entry by entry lets two concurrent edits interleave into an order neither operator asked for. Items are capped at 30 with 20 children each.

## 6. Existence at write time, eligibility at read time

This is the rule that governs every reference in the content layer, and `cmsService.ts` enforces it in one place rather than per route.

`missingReferences` checks that each referenced product, category, page or promotion _exists_, and returns `400 REFERENCE_NOT_FOUND` listing the offenders as `field:id` when one does not. A reference to a record that does not exist can never resolve, so storing it only creates a dead link.

Publication status is a different question, and it is asked later. An operator may legitimately wire navigation to a product that is still `DRAFT` and publish that product an hour afterwards, so a write referencing a real-but-unpublished record succeeds. The public read then resolves every reference through the eligibility filter — `status: 'ACTIVE'` for products, `ACTIVE`-or-absent for categories, `status: 'PUBLISHED'` for pages — and `publicNavigationItem` returns `null` for anything the filter did not return.

Returning `null` rather than a disabled entry is the point. A menu item pointing at a draft product disappears from the public menu instead of rendering a link that 404s or, worse, advertising that a hidden record exists. The admin menu still shows the item, with its unresolved reference intact, so an operator can see and repair it.

## 7. What the storefront receives

`serializers/storefront.ts` is an allowlist per payload, never a delete list, so a field added to `CmsPage` or `NavigationMenu` later stays internal until somebody publishes it on purpose.

`publicCmsPage` returns `slug`, `title`, `excerpt`, the mapped `blocks`, an `seo` object and `publishedAt`/`updatedAt`. `seo` falls back sensibly — `metaTitle` to the page title, `metaDescription` to the excerpt, `robots` to `index,follow` — so a page with no SEO block still renders correct metadata. `status`, `createdBy`, `updatedBy` and the internal id are absent.

`publicCmsPageSummary` is the listing shape: `slug`, `title`, `excerpt`, `publishedAt`. Bodies are fetched one page at a time by slug, so a listing cannot be used to pull every page's full content in one request.

`publicFaq` returns `id`, `question`, `answer` and `category`. `position` is not published: ordering is conveyed by array position, and republishing the number invites a client to sort by it and disagree with the server.

`GET /api/v1/store/pages/:slug` requires a well-formed slug before it queries, and matches `status: 'PUBLISHED'` in the query itself. A draft page, an archived page, an unknown slug and a malformed slug all produce the identical `404 PAGE_NOT_FOUND` body, so the endpoint cannot be used to enumerate which unpublished pages exist.

## 8. API surface

All admin routes are `SUPER_ADMIN`-only: `adminCms.ts` calls `requireAuth` and `requireSuperAdmin` before any handler, so no token is `401 AUTH_UNAUTHORIZED`, a `CUSTOMER` token is `403 AUTH_FORBIDDEN`, and every body and query is parsed by a `.strict()` schema — an unknown field is `400 VALIDATION_ERROR`, never a silently ignored key. A malformed identifier is a clean `404`, never a CastError, because references are 24-hex-checked rather than cast.

| Method | Path                              | Purpose                                                  |
| ------ | --------------------------------- | -------------------------------------------------------- |
| GET    | `/api/v1/admin/pages`             | Paged page list, filterable by status and escaped search |
| POST   | `/api/v1/admin/pages`             | Create a page                                            |
| GET    | `/api/v1/admin/pages/:id`         | One page with its blocks                                 |
| PATCH  | `/api/v1/admin/pages/:id`         | Edit a page                                              |
| POST   | `/api/v1/admin/pages/:id/publish` | Publish, stamping `publishedAt` once                     |
| POST   | `/api/v1/admin/pages/:id/archive` | Archive                                                  |
| DELETE | `/api/v1/admin/pages/:id`         | Soft archive                                             |
| GET    | `/api/v1/admin/faqs`              | Paged FAQ list, filterable by status and category        |
| POST   | `/api/v1/admin/faqs`              | Create an FAQ                                            |
| POST   | `/api/v1/admin/faqs/reorder`      | Rewrite positions from an ordered id list                |
| GET    | `/api/v1/admin/faqs/:id`          | One FAQ                                                  |
| PATCH  | `/api/v1/admin/faqs/:id`          | Edit an FAQ                                              |
| DELETE | `/api/v1/admin/faqs/:id`          | Soft archive                                             |
| GET    | `/api/v1/admin/navigation`        | Both menus, ordered                                      |
| GET    | `/api/v1/admin/navigation/:menu`  | One menu (`HEADER` or `FOOTER`)                          |
| PUT    | `/api/v1/admin/navigation/:menu`  | Replace one menu                                         |

Public content reads require no token and perform no writes. They sit behind the maintenance guard described in [STORE_CONFIGURATION_ARCHITECTURE.md](./STORE_CONFIGURATION_ARCHITECTURE.md).

| Method | Path                        | Purpose                                                |
| ------ | --------------------------- | ------------------------------------------------------ |
| GET    | `/api/v1/store/pages`       | Published page references, title-ordered               |
| GET    | `/api/v1/store/pages/:slug` | One published page with its blocks and SEO             |
| GET    | `/api/v1/store/faqs`        | Active FAQs, position-ordered, optional exact category |
| GET    | `/api/v1/store/navigation`  | `header` and `footer` with every destination resolved  |

An unknown menu name on `/api/v1/admin/navigation/:menu` is `404 MENU_NOT_FOUND`; the name is upper-cased and checked against `NAV_MENUS` before anything is read, so it never reaches Mongo as a filter value.

## 9. Audit

Content mutations write to the existing `AuditLog` model. Phase H added no second audit store, and a `PATCH` whose submitted values match the stored ones writes no entry — each handler diffs the patch against the loaded record first.

| Domain     | Actions                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| Page       | `CMS_PAGE_CREATED`, `CMS_PAGE_UPDATED`, `CMS_PAGE_PUBLISHED`, `CMS_PAGE_ARCHIVED` |
| FAQ        | `FAQ_CREATED`, `FAQ_UPDATED`, `FAQ_ARCHIVED`, `FAQ_REORDERED`                     |
| Navigation | `NAVIGATION_UPDATED`                                                              |

Metadata records the slug or category and the list of changed field names, never the content itself — an audit trail is a record of who changed what, and copying page bodies into it would duplicate the content in a store that is read under different rules.

## 10. Performance

| Collection        | Index                            | Serves                                                |
| ----------------- | -------------------------------- | ----------------------------------------------------- |
| `cmspages`        | `{ slug: 1 }` unique             | Slug uniqueness and the public read by slug           |
| `cmspages`        | `{ status: 1, publishedAt: -1 }` | Published listings and the admin status filter        |
| `faqs`            | `{ status: 1, position: 1 }`     | The public read, which is always status then position |
| `faqs`            | `{ category: 1, position: 1 }`   | The category-grouped read                             |
| `navigationmenus` | `{ menu: 1 }` unique             | Singleton identity and lookup                         |

No single-field index on `status` is declared for either collection: `status` is the leading field of a compound index in both, so a separate one would be redundant write cost for no read benefit.

Every list is bounded. Admin pagination caps `limit` at 100; the public FAQ read caps at `maxPublicFaqs` (100); the public page listing caps at `maxPageSize` (100); navigation is capped at 30 items with 20 children by the schema that accepted it, and again by `orderedNavigation` when it is read. Ordering happens in memory for the two singletons, which is correct for a bounded list held in one document and avoids an index that exists only to sort thirty rows.

There is no cache and no Redis. Each public read is a query, which is what lets a publish take effect immediately.

## 11. Deferred

Not implemented, deliberately: a WYSIWYG or drag-and-drop page editor; arbitrary HTML or template code in content; scheduled publication via a background worker; content versioning, revisions or draft previews of a published page; legal-document versioning with per-order acceptance records; multi-language content and translations; media library and upload handling; blog or article domains with authors, tags and feeds; comments; per-page access control; nested navigation beyond one level of children. The five policy pages remain ordinary CMS pages, and their per-order legal record remains the order's own snapshot.
