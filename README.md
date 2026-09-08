# MansooriKart

MansooriKart is a MERN commerce application with a React/Vite storefront and a TypeScript Express API. MongoDB is the system of record for customers, catalog, inventory, carts, orders, returns, refunds, purchasing, supplier feeds, finance, CMS content, and audit history.

## Current runtime

- Node.js 26, npm workspaces
- React 18, Vite, Material UI 5, Axios
- Express 4, TypeScript, Mongoose 8, Zod
- MongoDB replica set or sharded cluster; transactions are required
- Local password and Google Identity Services sign-in
- Stateless Bearer JWT sessions, 15 minutes by default and at most one hour
- Cash on Delivery only; no payment provider is connected
- Email provider delivery is deferred; the default adapter records intent without claiming delivery

The active API is `/api/v1`. The old JavaScript runtime and unversioned `/api/*` endpoints have been removed. Product discovery uses bounded MongoDB catalog queries and metadata-based related products. No vector database, embedding service, or AI credential is part of the active runtime.

## Setup

```bash
npm ci
Copy-Item backend/.env.example backend/.env
npm run dev
```

Set at least `MONGO_URI` and `JWT_SECRET`. Production also requires `FRONTEND_URL`, a strong non-placeholder JWT secret, HTTPS origins, and a MongoDB deployment that supports transactions. `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` are public client identifiers and are optional.

Useful commands:

```bash
npm run typecheck
npm run test
npm run build
npm run format:check
npm run lint
npm run admin:bootstrap --workspace backend
```

`npm run build:backend` emits `backend/dist/server.js`; `npm run start --workspace backend` starts that artifact. Tests use a real single-member in-memory MongoDB replica set and never mock persistence.

## Runtime behavior

The storefront can browse active products, synchronize a cart across devices, preview an authoritative PKR checkout total, and confirm a retry-safe COD order. Checkout consumes only the selected quantities, retaining other server-cart lines. Own-stock availability comes from the default `MAIN/PRIMARY` inventory balance. Dropship availability comes from the chosen supplier source and never exposes supplier identity or cost.

Business mutations that span records use MongoDB transactions. This includes inventory adjustments and transfers, checkout and coupon consumption, cancellation/restock, returns, refunds, purchase orders, goods receipts, and supplier returns. Audit failure aborts the same transaction. Order confirmation is invoked after commit.

Maintenance mode closes catalog browsing, public storefront content, cart writes, and checkout. Authentication, health probes, Super Admin APIs, store configuration, and read-only cart inspection remain accessible.

## Documentation

- [Backend architecture](docs/BACKEND_ARCHITECTURE.md)
- [Authentication architecture](docs/AUTHENTICATION_ARCHITECTURE.md)
- [Environment configuration](docs/ENVIRONMENT_CONFIGURATION.md)
- [API contract](docs/API_CONTRACT.md)
- [API inventory](docs/API_INVENTORY.md)
- [Legacy API removal](docs/LEGACY_API_REMOVAL.md)
- [Inventory](docs/INVENTORY_ARCHITECTURE.md), [orders and sales](docs/ORDERS_SALES_ARCHITECTURE.md), [purchasing](docs/PURCHASING_ARCHITECTURE.md), [finance](docs/FINANCE_ARCHITECTURE.md), and [supplier CSV import](docs/CSV_CATALOG_IMPORT_ARCHITECTURE.md)

Historical takeover and restructuring reports live in `docs/legacy/` and are evidence snapshots, not current operating instructions.

## Deferred work

Secure HttpOnly session transport, durable refresh-token rotation, a persistent email outbox/provider, online payments, object storage, Redis/shared rate limiting, monitoring integrations, full OpenAPI generation, and the broader frontend/MUI migration remain future phases.
