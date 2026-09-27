# MansooriKart Storefront (`apps/web`)

Next.js 14+ App Router customer-facing storefront for MansooriKart.

## Environment Variables (`.env.local`)

Create an `.env.local` file in `apps/web/` for local development:

```bash
# API Base URL pointing to MansooriKart active backend API
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1

# Optional Storefront Settings
NEXT_PUBLIC_DEFAULT_CURRENCY=AED
NEXT_PUBLIC_DEFAULT_MARKET=AE
NEXT_PUBLIC_SITE_NAME="MansooriKart"
```

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Architecture

- **Shared Components & Tokens:** Imported from `@mansoorikart/ui`.
- **API Client:** Typed fetch wrapper in `lib/api/` targeting `/api/v1/*` backend endpoints.
- **Base Shell:** Responsive Header with navigation & cart badge, and Dark Navy Footer with TrustBadges, links, and single-market selector (`AED | English`).
