# MansooriKart System Operations Architecture

Phase H added the operator's view of the running system: a system health endpoint for the Super Admin console and a read-only administration surface over the audit trail that already existed. The implementation is `backend/src/routes/v1/adminCore.ts` over the existing `backend/src/models/auditLog.ts`, with `backend/src/utils/redact.ts` as the publication filter and `auditEntry` in `backend/src/serializers/marketingAdmin.ts` as the projection. No second audit model was created, and the Phase A public health endpoints are unchanged. The legacy `/api/*` runtime is untouched, and no frontend was built in this phase.

Companion documents: [MARKETING_ARCHITECTURE.md](./MARKETING_ARCHITECTURE.md), [CMS_ARCHITECTURE.md](./CMS_ARCHITECTURE.md), [STORE_CONFIGURATION_ARCHITECTURE.md](./STORE_CONFIGURATION_ARCHITECTURE.md), [API_CONTRACT.md](./API_CONTRACT.md), [API_INVENTORY.md](./API_INVENTORY.md).

## 1. Two health endpoints, two audiences

The public endpoints are the ones Phase A shipped, and they still answer exactly what they answered then:

```
GET /health          → { "status": "ok" }
GET /api/v1/health   → { "success": true, "data": { "status": "ok" } }
```

That is the whole payload. A liveness probe needs to know whether the process is answering HTTP, and anything beyond that is information an unauthenticated caller has no use for and an attacker might. No version, no environment label, no database state, no uptime.

`GET /api/v1/admin/system/health` is the operator's view, behind `requireAuth` and `requireSuperAdmin`. It reports API status, database connectivity and its readyState label, process uptime in seconds, an environment label, a version string, whether the store configuration exists, whether maintenance mode is on, and a `checks` array of three named results.

Both are exempt from maintenance mode. A monitor must be able to see that the process is alive while the storefront is deliberately closed, and an operator must be able to check the system they are in the middle of fixing.

## 2. What health does not publish, and how that is enforced

Every value in the admin health payload is a status, a count or a label. Nothing is read from the environment and echoed, because "echo the environment" is how health endpoints leak.

`environment` is narrowed rather than reflected:

```ts
const environment = ['development', 'test', 'production'].includes(String(process.env.NODE_ENV)) ? String(process.env.NODE_ENV) : 'development';
```

An unrecognised `NODE_ENV` produces `development`, not the unrecognised value. `version` comes from an explicit `APP_VERSION` variable and falls back to the literal `'unknown'` — it does not read `package.json` off disk, so no filesystem path enters the response and a mangled or missing file cannot turn a health check into an error.

`database` is derived from `mongoose.connection.readyState` and published as `connected`/`disconnected` plus a word from a fixed four-element array. The connection string never appears: not the host, not the credentials, not the database name, not the replica-set label. `store.configured` is a boolean, deliberately not the configuration.

There is no branch in this handler that emits a stack trace. A failure is caught by `next(error)`, which reaches the shared error middleware and produces the standard `{ success: false, error: { code, message } }` envelope whose `error` object has exactly two keys. The absent-database case is not treated as an error at all: `readyState !== 1` produces `status: 'degraded'` with `database: 'disconnected'` and a `200`, because the API _is_ answering and saying so accurately is more useful to a console than a 500. The `getStoreConfiguration()` call is additionally wrapped in `.catch(() => null)`, so a database that is nominally connected but failing a query degrades the `storeConfiguration` check to `unknown` rather than failing the whole response.

One behaviour is worth recording because it surprises people reading test output: `getStoreConfiguration()` initialises the singleton, so calling admin health against a fresh database creates the `StoreConfiguration` document as a side effect. That is the documented contract of the getter — see [STORE_CONFIGURATION_ARCHITECTURE.md](./STORE_CONFIGURATION_ARCHITECTURE.md) §1 — not an accident of this endpoint.

## 3. One audit authority, read-only

`AuditLog` was built in an earlier phase and Phase H added no second audit store, no shadow collection and no alternative write path. What it added is the Super Admin surface for reading it.

Records are append-only, and that is structural rather than a policy: there is no update endpoint, no delete endpoint and no PATCH anywhere over `/audit-logs`. The router exposes three GETs and nothing else. A misbehaving admin client cannot rewrite history through this API because the API has no verb that would.

