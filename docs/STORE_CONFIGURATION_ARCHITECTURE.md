# MansooriKart Store Configuration Architecture

Phase H made the store's own settings editable: identity, contact details, social links, SEO metadata, shipping, tax, invoice presentation, transactional-email behaviour and maintenance mode. The implementation is `backend/src/routes/v1/adminSettings.ts` over `backend/src/services/storeConfigService.ts`, with `backend/src/models/storeConfiguration.ts` as the single persisted document, `backend/src/config/storefront.ts` as the defaults and bounds, and `backend/src/serializers/storefront.ts` / `marketingAdmin.ts` as the public and admin projections. `backend/src/routes/v1/storefront.ts` serves the customer-facing reads. The legacy `/api/*` runtime is untouched, and no frontend was built in this phase.

Companion documents: [MARKETING_ARCHITECTURE.md](./MARKETING_ARCHITECTURE.md), [CMS_ARCHITECTURE.md](./CMS_ARCHITECTURE.md), [SYSTEM_OPERATIONS_ARCHITECTURE.md](./SYSTEM_OPERATIONS_ARCHITECTURE.md), [ORDERS_SALES_ARCHITECTURE.md](./ORDERS_SALES_ARCHITECTURE.md), [PRICING_ARCHITECTURE.md](./PRICING_ARCHITECTURE.md), [API_CONTRACT.md](./API_CONTRACT.md), [API_INVENTORY.md](./API_INVENTORY.md).

## 1. One document, and it cannot become two

`StoreConfiguration` is a singleton: one record keyed `STORE`, with `key` enumerated to that one literal and carrying a unique index. The uniqueness lives in the database rather than in a "have we created it yet?" check, which is what makes concurrent initialisation safe.

`ensureStoreConfiguration()` is the only way in:

```ts
await StoreConfiguration.init();
const existing = await StoreConfiguration.findOne({ key: STORE_CONFIG_KEY });
if (existing) return existing;
try {
  return await StoreConfiguration.findOneAndUpdate(
    { key: STORE_CONFIG_KEY },
    { $setOnInsert: { key: STORE_CONFIG_KEY } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
} catch (error: any) {
  if (error?.code !== 11000) throw error;
  return await StoreConfiguration.findOne({ key: STORE_CONFIG_KEY });
}
```

Three things are doing work here. `init()` is awaited so the unique index is built before the first insert relies on it — Mongoose caches that, so it costs one round trip on the first call and nothing afterwards. `$setOnInsert` makes the upsert idempotent: a second caller that finds the document does not restate its fields, so an insert can never overwrite settings an operator already saved. And the `11000` branch turns the losing side of a race into a plain read of the winner's document rather than a 500. Two simultaneous first requests therefore produce one record and two identical successful responses.

Because the getter initialises, no bootstrap step or seed script is required — the first request that needs a setting creates the document with schema defaults. One consequence is worth knowing when reading test output: `GET /api/v1/admin/system/health` calls `getStoreConfiguration()`, so hitting health on an empty database creates the singleton as a side effect.

## 2. Typed sections, not a key/value bag

Every setting is a declared field in a typed sub-document — `contact`, `socialLinks`, `seo`, `shipping`, `tax`, `invoice`, `email` — with an enum, a length or a numeric range attached. There is no `settings: Mixed` map and no `key`/`value: any` collection.

A generic store would have been less code and considerably worse. A reader would have to guess at types and tolerate absent keys; a writer could invent `shippnigFee` and have it silently accepted; and no bound could be enforced, so one settings write could make the public config payload arbitrarily large. Instead each route in `adminSettings.ts` has its own `.strict()` Zod schema, so an unknown field is `400 VALIDATION_ERROR` rather than a stored surprise, and `updateStoreConfiguration` receives only keys a schema already accepted.

Numbers are bounded where they matter: `standardFee` at `SHIPPING_DEFAULTS.maxFee` (100,000), `freeShippingThreshold` at `maxThreshold`, `defaultRate` at 100, `cityOverrides` at 50 entries with each city unique after case-folding, `lowStockThreshold` at 10,000. Strings that a customer will see run through the `plainText`/`optionalPlainText` transforms, so markup is stripped on the way in exactly as it is for CMS content.

## 3. A PATCH edits keys, not sections

`updateStoreConfiguration(section, patch, actor)` flattens the patch to dotted paths before it writes:

```ts
set[section ? `${section}.${key}` : key] = value;
```

