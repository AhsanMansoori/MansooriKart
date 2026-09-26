# MansooriKart Phase 1 Baseline

Captured before Phase 1 changes. This workspace has no usable `.git` metadata, so no branch or clean-worktree state could be recorded.

## Current structure and architecture

- React 18 JavaScript storefront under `src/`, using CRACO/Create React App, React Router, Material UI and Axios.
- Express/Mongoose JavaScript API under `backend/`, with Product, User and Order models.
- Deployment artifacts include Docker, Compose, Vercel, GitHub Actions, Jenkins, Kubernetes, Terraform and Nomad; they were not mutually verified.

## Route inventory

Storefront: `/`, `/shop`, `/product/:id`, `/cart`, `/checkout`, `/order-success`, `/order-tracking`, `/login`, `/register`, `/forgot-password`, `/reset-password`, static policy/support pages, and a catch-all 404.

API: `/api/products`, `/api/search`, `/api/auth`, `/api/checkout/create-order`, `/api/orders/track`, Swagger routes.

## Schemas at baseline

- Product: name, description, price, category, single image, brand, stock, aggregate rating/review count, vector IDs.
- User: name, email, password, date.
- Order: order number, contact/address, product snapshots, total, simulated status history.

## Known working flows

Catalog browse/search, product details, client-persisted cart, registration/login token response, order creation/tracking UI, and optional vector recommendations.

## Known broken or unsafe flows

Password reset by email alone; raw card/CVC collection; no stock-safe checkout; random status progression on tracking; unrestricted CORS; no effective authorization/admin; unescaped regex search; inconsistent auth/cart keys; no health endpoint.