Every Phase H mutation writes through the same model, and every handler diffs before it writes so a PATCH that changes nothing produces no entry. The actions each domain raises are listed in the companion documents; there is one vocabulary across all of them, discoverable through `GET /audit-logs/actions`.

## 4. Filters that cannot become queries

The audit list accepts `page`, `limit`, `action`, `resourceType`, `resourceId`, `actor`, `search`, `sort`, `from` and `to`, and the schema is `.strict()` — an unknown parameter is `400 VALIDATION_ERROR`, not an ignored key.

Each filter is one of three shapes, and none of them lets a caller reach the query language:

| Filter                                 | Shape                                                         |
| -------------------------------------- | ------------------------------------------------------------- |
| `action`, `resourceType`, `resourceId` | Bounded strings compared by equality                          |
| `actor`                                | Must match `^[a-f\d]{24}$` before it is used                  |
| `search`                               | Escaped, anchored prefix regex over `action` only             |
| `sort`                                 | `newest` or `oldest`, mapped to a fixed `createdAt` direction |
| `from`, `to`                           | Coerced dates, validated as a range                           |

`search` is the one that would otherwise be dangerous, so it is built rather than passed:

```ts
filter.action = { $regex: new RegExp(`^${escapeRegex(query.search)}`, 'i') };
```

Escaping means `.*` matches the literal characters `.*` and finds nothing, rather than matching every action. Anchoring at the start keeps it a prefix search, which is what an operator typing `COUPON_` actually wants and also means the regex cannot degenerate into a full scan of every action string. `sort` accepts a word from an enum and never a field name, so no caller can sort by an unindexed field or inject a sort object.

The date range is validated as a _range_, not merely as two dates: `from` must not follow `to`, and the span may not exceed `CONTENT_LIMITS.maxDateRangeDays` (366). Without the second rule a single request could ask the database to scan the entire trail, which is a denial-of-service handed to whoever holds an admin token.

Pagination is mandatory and bounded — `limit` defaults to 20 and caps at 100 — and the response carries `page`, `limit`, `total`, `totalPages`, `hasNextPage` and `hasPreviousPage` in `meta`. `GET /audit-logs/actions` is capped too: 500 distinct actions and 200 resource types, sorted, which is generous for a vocabulary that lives in source code and bounded for one that has grown unexpectedly.

`/audit-logs/actions` is declared before `/audit-logs/:id` so the literal path wins over the parameter. A malformed identifier on the single-entry route is checked with `isObjectId` before any query runs, so it returns a clean `404 AUDIT_LOG_NOT_FOUND` — identical to the body for an id that simply does not exist — rather than a Mongoose CastError carrying a stack trace.

## 5. Redaction on the way out

`metadata` on an audit entry is `Mixed`, written by many call sites across every phase. The read API therefore cannot assume the shape of what it is about to publish, and `redactAuditMetadata` runs on every entry the API returns.

Writers are already careful — Phase H handlers record changed _field names_, slugs and counts, never values — but redaction is what makes that a guarantee instead of a convention that a future writer might break. It works by key name, matched case-insensitively as a substring:

```
/pass|secret|token|jwt|authorization|cookie|apikey|api_key|api-key|credential|smtp|mongo|
 connectionstring|privatekey|signature|sessionid|otp|hash|salt|rawcsv|csvbody|filebody|env/i
```

Substring matching is deliberate. It catches `smtpPassword`, `x-api-key`, `refreshToken` and `supplierCredential` without anyone having to maintain an exhaustive list of exact spellings, and a new writer inventing `providerSecretV2` is covered on the day it is written. `hash` and `salt` cover password material; `rawcsv`, `csvbody` and `filebody` cover an uploaded supplier feed, which is both large and potentially confidential; `mongo` and `connectionstring` cover the one string nobody should ever see through an API.

The structure is bounded as well as filtered: strings truncate at 512 characters, objects publish 40 keys, arrays publish 20 items, and recursion stops at depth 4. Anything past a bound is _summarised_ rather than dropped silently — `[TRUNCATED]`, `[N more]`, `[truncated]: N more keys` — so an operator can tell content existed without receiving it, and one pathological entry cannot dominate a page of results.

