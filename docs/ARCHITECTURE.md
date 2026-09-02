# MansooriKart Architecture

## Current

React 18 + Vite with an incremental TypeScript and Tailwind foundation; Express JavaScript + MongoDB/Mongoose backend. MUI remains temporarily while features migrate.

## Target

- Web: React, Vite, TypeScript, Tailwind, React Router, TanStack Query, React Hook Form, Zod, Motion, Lucide.
- API: Express and TypeScript with MongoDB/Mongoose.
- Administration: one Super Admin application, never separate finance/operations dashboards.

## Migration boundary

Phase 1 prioritizes backend security and transaction integrity over a TypeScript rewrite. New user interface work uses Tailwind tokens; existing MUI screens remain functional until replaced feature by feature. The backend will move toward `config`, `controllers`, `middleware`, `models`, `routes`, `services`, `utils`, and `validators` without a wholesale rewrite.
