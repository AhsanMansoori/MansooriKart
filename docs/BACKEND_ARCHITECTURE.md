# Backend Architecture

`backend/src/server.ts` validates configuration, connects to MongoDB, initializes correctness-critical indexes, verifies transaction support, and starts the Express app assembled by `backend/src/app.ts`. TypeScript compiles through `tsconfig.build.json` to `backend/dist`; `npm start` executes `dist/server.js`.

The only active HTTP surface is `/api/v1`. Routes validate strict Zod inputs and call services. Services own state transitions and transaction boundaries. Mongoose models define persistence and unique invariants. Public and customer serializers use explicit allowlists. Shared middleware provides request IDs, Bearer authentication, role checks, errors, CORS, and body limits.

`transaction.ts` enables Mongoose transaction context propagation. Nested services join the current transaction, and transient or unique-key races retry the full unit. Index creation occurs before a transaction. External notification work is registered for after commit; it cannot invalidate durable commerce state.

InventoryBalance at `MAIN/PRIMARY` is authoritative for owned online stock. `Product.stock` is a compatibility mirror maintained in the same transaction. Dropship inventory is advisory supplier state and never changes owned balances. Checkout snapshots current price and cost, consumes coupon capacity, creates fulfillment and audit records, and removes only purchased cart quantities in one transaction.

Finance uses one realized-sale definition across dashboards and reports: delivered or return-stage orders whose payment state is paid, partially refunded, or refunded. Refund records reduce realized revenue once, while the original immutable line cost remains COGS. Pending and approved refund reservations count until marked failed; failure releases the order accumulator exactly once.

The application uses MongoDB catalog search. Removed legacy vector clients, embedding services, scripts, generated indexes, and environment variables have no active consumer. Historic descriptions are retained only under `docs/legacy/`.