`auditEntry` publishes `id`, `actor`, `action`, `resourceType`, `resourceId`, `requestId`, the redacted `metadata` and `createdAt`. `actor` is populated to `name`, `email` and `role` only — the projection is `'name email role'`, so the password hash is not loaded from the database in the first place rather than loaded and then stripped. That ordering matters: a field that never enters the process cannot leak from it.

## 6. The operations dashboard

`adminCore.ts` also serves the console's summary reads, which predate Phase H and are unchanged by it: `GET /dashboard` for counts and two short lists, and three range-scoped aggregations over sales, orders and products. `range` is an enum of `7d`, `30d` and `90d` rather than a pair of dates, so a dashboard request cannot ask for an unbounded window, and `rangeStart` computes the boundary in UTC so the answer does not shift with the display timezone.

Revenue counts `DELIVERED` and `PAID` orders only, and each aggregation groups on a stored field. Nothing here recomputes an order total from current settings — the figures are the ones each order snapshotted, which is why changing the delivery fee or enabling tax does not restate yesterday's revenue.

## 7. API surface

Every route in this router is `SUPER_ADMIN`-only: `router.use(requireAuth, requireSuperAdmin)` runs before any handler, so no token is `401 AUTH_UNAUTHORIZED` and a `CUSTOMER` token is `403 AUTH_FORBIDDEN`. Every query is parsed by a `.strict()` schema.

| Method | Path                               | Purpose                                            |
| ------ | ---------------------------------- | -------------------------------------------------- |
| GET    | `/api/v1/admin/dashboard`          | Counts, recent orders, low-stock items             |
| GET    | `/api/v1/admin/dashboard/sales`    | Daily revenue and order count over a bounded range |
| GET    | `/api/v1/admin/dashboard/orders`   | Order counts by status over a bounded range        |
| GET    | `/api/v1/admin/dashboard/products` | Product counts by status over a bounded range      |
| GET    | `/api/v1/admin/audit-logs`         | Paged, filtered, sorted audit trail                |
| GET    | `/api/v1/admin/audit-logs/actions` | Distinct action and resource-type vocabulary       |
| GET    | `/api/v1/admin/audit-logs/:id`     | One audit entry                                    |
| GET    | `/api/v1/admin/system/health`      | Operational health for the console                 |

Public, unauthenticated, and unchanged since Phase A:

| Method | Path             | Purpose                           |
| ------ | ---------------- | --------------------------------- |
| GET    | `/health`        | Liveness — `{ "status": "ok" }`   |
| GET    | `/api/v1/health` | Liveness in the standard envelope |

There is no `POST`, `PATCH`, `PUT` or `DELETE` anywhere in this router. The audit trail has no write API and the health endpoint has no side effect other than the singleton initialisation described in §2.

## 8. Performance

| Collection  | Index                                               | Serves                                          |
| ----------- | --------------------------------------------------- | ----------------------------------------------- |
| `auditlogs` | `{ createdAt: -1 }`                                 | The default newest-first page with no filter    |
| `auditlogs` | `{ action: 1, createdAt: -1 }`                      | The action filter and the escaped prefix search |
| `auditlogs` | `{ resourceType: 1, resourceId: 1, createdAt: -1 }` | "What happened to this record"                  |
| `auditlogs` | `{ actor: 1, createdAt: -1 }`                       | "What did this operator do"                     |

Four indexes for four reads, each compound ending in `createdAt` because every one of those reads is also time-ordered. None is redundant with another: no index is a prefix of a different one, and the bare `{ createdAt: -1 }` serves the unfiltered listing that the compounds cannot.

The health endpoint runs no aggregation. It reads `mongoose.connection.readyState` from memory, one indexed singleton lookup, and `process.uptime()` — cheap enough to be polled by a console without becoming a load source of its own.

`GET /audit-logs` runs the filter twice, once for the page and once for `countDocuments`, inside one `Promise.all`. Both use the same index, and the count is what makes `totalPages` truthful; an endpoint that reported a next page it could not produce would be worse than one extra indexed count.

## 9. Deferred

Not implemented, deliberately: log shipping to an external aggregator; metrics endpoints, Prometheus scraping or OpenTelemetry tracing; alerting, on-call routing or incident tooling; audit retention policies, archival or export; a background job scheduler and its monitoring; per-dependency deep health checks that make outbound calls; feature flags; request-level performance profiling stored in the database; audit-log write APIs of any kind. Audit records remain append-only with no edit or delete path, and the public health endpoints remain minimal.
