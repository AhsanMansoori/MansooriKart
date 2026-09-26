# Legacy API Removal Evidence

The unversioned JavaScript backend was removed after its public behavior was mapped to the TypeScript `/api/v1` runtime. No active frontend module or backend module imports it. Historical implementation files, scripts, vector indexes, obsolete tests, and unversioned route mounts are absent from the current tree.

| Removed contract                                 | Active replacement                                                        | Frontend consumer                              | Evidence                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| `GET /api/products` and search/category variants | `GET /api/v1/products` with bounded filters                               | catalog service, Home, Shop, navigation search | catalog and legacy-parity integration tests                     |
| `GET /api/products/:id`                          | `GET /api/v1/products/:identifier`                                        | ProductDetails                                 | catalog/publication tests                                       |
| heuristic/vector similar-products routes         | `GET /api/v1/products/:identifier/recommendations` using catalog metadata | ProductDetails and Home                        | legacy-parity integration test                                  |
| `PUT /api/products/:id/rating`                   | authenticated review endpoints under `/api/v1/products/:id/reviews`       | review service and ProductDetails              | review integration tests                                        |
| `/api/auth/*`                                    | `/api/v1/auth/*`                                                          | auth session and Google sign-in services       | local, Google, reset, and rate-limit tests                      |
| `/api/checkout/create-order`                     | `POST /api/v1/checkout/preview` then `POST /api/v1/checkout`              | checkout service and Checkout page             | checkout evidence/transaction tests and frontend checkout tests |
| `/api/orders/track`                              | owner-scoped `GET /api/v1/orders/:id`                                     | orders service and OrderTracking               | order ownership tests                                           |
| legacy cart/wishlist/me routes                   | `/api/v1/cart`, `/api/v1/cart/sync`, `/api/v1/wishlist`, `/api/v1/me/*`   | API client services                            | cart/wishlist/HTTP-contract tests                               |
| legacy admin verification                        | role-protected `/api/v1/admin/*`                                          | current administration client contracts        | all ERP integration suites                                      |

The deleted vector and embedding paths have no replacement dependency because the active product discovery contract is MongoDB-backed. No Pinecone, Weaviate, FAISS, embedding, or AI environment variable is read by the active runtime.

`backend/tests/legacy-parity.integration.test.ts` is the explicit runtime parity suite. The former JavaScript Jest suites are represented by the active tests as follows:

| Removed suite     | Active evidence                                                                 |
| ----------------- | ------------------------------------------------------------------------------- |
| auth              | `auth-local`, `auth-google`, `auth-rate-limit`, environment config              |
| checkout          | checkout evidence, checkout transaction, cart, coupons, orders                  |
| orders            | orders, order visibility, cancellation/refunds, returns/security, invoice/email |
| products/search   | legacy parity, storefront/publication, reviews, catalog administration          |
| embedding service | intentionally retired; absence is verified by repository scans                  |
| v1 utilities      | v1 HTTP contract plus domain integration suites                                 |
