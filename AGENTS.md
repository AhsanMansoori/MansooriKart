# AI Coding Agent Instructions for MansooriKart

## Active application

MansooriKart is a TypeScript Express and MongoDB commerce backend with a React storefront. The active API is `/api/v1`; the removed JavaScript runtime and unversioned routes are historical only. Current architecture documents are in `docs/`. Point-in-time reports are in `docs/legacy/` and are not implementation instructions.

The active backend does not use Pinecone, Weaviate, FAISS, LangChain, embeddings, or AI credentials. Product discovery uses bounded MongoDB catalog queries and metadata-based related products.

## Repository map

```text
backend/
  src/
    config/       validated environment and domain configuration
    controllers/  HTTP adapters
    middleware/   authentication, roles, validation, maintenance
    models/       Mongoose schemas and indexes
    routes/v1/    active customer, storefront, and Super Admin API
    services/     transactional domain logic
    utils/        serializers, errors, redaction, helpers
    app.ts         Express composition
    server.ts      process entry point
  tests/           real MongoDB replica-set integration tests
  dist/            generated production build
frontend/
  src/             React storefront
docs/              current architecture and contracts
docs/legacy/       archived point-in-time reports
```

## Runtime invariants

- MongoDB transactions are required. Tests use a real in-memory replica set.
- Checkout commits order, stock, coupon redemption, fulfilment obligations, selected cart removal, and audit together.
- Inventory balances, product stock mirrors, movements, transfers, and audits commit together.
- Purchase receipts and returns commit documents, stock, cost snapshots, movements, and audits together.
- Cancellation restores eligible owned stock exactly once. Dropship cancellation records supplier-contact intent without pretending an external notification occurred.
- Refund creation and failure transitions update refund headroom atomically and idempotently.
- Accepted refunds reduce realized revenue once. Paid orders remain realized in `PAID`, `PARTIALLY_REFUNDED`, and `REFUNDED` states across the delivery/return lifecycle.
- Audit persistence is part of each protected write. A failed audit aborts the transaction; do not add compensation records for aborted work.
- Public serializers are allowlists. Never expose password fields, internal actors, supplier cost, raw idempotency keys, or operational metadata.
- Owned-stock availability comes from the default fulfilment location when inventory balances exist. Dropship availability comes from the preferred supplier source and never exposes supplier economics.
- Maintenance mode keeps health, authentication, Super Admin operations, public store configuration, and authenticated cart reads available while blocking storefront browsing and commerce writes.

## Authentication

- Local and Google identities converge on one customer account.
- JWTs are short-lived and stateless; the default lifetime is 15 minutes and the configured maximum is one hour.
- Password reset consumes one token atomically and increments `sessionVersion`, invalidating older JWTs.
- Browser authentication remains in local storage for this phase. Do not claim cookie-based sessions exist.
- Transactional email has no production delivery provider. API copy and documentation must not claim that an email was sent.

## Development workflow

Use Node.js 18+ and a MongoDB replica set.

```bash
npm install
npm --prefix backend install

npm --prefix backend run typecheck
npm --prefix backend run format:check
npm --prefix backend run lint
npm --prefix backend test
npm --prefix backend run build

npm run typecheck
npm run format:check
npm run lint
npm test -- --watchAll=false
npm run build
```

`npm --prefix backend start` runs `dist/server.js`; build the backend first. Frontend development uses `npm start` and the production artifact uses `npm run build`.

## Change discipline

Read the existing implementation and current architecture document before changing a domain. Preserve API contracts unless the requirement explicitly changes them. Put database writes that form one business operation in the same transaction. Keep network side effects outside transactions and make their status truthful.

Add meaningful integration coverage for concurrency, idempotency, ownership, strict validation, and real persistence failures. Do not disable, skip, weaken, or mock away a required invariant. Run focused tests during implementation and the complete gates before committing.

Never commit `.env` files, credentials, dependency directories, build caches, test outputs, or temporary audit artifacts. Do not restore the removed legacy runtime or obsolete AI integrations.