So `PATCH /settings/shipping` with `{ "standardFee": 300 }` writes `shipping.standardFee` and leaves `freeShippingThreshold`, `codEnabled` and the city overrides exactly as they were. Sending the whole sub-document would have been the easier implementation and the wrong one: an admin form that only renders half the fields would silently reset the other half to defaults.

`applySection` in the route layer diffs first. It loads the current configuration, compares each submitted key against what is stored by structural equality, and if nothing differs it returns the current state without writing and without auditing. An admin UI that submits its entire form on every save therefore produces one audit entry when something changed and none when nothing did.

`socialLinks` is the one exception to key-level patching, and deliberately so — see §6.

## 4. Currency relabels; it never converts

`defaultCurrency` defaults to `PKR` and `currencyDisplay` selects between `SYMBOL`, `CODE` and `SYMBOL_CODE`. Changing the code changes what a customer sees printed next to a number and changes nothing about the number.

MansooriKart stores every amount in one currency and has no exchange-rate source, no rate cache and no per-currency price list. A conversion layer that inferred rates would silently restate historical order totals in a currency they were never placed in, so the setting is honest about being a label. Multi-currency remains deferred.

## 5. The timezone is a display clock

`timezone` defaults to `Asia/Karachi` and is validated against the runtime's own IANA database rather than a hand-maintained list:

```ts
new Intl.DateTimeFormat('en-US', { timeZone: value });
```

If the constructor throws, the value is rejected. This catches typos (`Asia/Karachchi`) without pinning the application to a snapshot of the tz database.

Every timestamp in MongoDB is UTC, and nothing in this router rewrites one. Switching the store clock to `Asia/Dubai` changes how a future admin screen formats an order date; it does not move when that order was placed, does not shift a report boundary retroactively, and does not touch `createdAt` on any record. The Finance and Reports domains keep reading the same instants they always did.

## 6. Contact details and social links

Contact settings hold both customer-facing channels (`supportEmail`, `supportPhone`, `whatsapp`, `supportHours`) and internal ones (`businessEmail`, `businessPhone`), plus a postal address whose `country` defaults to `Pakistan`. Emails are format-validated and lower-cased. Phone numbers are format-checked, not parsed — `^[+]?[\d\s()-]{5,40}$` — because a Pakistani mobile, a landline with an area code and a WhatsApp number in international form are all legitimate, and a parser that "normalised" them would eventually mangle one.

Social links are one entry per channel from a closed set — `FACEBOOK`, `INSTAGRAM`, `TIKTOK`, `YOUTUBE`, `LINKEDIN`, `X` — each with an `http`/`https` URL and an `enabled` flag. `PATCH /settings/social` replaces the whole list, capped at the number of channels that exist, and a `superRefine` rejects a body naming the same channel twice. Replacing rather than patching keeps "which channels the store has" one decision instead of a merge, and the duplicate check prevents two conflicting Instagram URLs from both being stored with no rule about which wins.

`httpUrl` is the same validator used by banners and CMS images: the value must parse as an absolute URL, have a hostname, and use `http:` or `https:`. A `javascript:`, `data:` or `file:` URL fails, and the server never fetches any of these URLs — they are validated structurally and handed to the client as-is.

## 7. SEO metadata cannot inject a header

The SEO section holds `metaTitle`, `metaDescription`, up to 30 `metaKeywords`, `canonicalUrl`, `robots`, `socialImageUrl`, OpenGraph title and description, and a Twitter handle.

Two fields are the ones that would otherwise be dangerous. `robots` is an enum over exactly four directives — `index,follow`, `noindex,follow`, `index,nofollow`, `noindex,nofollow` — rather than a free string, so an operator cannot type a value containing a newline and have it emitted into a response header or a meta tag as a second directive. `canonicalUrl` and `socialImageUrl` go through `httpUrl`, so a canonical link can never carry a `javascript:` target.

Every text field is a `plainText` transform, which strips markup and drops control characters including CR and LF. That is the actual header-injection defence: the characters needed to break out of a header value do not survive validation, so nothing downstream has to remember to re-escape. `twitterHandle` is matched against `^@?[A-Za-z0-9_]{1,15}$`, which is the platform's own shape.

## 8. Shipping settings are what checkout charges

This is the section with real money attached, so the integration matters more than the schema.

