# Frontend Architecture & Component Standards

This document establishes the mandatory engineering standards for all UI components, design tokens, and storefront pages across **MansooriKart** (`packages/ui`, `apps/web`, and `apps/admin`).

---

## 1. Component-Based, Reusable Approach

To maintain high code quality, consistency, and velocity across all storefront phases:

- **Shared Component Placement**: Any UI element used more than once, or any element complex enough to warrant its own file (not a two-line wrapper), belongs in `packages/ui`, not copy-pasted or reimplemented inside `apps/web` or `apps/admin` page files.
- **Clean Page Compositions**: Page files in `apps/web` (`app/**/page.tsx`) must primarily compose existing, modular components. Large blocks of raw JSX markup inside `page.tsx` are prohibited.
- **One-Off Page Components**: If a component is strictly specific to one page and will never be reused elsewhere (such as a one-off landing hero section), it may reside local to that page's directory (e.g. `apps/web/app/shop/_components/ShopHero.tsx`). However, it must still be structured as its own dedicated component file, never inlined directly inside `page.tsx`.
- **Atomic Isolation**: Components in `packages/ui` should be self-contained, accept typed props, use `cn()` for style composition, and avoid direct couplings to route transitions or global singletons.

---

## 2. Color Palette & Token Discipline

The MansooriKart visual identity is governed strictly by the design token system:

- **Single Source of Truth**: All colors live in [`packages/ui/src/tokens.ts`](./src/tokens.ts).
- **No Raw Hex Values**: Hardcoded hex values (e.g., `#0D9488`, `#0B192C`) are strictly forbidden in `apps/web`, `apps/admin`, and component JSX files.
- **No Default Tailwind Ad-Hoc Colors**: Default arbitrary Tailwind color utilities (such as `bg-emerald-500`, `text-blue-600`, `border-indigo-400`) are forbidden. Always use the semantic brand/surface/text tokens configured in `@theme` / `tokens.ts` (e.g., `bg-brand-mint`, `text-brand-navy`, `border-border-default`, `bg-surface-card`).
- **UAE Market Identity**: Use brand primary (`brand-teal`, `brand-mint`), dark navy accents (`brand-navy`), and gold badges (`brand-gold`) to uphold the premium UAE marketplace aesthetic.

---

## 3. Optimization Baseline for `apps/web`

Every page built from Phase 3b onward must adhere to the following optimization contracts:

### A. Next.js Optimized Images

- **Prohibit Raw `<img>`**: Never use raw `<img>` tags. Always use Next.js `<Image>` from `next/image`.
- **Dimensions & Layout**: Always specify explicit `width` and `height`, or use `fill` with appropriate container styling and `sizes` attributes.
- **Performance**: Leverage Next.js automatic WebP/AVIF generation, blur placeholders, and lazy-loading for all catalog and editorial images.

### B. Server Components by Default (RSC First)

- **RSC Baseline**: All pages (`page.tsx`) and layout structures must default to React Server Components (RSC).
- **Interactivity Boundary ("use client")**: Only mark a component with `'use client'` when it genuinely requires interactivity (state hooks like `useState`/`useReducer`, lifecycle `useEffect`, browser window events, or DOM event handlers).
- **Keep Leaves Client**: Push `'use client'` directives as far down the component tree as possible (e.g., make an "Add to Cart" button or "Quantity Selector" a client component, while keeping the parent product detail page an RSC).

### C. Dependency Discipline

- Do not install unused or redundant packages.
- All packages declared in `package.json` must serve an active role in runtime or build orchestration.
- Any new dependency must be vetted for bundle weight and tree-shakability before inclusion.
