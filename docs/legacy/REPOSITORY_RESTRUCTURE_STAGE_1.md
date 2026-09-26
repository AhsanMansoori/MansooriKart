# MansooriKart Repository Restructure — Stage 1

## Scope and outcome

Stage 1 establishes explicit frontend and backend workspace boundaries without changing application behavior. The Vite frontend now lives in `frontend/`; the existing TypeScript API remains in `backend/`; the repository root is the npm workspace orchestrator.

## Files moved

The following existing frontend files were moved together, preserving their contents and relative relationships:

- `src/` to `frontend/src/`
- `public/` to `frontend/public/`
- `index.html`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `jest.config.js`, `jest.setup.js`, `babel.config.js`, and `.env.example` to `frontend/`

The `backend/` source tree, legacy route implementations, Docker assets, Kubernetes assets, and AI/vector integrations were not moved or changed.

## Workspace contract

- Root `package.json` is private and declares the `frontend` and `backend` workspaces.
- `frontend/package.json` owns the current Vite, React, Jest, Tailwind, MUI, and related frontend dependencies and scripts.
- `backend/package.json` remains the owner of backend dependencies and commands.
- Root scripts delegate to each workspace: `dev:frontend`, `dev:backend`, `test:frontend`, `test:backend`, `test:v1`, `typecheck:frontend`, `typecheck:backend`, `build:frontend`, and `build:backend`.
- One root `package-lock.json` is the lockfile authority. The superseded `backend/package-lock.json` was removed as part of the approved workspace lockfile strategy; it can be regenerated from the root lockfile if ever needed.

## Development commands

Run these from the repository root:

```sh
npm run dev:frontend
npm run dev:backend
npm run test:frontend
npm run test:backend
npm run test:v1
npm run typecheck
npm run build
```

## Validation performed

| Gate                           | Result                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Frontend Vite startup          | Pass — started successfully on port 5174 because configured port 5173 was already occupied by an unrelated process. |
| Frontend TypeScript            | Pass                                                                                                                |
| Frontend Jest                  | Pass — 27 suites, 51 tests, 13 snapshots                                                                            |
| Frontend production build      | Pass                                                                                                                |
| Backend TypeScript             | Pass                                                                                                                |
| Backend v1 integration harness | Pass                                                                                                                |
| Legacy backend Jest            | Pass — 7 suites, 26 tests                                                                                           |

The Vite build continues to emit pre-existing non-blocking maintenance warnings for the future native config loader, stale Browserslist data, and large chunks.

## Deliberately deferred

- Docker and Docker Compose changes
- Kubernetes changes
- AI/vector cleanup or relocation
- MUI/Emotion removal and Tailwind migration completion
- The audit's eleven delete candidates (none removed)
- Legacy API migration, removal, or behavior changes
- Frontend API migration to `/api/v1`

Historical architecture references in older documentation and deployment files remain intentionally untouched in this stage unless a direct developer command needed updating. They are candidates for a later documentation/infrastructure alignment stage, not evidence of a frontend execution dependency.

## Rollback

Rollback is structural: move the listed frontend paths back to the repository root, restore the prior root manifest and backend lockfile from version control, then run the same frontend and backend gates. No database data, API contract, or application feature behavior was changed in this stage.

## Stage 1 boundaries

Legacy API ready for removal remains **NO**. This stage makes no claim about Docker, Kubernetes, AI cleanup, payments, Checkout/Orders changes, Reviews changes, or frontend feature work.
