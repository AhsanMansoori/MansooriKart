# MansooriKart Supplier CSV Catalog Import Architecture

Phase G: how a supplier's product list becomes reviewable MansooriKart catalogue data. Everything
below describes the implemented `/api/v1` runtime (`backend/src/services/catalogImportService.ts`,
`backend/src/routes/v1/adminCatalogImports.ts`, `backend/src/utils/csv.ts`,
`backend/src/config/dropshipping.ts`). The removed legacy `/api/*` runtime has no active consumer.

Companion documents: [DROPSHIPPING_ARCHITECTURE.md](./DROPSHIPPING_ARCHITECTURE.md) for fulfilment
and publication, [PRICING_ARCHITECTURE.md](./PRICING_ARCHITECTURE.md) for how a selling price is
derived from a supplier cost.

## 1. The one rule the whole design serves

**An import creates `DRAFT` products and nothing else.** `status: 'DRAFT'` is written
unconditionally by the create path and has no configuration switch, no query parameter, and no
override. A successful import means "these rows are now reviewable", never "these products are on
sale". Publication is a separate, deliberate admin act with its own validation — see
[DROPSHIPPING_ARCHITECTURE.md](./DROPSHIPPING_ARCHITECTURE.md) §13.

Two corollaries are enforced in the same place: a supplier feed sets **supplier cost only** and
never the MansooriKart selling price, and a repeat import never overwrites an admin-curated
canonical field unless that specific field was explicitly opted in.

## 2. Four explicit steps

| Step | Request                                          | Writes                                  |
| ---- | ------------------------------------------------ | --------------------------------------- |
| 1    | `POST /api/v1/admin/catalog-imports`             | Job + stored file. No catalogue change. |
| 2    | `POST /api/v1/admin/catalog-imports/:id/mapping` | Job mapping. No catalogue change.       |
| 3    | `GET /api/v1/admin/catalog-imports/:id/preview`  | Nothing at all.                         |
| 4    | `POST /api/v1/admin/catalog-imports/:id/import`  | `DRAFT` products + sourcing records.    |

The server keeps the uploaded bytes between steps in `CatalogImportFile`, so mapping, preview, and
import all read the _same_ input and a client cannot substitute a different file halfway through.
The file is never echoed back in a response — a job projection is not a download endpoint for
supplier data.

Splitting the lifecycle this way is what makes the draft guarantee auditable: exactly one of the
four steps writes products, and it always writes them as `DRAFT`.

## 3. Upload

The CSV arrives as a **raw body** with a `text/csv`-family content type (`text/csv`,
`application/csv`, `text/plain`, `application/vnd.ms-excel`, `application/octet-stream`); the
supplier, file name, and optional `fulfillmentType` travel as strict query parameters. Anything
else is `415 CSV_CONTENT_TYPE_UNSUPPORTED`. No multipart dependency and no CSV library were added
in this phase.

The route-scoped body parser's `limit` is the real file ceiling, so an oversize upload is refused
before it is buffered (`413 REQUEST_BODY_TOO_LARGE`). The global JSON parser is content-type gated
and never touches these bytes.

The response carries the parsed header row, a heuristic `suggestedMapping` (headers normalised to
lowercase alphanumerics and matched against known aliases), and this supplier's saved
`templateMapping` if one exists, so an operator confirms a mapping instead of retyping one.

## 4. Ingestion bounds

Every limit is defined once in `backend/src/config/dropshipping.ts` and checked while scanning,
so a hostile or malformed upload is rejected at the byte that breaks a bound rather than after the
whole file has been materialised:

| Bound             | Value       |
| ----------------- | ----------- |
| `maxFileBytes`    | 5 MiB       |
| `maxRows`         | 5,000       |
| `maxColumns`      | 60          |
| `maxHeaderLength` | 120 chars   |
| `maxFieldLength`  | 2,000 chars |
| `previewRows`     | 20          |
| `batchSize`       | 500         |

