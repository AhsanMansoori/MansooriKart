# Legacy API Removal Checklist

The legacy API is frozen for compatibility with the current frontend. New functionality belongs only in `/api/v1`. No legacy route is safe to delete until the frontend API-cutover phase has passed its tests and live verification.

| Method | Old path                           | Target v1 path                                           | Current frontend user                | Migration status                          | Safe to delete |
| ------ | ---------------------------------- | -------------------------------------------------------- | ------------------------------------ | ----------------------------------------- | -------------- |
| GET    | `/api/products`                    | `/api/v1/products`                                       | `App.jsx`, `src/lib/api/products.ts` | Not migrated                              | No             |
| GET    | `/api/products/:id`                | `/api/v1/products/:identifier`                           | `ProductDetails.jsx`                 | Not migrated                              | No             |
| GET    | `/api/products/:id/similar`        | `/api/v1/products/:identifier/recommendations` (planned) | `ProductDetails.jsx`                 | Not migrated                              | No             |
| POST   | `/api/products/recommendations`    | `/api/v1/products/recommendations` (planned)             | `Home.jsx`                           | Not migrated                              | No             |
| GET    | `/api/products/category/:category` | `/api/v1/products?category=`                             | No direct consumer                   | Frozen                                    | No             |
| PUT    | `/api/products/:id/rating`         | `/api/v1/products/:id/reviews`                           | `ProductDetails.jsx`                 | Not migrated; unsafe legacy demo endpoint | No             |
| GET    | `/api/search`                      | `/api/v1/products?search=`                               | `NavigationBar.jsx`                  | Not migrated                              | No             |
| POST   | `/api/auth/register`               | `/api/v1/auth/register`                                  | `Register.jsx`                       | Not migrated                              | No             |
| POST   | `/api/auth/login`                  | `/api/v1/auth/login`                                     | `Login.jsx`                          | Not migrated                              | No             |
| POST   | `/api/auth/forgot-password`        | `/api/v1/auth/forgot-password`                           | `ForgotPassword.jsx`                 | Not migrated                              | No             |
| POST   | `/api/auth/reset-password`         | `/api/v1/auth/reset-password`                            | `ResetPassword.jsx`                  | Not migrated                              | No             |
| POST   | `/api/checkout/create-order`       | `/api/v1/checkout`                                       | `Checkout.jsx`                       | Not migrated                              | No             |
| POST   | `/api/orders/track`                | `/api/v1/orders/:id` for authenticated users             | `OrderTracking.jsx`                  | Contract decision needed                  | No             |
| GET    | `/api/admin/verification`          | `/api/v1/admin/*`                                        | No current consumer                  | Frozen                                    | No             |

## Removal gate

Legacy mounts may be removed only after all rows are migrated or formally retired, `/api/v1` contracts are frozen and tested, frontend regression/live verification passes, and a dedicated approval authorizes deletion.