Before Phase H, checkout applied a flat PKR 250 delivery fee waived at PKR 5,000. Those exact numbers are now `SHIPPING_DEFAULTS`, and the schema defaults to them. A store that never opens the settings API charges precisely what it charged before — "unconfigured" and "configured to the old values" are the same code path, not two paths that happen to agree.

`quoteShipping(config, discountedSubtotal, city)` has a fixed order of precedence:

1. Shipping disabled → 0.
2. Free shipping enabled and the discounted subtotal is at or above the threshold → 0.
3. A city override matching the address city, case-folded and trimmed → that fee.
4. Otherwise the standard fee.

Free shipping is checked _before_ city overrides on purpose: a customer who has earned free delivery must not then be charged a surcharge for living in an expensive city. The comparison is `>=`, so an order landing exactly on the threshold ships free.

The inputs are the point. `orderService.checkout` calls:

```ts
const shipping = quoteShipping(storeConfig, discountedSubtotal, (address as any).city),
  tax = computeTax(storeConfig, discountedSubtotal),
  total = money(Math.max(0, discountedSubtotal + shipping + tax));
```

`discountedSubtotal` is the server's own figure, computed from server-loaded product prices minus the coupon discount the coupon authority approved. `address.city` comes from the address document the server loaded by id for that customer. There is no shipping field in the checkout request body, so a client cannot propose a delivery total, cannot zero one out, and cannot claim a city it did not give as its delivery address.

Two further guarantees follow from where this code sits. Because `storeConfigService` reads the singleton per request with no cache, a fee change takes effect on the next checkout with no restart and no cache-invalidation protocol. And because an order snapshots its own `shipping`, `tax` and `total` at creation, changing the fee afterwards leaves every existing order exactly as it was — the settings API has no write path that touches an order.

`codEnabled` gates the only payment method the store offers. It defaults to `true`, which is the behaviour every existing order was placed under; switching it off makes `checkout` raise `PAYMENT_METHOD_UNAVAILABLE`, which is an operator deliberately closing checkout rather than a bug.

## 9. Tax is a foundation, disabled by default

`tax` holds `enabled`, `defaultRate`, `pricesIncludeTax`, `displayTaxSeparately`, a `label` and a `taxNumber`. It defaults to disabled with a zero rate, which reproduces the pre-Phase-H behaviour exactly: every order was taxed at zero, and an unconfigured store still is.

`computeTax(config, taxableBase)` returns zero unless an admin has explicitly enabled tax with a positive rate, and returns zero when `pricesIncludeTax` is set — inclusive pricing means the tax is already inside the item prices, so adding a line would charge it twice. Otherwise it is `taxableBase * rate / 100`, rounded to two decimals.

The base is the server's discounted subtotal. Delivery is not taxed, and no customer-supplied tax value is accepted anywhere: there is no tax field in the checkout body and no override parameter. That is the whole of the tax authority — there is no jurisdiction table, no province matrix, no HS-code mapping and no third-party tax service. Those are a tax _engine_, and a store that needs one needs it designed against real filing requirements rather than inferred from a rate field.

Historical orders are unaffected for the same reason shipping changes are: totals were snapshotted at checkout, and Finance and Reports read those stored values rather than recomputing from current settings.

## 10. Invoice settings are presentation only

`invoice` holds `showLogo`, `showTaxNumber`, `footerNote`, `termsNote` and `contactLine`. There is no second invoice engine here — the PDF generator built in an earlier phase remains the single invoice authority, and every figure it prints comes from the order's own immutable snapshot.

The distinction is worth stating plainly because it is easy to get wrong: turning on `showTaxNumber` adds the store's registration number to the document, and editing `footerNote` changes the text at the bottom. Neither recomputes a line, a subtotal, a delivery fee, a tax amount or a total. There is no configuration in this section that could restate what a customer was charged.

## 11. Email settings hold behaviour, never credentials

This is the section most likely to attract a credential, so it is built to refuse one.

`email` holds `fromName`, `replyTo`, `supportEmail`, `brandingHeadline`, `brandingFooter` and four behaviour flags: `orderConfirmationEnabled`, `shippingUpdateEnabled`, `deliveryEmailEnabled`, `includeInvoiceLink`. There is no `host`, no `port`, no `username`, no `password`, no `apiKey` and no `secret` field — not in the Zod schema, not in the Mongoose schema, and not in `config/storefront.ts`.