The reader is a bounded RFC 4180 parser (`backend/src/utils/csv.ts`) with no XLSX support, no type
inference, and no evaluation of any cell. It strips a BOM, requires valid UTF-8, rejects binary
uploads by scanning for NUL and stray C0 control bytes rather than trusting the file extension or
declared content type, and detects the delimiter (`,` `;` tab) by counting candidates outside
quotes on the header line only.

Structural problems that make a file unreadable throw and fail the request; a row-level problem a
caller can report per row does not.

| Code                     | Meaning                                        |
| ------------------------ | ---------------------------------------------- |
| `CSV_NOT_TEXT`           | Binary content detected                        |
| `CSV_EMPTY`              | Zero bytes                                     |
| `CSV_TOO_LARGE`          | Above the byte ceiling                         |
| `CSV_ENCODING_INVALID`   | Not valid UTF-8                                |
| `CSV_HEADER_MISSING`     | No usable header row                           |
| `CSV_HEADER_BLANK`       | A blank column header                          |
| `CSV_HEADER_DUPLICATE`   | The same header twice                          |
| `CSV_HEADER_TOO_LONG`    | Header above 120 chars                         |
| `CSV_TOO_MANY_COLUMNS`   | Above 60 columns                               |
| `CSV_FIELD_TOO_LONG`     | A cell above 2,000 chars                       |
| `CSV_QUOTE_INVALID`      | Malformed quoted value                         |
| `CSV_QUOTE_UNTERMINATED` | A quoted value never closed                    |
| `CSV_NO_DATA_ROWS`       | Header present, no data rows                   |
| `CSV_TOO_MANY_ROWS`      | Stored file exceeds the 5,000-row import limit |

Parser internals never reach a client. `CsvFormatError.code` is translated through a fixed map into
a stable API code and an operator-readable message; no offset, stack, or parser text is ever
returned, and an unrecognised parser code degrades to `CSV_INVALID`.

## 5. Column mapping

A mapping is a list of `{ column, target }` pairs. `GET /api/v1/admin/catalog-imports/mapping-targets`
publishes the vocabulary and the limits so a client never hard-codes them.

| Target                            | Lands on                                |
| --------------------------------- | --------------------------------------- |
| `supplierSku` **(required)**      | `SupplierCatalogItem.supplierSku`       |
| `name` **(required)**             | `Product.name`                          |
| `supplierCost` **(required)**     | `SupplierCatalogItem.supplierCost`      |
| `description`                     | `Product.description`                   |
| `supplierStock`                   | `SupplierCatalogItem.supplierStock`     |
| `category`                        | `Product.category`                      |
| `brand`                           | `Product.brand`                         |
| `imageUrl` / `imageUrls`          | `Product.image` / `images`, source URLs |
| `weight` `color` `size` `barcode` | `SupplierCatalogItem.metadata`          |
| `externalId`                      | `SupplierCatalogItem.sourceExternalId`  |
| `supplierSuggestedRetailPrice`    | `Product.supplierSuggestedRetailPrice`  |

Without the three required targets a row cannot identify a supplier line, name a product, or be
costed, so a mapping missing any of them is rejected at step 2. A target may be mapped once, a
column must exist in the uploaded header row, and the mapping is stored on the job with
`confirmedAt` / `confirmedBy`.

**Unmapped columns are ignored entirely.** No arbitrary supplier column is persisted anywhere, so a
CSV cannot smuggle fields into the catalogue. Passwords, bank details, API keys, and supplier
credentials have no mapping target and no storage location — there is nothing in the schema for
them to land in.

`supplierSuggestedRetailPrice` is the deliberately separate, differently named home for a
supplier's MSRP. It is recorded for reference and is **never** treated as the MansooriKart selling
price.

Setting `saveAsTemplate: true` (with a `templateName`) stores the mapping as this supplier's saved
template, which the next upload offers back. One current template per supplier, no version history.

