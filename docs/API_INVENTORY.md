# Active API Inventory

All application routes are mounted below `/api/v1`. JSON errors use `{ error: { code, message, requestId, details? } }`; successful list endpoints use bounded pagination metadata. Input schemas reject unknown keys.

| Surface            | Main routes                                                                                                                     | Access                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| health/config      | `/health`, `/admin/health`, `/store/config`                                                                                     | public health/config; Super Admin admin health     |
| authentication     | `/auth/register`, `/auth/login`, `/auth/google`, `/auth/forgot-password`, `/auth/reset-password`                                | public with purpose-specific rate limits           |
| account            | `/me/profile`, `/me/addresses`                                                                                                  | customer                                           |
| catalog            | `/products`, `/products/:identifier`, recommendations, categories, brands                                                       | public, blocked by maintenance mode                |
| cart               | `/cart`, `/cart/items`, `/cart/merge`, `/cart/sync`                                                                             | customer; GET remains available during maintenance |
| wishlist           | `/wishlist`                                                                                                                     | customer                                           |
| checkout           | `/checkout/preview`, `/checkout`                                                                                                | customer; maintenance-blocked                      |
| orders             | `/orders`, `/orders/:id`, cancellation, returns, invoices                                                                       | owning customer                                    |
| reviews            | product review create/list/update/delete                                                                                        | public reads; owning customer writes               |
| storefront content | pages, FAQs, navigation, homepage                                                                                               | public published projections                       |
| administration     | catalog, inventory, suppliers, purchasing, orders, sales, customers, finance, reports, marketing, CMS, settings, imports, audit | Super Admin                                        |

Checkout preview is the server authority for subtotal, discount, shipping, tax, currency, and payable total. Confirmation supplies the preview `quoteHash`, selected items, and a stable `Idempotency-Key`. Before confirmation, `PUT /cart/sync` performs a durable max-quantity union keyed by its own stable idempotency key, making uncertain retries safe across devices.

Customer returns and refunds use explicit safe serializers and bounded `page`/`limit` queries. Catalog, cart, wishlist, and checkout expose public availability computed from the default owned-stock fulfilment location or the preferred dropship source without exposing supplier costs or internal records.

Maintenance mode keeps health, authentication, Super Admin routes, public store configuration, and authenticated cart reads available. It returns `503 MAINTENANCE_MODE` for catalog/content browsing, checkout, and cart writes.

See [API_CONTRACT.md](./API_CONTRACT.md) for detailed domain behavior and [LEGACY_API_REMOVAL.md](./LEGACY_API_REMOVAL.md) for migration evidence.