Because the schema is `.strict()`, an operator or an integration that posts `{ "smtpPassword": "…" }` receives `400 VALIDATION_ERROR`. The failure mode this closes is not an attack but a well-meaning mistake: someone wiring up mail, finding an email settings endpoint, and putting an SMTP password in a database that is backed up, replicated and read by more code than the mail adapter. Runtime secrets stay in the deployment environment where secret rotation, access control and redaction already apply.

Templates are fixed in code. `brandingHeadline` and `brandingFooter` are plain text through the same markup-stripping transform as everything else, so there is no template language, no partial include and nothing executable an operator could inject into an outbound message.

## 12. Maintenance mode closes content, not the building

`maintenanceMode` is a boolean with a `maintenanceMessage` that defaults to a deliberately generic, non-technical sentence. When it is on, the public storefront content routes answer `503 STORE_MAINTENANCE` with the operator's message.

What it does not close is the important half:

| Surface                                                                                               | Behaviour under maintenance                                                                               |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/store/config`                                                                            | Still 200 — a client showing the message needs the store name, the message itself and the support contact |
| `GET /api/v1/store/home`, `/navigation`, `/faqs`, `/pages`, `/pages/:slug`, `/promotions`, `/banners` | `503 STORE_MAINTENANCE`                                                                                   |
| Health endpoints                                                                                      | Unaffected — a monitor must still see that the process is alive                                           |
| Super Admin authentication and every `/api/v1/admin/*` route                                          | Unaffected — an operator must be able to sign in and fix the store while it is closed                     |

The guard is a per-route middleware inside `storefront.ts`, not an application-level one, which is why the exemptions are structural rather than a list of paths to skip: routes that are not in this router cannot be affected by it.

## 13. What the storefront receives

`publicStoreConfig` is an allowlist. It publishes store identity (`storeName`, `legalName`, `tagline`, `logoUrl`, `faviconUrl`), the currency code and display, the timezone and locale, customer-facing contact fields, enabled social links reduced to `{ channel, url }`, the SEO block with an assembled `openGraph` object, the shipping numbers a storefront must be able to state before checkout, four tax display flags, and the maintenance state.

What it withholds is the more interesting list, and each omission has a reason:

| Withheld                                         | Why                                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `contact.businessEmail`, `contact.businessPhone` | Internal operator contacts, not customer support channels                                                            |
| `tax.taxNumber`                                  | Belongs on the rendered invoice, not in a public config feed                                                         |
| `invoice.*`                                      | Invoice presentation is between the store and the document it generates                                              |
| `email.*`                                        | Transactional-email behaviour is internal, and publishing which emails are enabled tells a client nothing it can use |
| `lowStockThreshold`, `orderPrefix`               | Operational settings; a stock threshold is a hint about inventory the storefront has no business inferring           |
| `updatedBy`, `createdAt`, `updatedAt`, `_id`     | Audit and identity surface                                                                                           |

The shipping block _is_ published, and that is not a contradiction of §8. A storefront has to be able to say "delivery is PKR 250, free over PKR 5,000" before a customer reaches checkout. These are the same numbers the server will charge, read from the same functions — not a client-side calculation the server later trusts. The server recomputes the fee at checkout regardless of what the client displayed.

`socialLinks` filters on `enabled !== false` and drops the flag from the output, so a disabled channel is absent rather than present-and-marked-off. A client cannot render a link the operator switched off, and cannot discover that the channel exists.

Every public read here is uncached and per-request. That is what §46 asks for — a configuration change is live on the next request, with no restart, no worker coordination and no window during which two processes disagree about the delivery fee. The routes are cache-friendly by construction (no session, no per-customer variation, no `Vary` beyond the obvious), but this phase adds no cache layer and no Redis.

## 14. API surface

Admin settings routes are `SUPER_ADMIN`-only: `adminSettings.ts` applies `requireAuth` and `requireSuperAdmin` before any handler, so no token is `401 AUTH_UNAUTHORIZED` and a `CUSTOMER` token is `403 AUTH_FORBIDDEN`. Every body is parsed by a `.strict()` schema, so an unknown field is `400 VALIDATION_ERROR`. There is no mass-assignment path: `key`, `_id`, `createdAt`, `updatedAt` and `updatedBy` appear in no schema, and `updatedBy` is set by the service from the authenticated actor.

| Method | Path                                 | Purpose                                                                 |
| ------ | ------------------------------------ | ----------------------------------------------------------------------- |
| GET    | `/api/v1/admin/settings`             | The whole configuration, admin projection                               |
| PATCH  | `/api/v1/admin/settings/store`       | Identity, currency, timezone, locale, order prefix, low-stock threshold |
| PATCH  | `/api/v1/admin/settings/contact`     | Support and business contact details, postal address                    |
| PATCH  | `/api/v1/admin/settings/social`      | Replace the social link list                                            |
| PATCH  | `/api/v1/admin/settings/seo`         | Storefront SEO and OpenGraph metadata                                   |
| PATCH  | `/api/v1/admin/settings/shipping`    | Delivery fee, free-shipping threshold, COD, city overrides              |
| PATCH  | `/api/v1/admin/settings/tax`         | Tax enablement, rate and display                                        |
| PATCH  | `/api/v1/admin/settings/invoice`     | Invoice presentation                                                    |
| PATCH  | `/api/v1/admin/settings/email`       | Transactional-email behaviour (no credentials)                          |
| PATCH  | `/api/v1/admin/settings/maintenance` | Maintenance mode and its public message                                 |

The public surface requires no token and performs no writes.

| Method | Path                   | Purpose                                                              |
| ------ | ---------------------- | -------------------------------------------------------------------- |
| GET    | `/api/v1/store/config` | Customer-safe store configuration; exempt from the maintenance guard |

The remaining public reads — `/store/home`, `/store/navigation`, `/store/faqs`, `/store/pages`, `/store/pages/:slug`, `/store/promotions`, `/store/banners` — are documented in [MARKETING_ARCHITECTURE.md](./MARKETING_ARCHITECTURE.md) and [CMS_ARCHITECTURE.md](./CMS_ARCHITECTURE.md). All of them sit behind the guard described in §12.

## 15. Audit

Settings mutations write to the existing `AuditLog` model with `resourceType: 'StoreConfiguration'` and `resourceId: 'STORE'`. Phase H added no second audit store.

| Action                      | Raised by                                                  |
| --------------------------- | ---------------------------------------------------------- |
| `SETTINGS_UPDATED`          | Every settings PATCH, with `section` naming which one      |
| `MAINTENANCE_MODE_ENABLED`  | `PATCH /settings/maintenance` with `maintenanceMode: true` |
| `MAINTENANCE_MODE_DISABLED` | The same route with `maintenanceMode: false`               |

Metadata records the section name and the list of changed field names — never the values. That keeps the trail useful ("who turned off cash on delivery, and when") without copying store text into a second collection, and it means an audit reader never has to be filtered for content it should not see. A PATCH that changes nothing writes no entry at all.

Maintenance mode gets its own two actions rather than one `SETTINGS_UPDATED` because "the storefront was closed at 14:02 and reopened at 14:40" is the single most likely thing anyone will want to find in this trail, and searching for it by action beats searching by changed-field name.

## 16. Performance

| Collection            | Index               | Serves                                                                      |
| --------------------- | ------------------- | --------------------------------------------------------------------------- |
| `storeconfigurations` | `{ key: 1 }` unique | Singleton identity, the safety of concurrent initialisation, and every read |

One index, because there is one document. Every read is `findOne({ key: 'STORE' })` against a unique index — a single-document lookup that no amount of store growth makes slower.

Reads are uncached on purpose, and the cost is bounded by that: one indexed lookup per request that needs a setting. Checkout already loads it inside the same `Promise.all` as the cart and the address, so shipping and tax cost no additional round trip. The alternative — caching the singleton in process memory — would buy one lookup and cost a cache-invalidation protocol across workers, plus a window in which two processes quote different delivery fees. For a single-document read that is a bad trade.

The bounds in `CONTENT_LIMITS` and `SHIPPING_DEFAULTS` cap the payload size as well as the write size: 50 city overrides, 6 social channels, 30 meta keywords. The public config response cannot grow unbounded through configuration alone.

## 17. Deferred

Not implemented, deliberately: multi-currency pricing with conversion rates; per-region or per-warehouse shipping zones; carrier rate lookups and live delivery quotes; weight- or dimension-based shipping; a tax jurisdiction engine, per-province rates, tax-exempt customer classes or filing reports; a second invoice engine or invoice numbering configuration beyond the existing order prefix; SMTP or provider credential storage of any kind; a template editor, custom email templates or template variables; scheduled maintenance windows; configuration history, diffs or rollback; per-environment configuration overrides in the database; a cache or Redis layer in front of the singleton; and any generic `key/value` settings store.