## 6. Row validation

Row numbers are 1-based as a human counts them in a spreadsheet, with the header as row 1.

Hard failures (row becomes `INVALID`, nothing is written for it): missing supplier SKU, supplier
SKU over 120 characters, missing name, missing cost, non-numeric cost, negative cost, cost above
100,000,000, non-numeric stock, negative stock, stock above 10,000,000, a cell count that disagrees
with the header, and a supplier SKU repeated inside the same file.

Warnings (row still lands, operator is told): no stock reported (availability becomes `UNKNOWN`),
an unusable suggested retail price (ignored), no description (the name is used), no category (the
`Uncategorized` placeholder is used, which publication validation then refuses), rejected image
URLs, and no usable image (a placeholder is used).

Numbers are parsed tolerantly — thousands separators and currency noise are stripped — but the
cleaned value must still be a well-formed number; `12.3.4` or `abc` is a failure, not a guess.

**A supplier SKU that appears more than once in one file fails on every occurrence** (§46) rather
than being resolved by "last row wins", which would silently discard one of the operator's rows.

## 7. Image URLs are validated, never fetched

`safeImageUrl` accepts a site-relative path or an absolute `http`/`https` URL up to 2,000
characters and rejects everything else, including private and link-local hosts (`localhost`,
`127.*`, `10.*`, `192.168.*`, `169.254.*`, `172.16–31.*`, `::1`, `fc00:`, `fe80:`, and the cloud
metadata hostname). Multi-image cells split on pipes, newlines, or commas, deduplicate, and cap at
10 URLs.

**Nothing is downloaded, HEADed, or probed server-side.** The import stores a URL string; SSRF is
absent from the import path by construction, and the host rejections exist so a stored URL cannot
later become an internal request when some other component renders it.

## 8. Spreadsheet-injection safety

`csvSafeValue` / `csvCell` (`backend/src/utils/csv.ts`) prefix any value beginning with `=`, `+`,
`-`, `@`, tab, or carriage return with an apostrophe, so a supplier-supplied cell such as
`=cmd|'/c calc'!A1` cannot execute when a MansooriKart-generated CSV is opened in Excel or Sheets.
Neutralisation happens at export only; stored data is never mangled by it.

## 9. Preview

The preview reads a bounded sample (20 rows) and **writes nothing** — no `Product`, no
`SupplierCatalogItem`, not even the job. Per row it returns the mapped values, `VALID` / `INVALID`,
the predicted action, supplier cost / stock / derived availability, the pricing rule that would
apply, the suggested price with its gross margin, `priceWillBeApplied`, the image count, the
current product if the supplier line already resolves to one, and the full error and warning lists.

`mapRows` is pure and is shared verbatim by preview and import, which is what makes the preview a
faithful prediction rather than a second implementation that can drift. `hasMoreRows` reports that
the file continues past the sample.

`priceWillBeApplied` is only ever true for a brand-new product; a product an admin already prices is
never repriced by an import.

## 10. Matching, creating, updating

Matching is deterministic on `{ supplier, supplierSku }`, backed by the unique index on
`SupplierCatalogItem`. Per row:

| Condition                                              | Action   |
| ------------------------------------------------------ | -------- |
| Row has errors                                         | `FAIL`   |
| No sourcing record for this supplier + SKU             | `CREATE` |
| Sourcing record exists, mapped values hash identically | `SKIP`   |
| Sourcing record exists, values differ                  | `UPDATE` |
| Sourcing record exists but its product is gone         | `FAIL`   |

`SKIP` is what makes re-uploading yesterday's file a no-op instead of a cascade of pointless writes
and audit entries: `sourceRowHash` is a hash of the mapped values, so an unchanged row is
recognised as unchanged. A sourcing record whose product has been deleted is _reported_, never
silently re-created, because re-creating would produce a second catalogue entry for the same
supplier line.

