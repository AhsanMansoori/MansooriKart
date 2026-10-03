# @mansoorikart/ui

Shared UI component library and design system tokens for MansooriKart.

## Architecture & Standards

All development in this package and consuming applications (`apps/web`, `apps/admin`) must strictly adhere to the standards defined in [CONTRIBUTING.md](./CONTRIBUTING.md):

1. **Component-Based & Reusable**: Any element used more than once or complex enough belongs in `packages/ui`. Pages in `apps/web` compose components, never large inlined JSX blocks.
2. **Design Tokens & Color Palette**: Single source of truth is [`src/tokens.ts`](./src/tokens.ts). No raw hex codes and no arbitrary Tailwind colors.
3. **Performance Baseline**: Next.js `<Image>` required (no raw `<img>`), React Server Components by default (`'use client'` only on interactive leaf nodes), and strict dependency discipline.

## Exported Components

- `Badge` - Status, discount, and highlight badges
- `Button` - Interactive buttons with loading states and size variants
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` - Surface card containers
- `Input` - Form text inputs with icon and error support
- `Select` - Form select dropdowns
- `PriceDisplay` - Currency formatted pricing with discount calculations (AED native)
- `ProductCard` - Full product card with image, badges, ratings, and action hooks
- `Rating` - Star rating displays with count and numeric score
- `TrustBadge` - Security, shipping, and warranty reassurance badges
- `tokens` - Design system color, typography, shadow, and radius tokens
- `formatCurrency` - Standardized currency formatting utility