**A create writes:** a `DRAFT` product with a server-generated `MK-…` SKU and unique slug,
`stock: 0` (an imported product owns no warehouse units), `costPrice` = supplier cost,
`sourceType: 'SUPPLIER_CSV'`, `sellingPriceOverridden: false`, the job's `fulfillmentType`, and a
`price` that is either the pricing rule's suggestion (when the operator opted in) or `0` — which
publication validation then refuses until an admin sets one. Alongside it, the sourcing record with
cost, stock, derived availability, `supplierStockUpdatedAt`, `sourceRowHash`, `sourceImageUrls`,
`lastImportedAt`, and the supplier's weight / colour / size / barcode in `metadata`.

**An update refreshes the sourcing record** — cost, stock, availability, timestamps, hash — and
touches canonical product fields only where explicitly opted in. `allowFieldOverwrite` covers
`name`, `description`, `category`, `brand`, and `images`; every flag defaults to **false**, so a
partial body is always the safe body and the default behaviour of a repeat import is to preserve
everything the admin curated. `price`, `status`, and the publication fields are absent from the
patch by construction: a supplier feed can neither reprice nor publish.

`costPrice` is refreshed from supplier cost for `DROPSHIP` products only. For `OWN_STOCK`, goods
receipts remain the cost authority, which keeps a single COGS basis across both fulfilment types.

## 11. What changed, reported per row

A repeat import reports movement as before/after pairs on the row diagnostic, so an operator sees a
price rise or a sell-out without diffing two imports by hand:

```
changes.cost         { oldCost, newCost, difference, percentChange }
changes.stock        { oldStock, newStock }              e.g. 50 → 0
changes.availability { oldAvailability, newAvailability } e.g. IN_STOCK → OUT_OF_STOCK
changes.unchanged    true, on a SKIPPED row
```

A cost movement at or above `SIGNIFICANT_COST_CHANGE_PERCENT` (10%) additionally raises a
`CATALOG_IMPORT_COST_CHANGES` audit entry. It does **not** change any selling price: a product whose
price an admin set keeps that price, and the operator decides whether to reprice through the pricing
endpoints.

**A supplier stock change is not an `InventoryMovement`.** Nothing in the import path writes to
`InventoryBalance` or `InventoryMovement`; a feed updating a supplier's reported quantity is a
sourcing-record update and nothing more.

## 12. Job and row records

`CatalogImportJob` (collection `catalogimportjobs`): `jobNumber` (unique, server-generated),
`supplier`, `fileName` (sanitised), `fileSize`, `status`, `headers`, `mapping`
(`entries`, `allowFieldOverwrite`, `confirmedAt`, `confirmedBy`), `pricingRule`,
`applyPricingToNewProducts`, `fulfillmentType`, the counters `totalRows` / `validRows` /
`invalidRows` / `createdRows` / `updatedRows` / `skippedRows` / `failedRows`, `startedAt`,
`completedAt`, `createdBy`, `errorSummary`, timestamps.

| Status       | Meaning                                               |
| ------------ | ----------------------------------------------------- |
| `UPLOADED`   | File stored, header parsed, mapping not yet confirmed |
| `VALIDATING` | Being checked                                         |
| `READY`      | Mapping confirmed; the import may be run              |
| `IMPORTING`  | Claimed by a run in progress                          |
| `COMPLETED`  | Every row landed                                      |
| `PARTIAL`    | Some rows landed, at least one did not                |
| `FAILED`     | Nothing landed                                        |
| `CANCELLED`  | Abandoned before importing                            |

`CatalogImportRow` (collection `catalogimportrows`) answers, per row: row number, supplier SKU,
product name, `result`, `action`, the resulting product and sourcing record, errors, warnings, and
the change summary. Results are `VALID`, `INVALID`, `CREATED`, `UPDATED`, `SKIPPED`, `FAILED`.
Diagnostics travel as a stable `code`, an optional `field`, and an operator-readable `message`.

## 13. Honest completion status

```
problems = invalidRows + failedRows
landed   = createdRows + updatedRows + skippedRows

problems === 0            → COMPLETED
problems > 0, landed === 0 → FAILED
otherwise                  → PARTIAL
```

**One invalid or failed row is enough to make a job `PARTIAL`.** There is no threshold below which
failures are rounded away to success, and `COMPLETED` is never reported when a row did not land.
`errorSummary` carries the top 20 error codes with counts, and the per-row endpoint carries the
detail.

## 14. Concurrency and retries

The import is claimed with one atomic `findOneAndUpdate` on `{ _id, status: 'READY' }`:

- The winner imports. A concurrent second caller is told `409 IMPORT_IN_PROGRESS`.
- A caller who retries after the job finished receives the finished job with `replayed: true` —
  never a second set of products.
- A job that is not `READY` is `409 IMPORT_JOB_NOT_READY`.
- Because the claim guarantees no concurrent writer, a retry after an interrupted attempt clears the
  previous run's row diagnostics first, keeping the run idempotent.

Nothing depends on a client disabling a button. Batch inserts use unordered `insertMany` and then
**ask the database which documents actually landed**, so a per-document duplicate or validation
failure is resolved authoritatively rather than by parsing driver error shapes, and each row's
reported result reflects what really happened.

## 15. Bounded work

Rows are processed in batches of 500 for both lookups and writes — existing sources are fetched with
batched `$in` queries, creates and updates go through `insertMany` / `bulkWrite`, and row
diagnostics are written in bulk. There is no per-row database round trip. Pricing rules are loaded
once per run, not once per row.

History and row listings are paginated (`limit` ≤ 100 for jobs, ≤ 200 for rows, newest first), so a
5,000-row job is never returned in one response.

## 16. Access control and rejected client input

Every route is `SUPER_ADMIN`-only: no token is `401`, a `CUSTOMER` token is `403`. Import data is
absent from every public API — the storefront has no route that can reach a job, a row, a supplier
cost, or a sourcing record.

Bodies and queries are `.strict()` allowlists, so the server-owned parts of a job are
`400 VALIDATION_ERROR` if a client sends them: `jobNumber`, `status`, the counters, `startedAt`,
`completedAt`, `createdBy`, `errorSummary`, row `result` / `action`, `sourceRowHash`, and the
supplier ownership reference on a sourcing record. The same applies to a product's server SKU, its
publication fields, and its `createdBy` — the import generates them.

## 17. Audit

`CATALOG_IMPORT_UPLOADED`, `CATALOG_IMPORT_MAPPED`, `CATALOG_IMPORT_COMPLETED` (carrying the final
status and counters, so a `PARTIAL` run is explicit in the trail), `CATALOG_IMPORT_COST_CHANGES`,
and `CATALOG_IMPORT_CANCELLED`.

Audit metadata holds identifiers and counts only — never the CSV contents, never whole row bodies.
Ids in an entry are capped at 50.

## 18. Indexes

| Collection                | Index                         | Serves                          |
| ------------------------- | ----------------------------- | ------------------------------- |
| `catalogimportjobs`       | `{ jobNumber }` unique        | Lookup by number                |
| `catalogimportjobs`       | `{ status, createdAt: -1 }`   | History filtered by status      |
| `catalogimportjobs`       | `{ supplier, createdAt: -1 }` | History filtered by supplier    |
| `catalogimportrows`       | `{ job, rowNumber }` unique   | One diagnostic per row          |
| `catalogimportrows`       | `{ job, result, rowNumber }`  | "Show me the failures"          |
| `catalogmappingtemplates` | `{ supplier }` unique         | One saved template per supplier |

## 19. Deferred

XLSX and any non-CSV upload format, supplier API / feed-URL integrations, scheduled or automatic
imports, mapping-template version history, report _export_ to CSV or spreadsheet (the
formula-neutralisation helpers exist and are used, but no export endpoint is part of this phase),
and all frontend work.
