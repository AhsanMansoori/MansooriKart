# MansooriKart Repository Architecture & Production Cleanup Audit

Audit date: 2026-09-01. This is a read-only architecture assessment. No application, API, dependency, script, environment, infrastructure, or CI file was changed.

## 1. Executive Summary

MansooriKart has a sound clean TypeScript v1 backend slice and a passing frontend Vite application, but the repository is still structurally transitional. The frontend remains at the repository root, continues to consume legacy `/api/*` routes, and shares a root manifest with historical backend and CRA-era dependencies. The repository also contains multiple unverified Fusion-era deployment stacks.

Moving the frontend into `/frontend` and making the root an npm workspace orchestrator is recommended, but only as a separately approved, staged migration. The legacy API must remain in place until the frontend is fully migrated to `/api/v1` and all regression gates are green.

Online payment provider: **TBD**. COD is the currently supported flow; this audit makes no Payoneer or provider-specific recommendation.

## 2. Current Repository Tree

```text
MansooriKart/
├── src/                         # current Vite frontend source, at root
├── public/                      # current frontend public assets
├── backend/
│   ├── src/                     # clean TypeScript /api/v1 application
│   ├── tests/                   # real-Mongo v1 integration suites
│   ├── routes/, models/, ...    # legacy JavaScript /api implementation
│   ├── __tests__/               # legacy Jest suites
│   ├── scripts/, sync/, services/ # legacy recommendation tooling
│   ├── faiss_stores/            # generated vector artifacts
│   └── .cache/                  # MongoMemory binary cache
├── docs/                        # API, phase, security, screenshot records
├── .github/workflows/ci.yml     # active but Fusion/Node-18 pipeline
├── deployment/k8s/              # Fusion blue-green/canary manifests and scripts
├── kubernetes/                  # second, simpler Fusion manifest set
├── terraform/, nomad/, packer/, vault/, nginx/ # historical/aspirational infra
├── build/, dist/                # generated CRA-era and Vite output
├── Dockerfile, backend/Dockerfile, docker-compose.yml
├── Jenkinsfile, Makefile, publish/push shell scripts
└── root frontend configuration and package manifest
```

`node_modules/` and `backend/node_modules/` are present and excluded from this audit; they are generated dependency trees. `.git/` is not available in this workspace, so tracked/untracked status cannot be established from the audit environment.

## 3. Repository Health Assessment

| Area                   | Assessment                      | Evidence                                                                                                                               |
| ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Clean backend v1       | Healthy                         | `backend/src` has routes, middleware, controllers/services, serializers, validators, models, and 15 passing v1 HTTP/integration tests. |
| Legacy compatibility   | Required transition state       | Frontend requests `products`, `auth/*`, `checkout/create-order`, `orders/track`, and `search` through its `/api` client.               |
| Frontend               | Healthy but not package-bounded | Vite, TypeScript, Tailwind, Jest, and source all live at root; 27/27 suites and 51/51 tests passed.                                    |
| CI/CD and containers   | Not launch-ready                | Current pipeline and images assume Fusion, Node 18, legacy paths/ports, and old build output.                                          |
| Infrastructure         | Not evidenced as deployed       | Multiple contradictory Fusion manifests and templates exist; no deployment state or target configuration is present.                   |
| Security configuration | Needs a dedicated follow-up     | A local `backend/.env` exists and is ignored; no value was read. Ignore coverage for generated output and caches is incomplete.        |

## 4. Frontend Boundary Analysis

The following belong to the eventual `frontend/` package: `src/`, `public/`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `jest.config.js`, `jest.setup.js`, `babel.config.js`, and the frontend portion of `.env.example`.

The root package must ultimately stop being the frontend package. It should hold only workspace orchestration, shared quality tooling if deliberately shared, repository metadata, and root-level commands. `README.md`, `.gitignore`, `.prettierrc`, `.nvmrc`, `docs/`, `.github/`, and future `infrastructure/` remain root-owned.

### Future frontend package boundary

**Frontend runtime dependencies:** React, React DOM, React Router, Axios, MUI, Emotion (required by current MUI), Lucide, Motion, Lodash, Three, React Three Fiber/Drei, TanStack Query.

**Frontend development dependencies:** Vite, `@vitejs/plugin-react`, TypeScript, Tailwind, PostCSS, Autoprefixer, Jest/Babel/JSDOM/testing-library tooling, `identity-obj-proxy`, Prettier, and frontend type packages.

**Root workspace dependencies:** ideally only orchestration tooling such as `concurrently` and shared formatting tooling, if retained. The current root backend libraries (`bcryptjs`, `jsonwebtoken`, `mongoose`, `supertest`) duplicate backend ownership and should not remain at root after separation.

**Possibly unused/deferred dependency review:** Stripe packages and `react-credit-cards-2` have no frontend source imports. `react-material-ui-carousel` is referenced only by a snapshot mock. `react-hook-form` and Zod have no current frontend source import. React Buddy is imported only under `src/dev/`, which is not imported by the app entrypoint. These are candidates for a later evidence-based cleanup, not removals in this audit.

## 5. Backend Boundary Analysis

`backend/src` is the target production backend: TypeScript, Zod, `/api/v1`, layered services/controllers, safe serializers, and real-Mongo integration coverage. `backend/index.js`, `routes/`, `models/`, `config/`, `middleware/`, `utils/`, and `__tests__/` are the still-required legacy JavaScript backend.

The backend directory is understandable only when treated as a controlled migration boundary. It should not be flattened or mixed further. A future cleanup should preserve `backend/src`, `backend/tests`, and `backend/scripts`, while archiving or removing legacy-only infrastructure only after frontend migration proves zero legacy consumers.

## 6. Legacy API Analysis

The frontend currently calls legacy route families through `src/services/apiClient.js` and consuming pages/components. `backend/index.js` mounts both `/api/v1` and legacy `/api/products`, `/api/auth`, `/api/checkout`, `/api/orders`, and `/api/search`.

**LEGACY API: DEFER**  
**LEGACY API READY FOR REMOVAL: NO**

Required future deletion rule:

```text
Frontend fully migrated to /api/v1
→ repository-wide search shows zero legacy consumers
→ frontend, v1, and legacy regression evidence reviewed
→ explicit removal approval
→ remove legacy API
```

## 7. Docker Analysis

| Asset                | Assessment       | Evidence                                                                                                                          |
| -------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`         | MODERNIZE        | Node 18, Fusion labels, creates Vite output but copies `/app/build` rather than current `dist`.                                   |
| `backend/Dockerfile` | MODERNIZE        | Node 18, Fusion label, legacy `index.js`, port 3000, and workspace/root-context assumptions conflict with compose context.        |
| `docker-compose.yml` | MODERNIZE        | Backend build context is `./backend` although its Dockerfile expects root manifests; ports and Mongo host assumptions are legacy. |
| `nginx/`             | DELETE candidate | Its upstream is an unrelated `moodify-emotion-music-app` Django host; no MansooriKart consumer was found.                         |

**Docker recommendation: KEEP + MODERNIZE.** A later, approved container design should use separate frontend and backend images, Node 26 for build/runtime where appropriate, Vite `dist`, the v1 server entrypoint, explicit health checks, and external managed MongoDB rather than a production compose database assumption.

## 8. Kubernetes Analysis

Two separate Kubernetes sets exist: `kubernetes/` and `deployment/k8s/`. Both use Fusion names, Fusion domains/images, Node-era ports, and unverified assumptions. The larger set additionally assumes Istio, blue-green/canary delivery, HPA, Prometheus annotations, and operational tooling that the repository does not configure.

**Kubernetes recommendation: ARCHIVE.** Kubernetes is not justified by repository evidence for an initial public launch; it introduces cluster, ingress, certificate, secret, observability, networking, and on-call obligations without an evidenced target cluster. Preserve it as historical reference until a real platform decision is made.

## 9. CI/CD Analysis

`.github/workflows/ci.yml` is active by location but stale by implementation: it targets `master`, uses Node 18/20, performs mutating `npm run format`, names Fusion Electronics, exercises legacy backend tests, and attempts to build/push stale Docker images. The recommendation sanity matrix is not a real product recommendation test.

`Jenkinsfile` is an unverified Fusion pipeline that references absent `Dockerfile.frontend` and `Dockerfile.backend` paths, Fusion secrets, Kubernetes, and blue-green/canary scripts. It should be archived rather than treated as active CI.

## 10. Deployment Configuration Analysis

| Target                                      | Status                      | Evidence                                                                             |
| ------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| GitHub Actions                              | ACTUAL configuration, stale | Workflow exists but does not match current Node 26/Vite/v1 requirements.             |
| Vercel                                      | STALE                       | `backend/vercel.json` deploys legacy `index.js`.                                     |
| Docker Compose                              | STALE/local template        | Present but build contexts/ports do not match current structure.                     |
| Kubernetes, Terraform, Nomad, Packer, Vault | ASPIRATIONAL/HISTORICAL     | Fusion naming and no target account, cluster, state backend, or deployment evidence. |
| Render/Netlify/Railway/Fly                  | UNKNOWN                     | No active configuration found.                                                       |

## 11. AI / Recommendation Infrastructure Analysis

| Integration                  | Current use                                                                         | Core dependency            | Recommendation                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------- |
| Pinecone + Gemini embeddings | Legacy product routes and product hooks; startup catches sync errors and falls back | Optional for core commerce | MODERNIZE: decide whether it remains the one recommendation architecture. |
| Weaviate                     | Client and scripts; no current v1 route dependency                                  | Optional                   | ARCHIVE pending a deliberate decision; it duplicates vector-store scope.  |
| FAISS                        | Build/search scripts and committed/generated index artifacts                        | Optional                   | ARCHIVE; do not carry generated indexes as production source of truth.    |

Core commerce does not require these services when their configuration is absent. The legacy product recommendation layer contains fallbacks. Cleanup is needed because three vector strategies and a deprecated Google SDK are retained, but no removal is authorized here.

## 12. Documentation Analysis

| Documentation class               | Files                                                                                               | Assessment                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Current source of truth           | `docs/API_CONTRACT.md`, `docs/API_INVENTORY.md`, `docs/SECURITY.md`, `docs/LEGACY_API_REMOVAL.md`   | KEEP and maintain with v1 behavior.                                             |
| Implementation reports            | `docs/PHASE_1_REPORT.md`, `docs/PHASE_2_REPORT.md`, `docs/BACKEND_API_AUDIT.md`, `docs/BASELINE.md` | ARCHIVE logically, preserve as evidence.                                        |
| Historical/incorrect architecture | root `ARCHITECTURE.md`, root `DEPLOYMENT.md`, root README portions, older Fusion references         | MODERNIZE/ARCHIVE; do not represent these as current MansooriKart architecture. |
| UI evidence                       | `docs/*-ui.png`, screenshots, logo                                                                  | ARCHIVE as review evidence, not runtime assets.                                 |

Future documentation structure should be `docs/architecture`, `docs/api`, `docs/security`, `docs/testing`, `docs/deployment`, and `docs/legacy`, created only during the approved restructuring phase.

## 13. Environment / Secrets Structure Analysis

| Class                            | Variable names / evidence                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend-safe                    | `VITE_API_URL`, `VITE_BACKEND_URL` in root `.env.example`.                                                                                                       |
| Backend-only secrets             | `MONGO_URI`, `JWT_SECRET`, `PINECONE_API_KEY`, `GOOGLE_AI_API_KEY`, `WEAVIATE_API_KEY`.                                                                          |
| Backend non-secret configuration | `PORT`, `NODE_ENV`, `CORS_ALLOWED_ORIGINS`, `PINECONE_HOST`, `PINECONE_INDEX`, `PINECONE_NAMESPACE`, `PINECONE_PURGE_ON_SYNC`, `RECOMMENDATION_PREFER_WEAVIATE`. |
| Historical deployment names      | `MONGODB_URI`, `FRONTEND_URL`, `FRONTEND_PORT`, deployment/Kubernetes variables.                                                                                 |

`backend/.env` exists locally and is ignored. Its contents were not read or displayed. Because repository Git metadata is unavailable in this workspace, whether that file was ever committed cannot be established. Treat it as a high-priority follow-up check in the Production Configuration & Secrets phase. No committed secret was proven by this audit.

## 14. Tests and Scripts Analysis

| Area                          | Assessment                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Frontend tests                | MOVE with frontend: 27 suites / 51 tests, root Jest/Babel setup is frontend-specific.              |
| v1 backend tests              | KEEP in `backend/tests`: 15 real-Mongo HTTP/integration tests.                                     |
| Legacy backend tests          | DEFER in `backend/__tests__`: 7 suites / 26 tests, required while legacy routes exist.             |
| Backend AI scripts            | ARCHIVE pending recommendation architecture decision.                                              |
| Bootstrap super-admin         | KEEP as a controlled backend operational script; document its production authorization path later. |
| Root Makefile/publish scripts | ARCHIVE: their assumptions do not match current manifests, test commands, or Docker files.         |
| `run-fusion-cron.sh`          | DELETE candidate: no consumer evidence and Fusion-only purpose/name.                               |

## 15. Dependency Analysis

MUI is still required: 25 files under `src/` import `@mui/*`. Emotion has no direct source import but is MUI's current styling peer dependency, so it remains required. Tailwind is correctly configured for incremental migration; global MUI removal is not safe.

Confirmed no-source-import candidates in the root manifest include Stripe packages, `react-credit-cards-2`, root backend libraries, `css-loader`, `style-loader`, and `@pmmmwh/react-refresh-webpack-plugin`. These are **future DELETE candidates only**; removal must follow package-boundary migration and one-at-a-time regression validation. React Buddy and its `src/dev` material are archive candidates, not confirmed package deletions yet.

## 16. Build / Bundle Analysis

The fresh Vite build passed. The `HeroScene` lazy chunk is approximately 870 kB minified and the main chunk approximately 759 kB, consistent with Three.js, React Three Fiber/Drei, and component-library weight. No AI SDK is imported into the frontend bundle.

Recommended future work: retain `HeroScene` lazy loading, assess route-level lazy loading, profile MUI imports, and only then consider manual chunks. Do not optimize during this audit.

Browserslist/caniuse data age is a **maintenance cleanup**, not a production blocker. The Vite native config-loader warning is **low priority**: `vite.config.ts` uses ESM syntax while the surrounding package is treated as CommonJS. Address it during the frontend package/configuration migration, not through a Vite upgrade now.

## 17. Cleanup Classification Table

Counts refer to significant repository item groups, not every individual source file.

| Path                                                | Classification   | Current use            | Evidence                                                                      | Target                                       | Risk   | Recommendation                                    |
| --------------------------------------------------- | ---------------- | ---------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- | ------ | ------------------------------------------------- |
| `package.json`                                      | MOVE             | Yes                    | Current root frontend manifest                                                | root workspace + `frontend/package.json`     | High   | Split only in approved migration.                 |
| `package-lock.json`                                 | MODERNIZE        | Yes                    | Single-root install shape                                                     | root workspace lock                          | High   | Regenerate with workspace move.                   |
| `src/`                                              | MOVE             | Yes                    | Vite entry imports it                                                         | `frontend/src/`                              | High   | Move atomically with configs.                     |
| `public/`                                           | MOVE             | Yes                    | Vite public assets                                                            | `frontend/public/`                           | Medium | Move with frontend package.                       |
| `index.html`                                        | MOVE             | Yes                    | Vite entry HTML                                                               | `frontend/index.html`                        | Medium | Update root scripts afterward.                    |
| `vite.config.ts`                                    | MOVE             | Yes                    | Current Vite config                                                           | `frontend/vite.config.ts`                    | Medium | Correct root-relative paths.                      |
| `tsconfig.json`                                     | MOVE             | Yes                    | Frontend-only include                                                         | `frontend/tsconfig.json`                     | Medium | Preserve alias contract.                          |
| `tailwind.config.js`                                | MOVE             | Yes                    | Scans root frontend files                                                     | `frontend/tailwind.config.js`                | Medium | Update content globs.                             |
| `postcss.config.js`                                 | MOVE             | Yes                    | Frontend build config                                                         | `frontend/postcss.config.js`                 | Low    | Move with Tailwind.                               |
| `jest.config.js`                                    | MOVE             | Yes                    | Frontend test config                                                          | `frontend/jest.config.js`                    | Medium | Update rootDir paths.                             |
| `jest.setup.js`                                     | MOVE             | Yes                    | Frontend JSDOM setup                                                          | `frontend/jest.setup.js`                     | Low    | Keep inert polyfills.                             |
| `babel.config.js`                                   | MOVE             | Yes                    | Jest JSX transform                                                            | `frontend/babel.config.js`                   | Medium | Preserve Babel-Jest resolution.                   |
| `.env.example` frontend entries                     | MOVE             | Yes                    | Vite variables only                                                           | `frontend/.env.example`                      | Low    | Keep backend example separate later.              |
| `src/tests/`                                        | MOVE             | Yes                    | 27 frontend suites                                                            | `frontend/src/tests/`                        | Medium | Move snapshots together.                          |
| Root scripts/workspaces                             | MODERNIZE        | Yes                    | Root is frontend-oriented, workspace only has backend                         | root orchestrator                            | High   | Define frontend + backend workspaces later.       |
| Root ESLint/CRA metadata                            | MODERNIZE        | Partial                | `eslintConfig` references react-app while Vite is active                      | frontend config or removal                   | Medium | Audit after package split.                        |
| `.gitignore`                                        | MODERNIZE        | Yes                    | Ignores node_modules/env but not `dist`, `build`, backend cache, FAISS output | root                                         | Low    | Add generated-output rules later.                 |
| `.prettierrc`                                       | KEEP             | Yes                    | Shared formatting config                                                      | root                                         | Low    | Retain shared.                                    |
| `.nvmrc`                                            | KEEP             | Yes                    | Node 26 project requirement                                                   | root                                         | Low    | Retain shared.                                    |
| `build/`                                            | DELETE           | No                     | Old generated CRA-style output                                                | ignored generated output                     | Low    | Remove only in approved cleanup.                  |
| `dist/`                                             | DELETE           | No                     | Vite build output                                                             | ignored generated output                     | Low    | Remove only in approved cleanup.                  |
| root `node_modules/`                                | DELETE           | Generated              | Dependency install tree                                                       | regenerated                                  | Low    | Never version; recreate via npm.                  |
| `backend/package.json`                              | KEEP             | Yes                    | Backend ownership and scripts                                                 | `backend/`                                   | Low    | Rename branding later only.                       |
| `backend/src/`                                      | KEEP             | Yes                    | Current v1 application                                                        | `backend/src/`                               | Low    | Preserve layered design.                          |
| `backend/tests/`                                    | KEEP             | Yes                    | Real Mongo v1 test harness                                                    | `backend/tests/`                             | Low    | Preserve.                                         |
| Legacy `backend/routes`, `models`, `config`, etc.   | DEFER            | Yes                    | Mounted by `backend/index.js` and consumed by frontend                        | `backend/legacy/` only after migration       | High   | Do not move/remove now.                           |
| `backend/__tests__/`                                | DEFER            | Yes                    | Legacy test gate                                                              | `backend/legacy-tests/` only after migration | Medium | Retain with legacy API.                           |
| `backend/scripts/` AI tools                         | ARCHIVE          | Partial                | Legacy optional tooling                                                       | `backend/scripts/legacy-ai/`                 | Medium | Decide recommendation strategy first.             |
| `backend/faiss_stores/`                             | ARCHIVE          | Unknown                | Generated FAISS index artifacts                                               | external artifact store or archive           | Medium | Do not treat as source of truth.                  |
| `backend/.cache/`                                   | DELETE           | No                     | MongoMemory binary cache                                                      | ignored generated output                     | Low    | Remove in cleanup.                                |
| `backend/Dockerfile`                                | MODERNIZE        | Partial                | Node 18/legacy entrypoint/context issue                                       | `infrastructure/docker/backend.Dockerfile`   | High   | Rebuild after workspace move.                     |
| `backend/vercel.json`                               | ARCHIVE          | Unknown                | Legacy `index.js` target                                                      | deployment history                           | Medium | Reassess only with Vercel decision.               |
| `backend/.env`                                      | DEFER            | Local                  | Ignored sensitive configuration                                               | local secret manager/env                     | High   | Check Git history separately; never print values. |
| Current API/security docs                           | KEEP             | Yes                    | v1 contracts and security records                                             | `docs/api`, `docs/security` later            | Low    | Keep authoritative.                               |
| Phase/API audit reports                             | ARCHIVE          | Yes, historical        | Implementation evidence                                                       | `docs/legacy/reports` later                  | Low    | Preserve, label historical.                       |
| `docs/*-ui.png`                                     | ARCHIVE          | Yes, evidence          | Static review screenshots                                                     | `docs/legacy/ui-evidence` later              | Low    | Preserve separately from code.                    |
| Root README                                         | MODERNIZE        | Yes                    | Contains Fusion-era identity/details                                          | root README                                  | Medium | Make MansooriKart source-of-truth.                |
| Root architecture/deployment docs                   | ARCHIVE          | No as current truth    | Fusion-era assumptions                                                        | `docs/legacy/` later                         | Low    | Preserve history only.                            |
| Root `Dockerfile`                                   | MODERNIZE        | Partial                | Node 18 and `/app/build` mismatch                                             | `infrastructure/docker/frontend.Dockerfile`  | High   | Rebuild post-move.                                |
| `docker-compose.yml`                                | MODERNIZE        | Unknown                | Invalid backend context and legacy ports                                      | `infrastructure/docker/compose.yaml`         | High   | Recreate from chosen dev topology.                |
| `nginx/`                                            | DELETE           | No                     | Unrelated Django/Moodify upstream                                             | none                                         | Low    | Remove only after approval.                       |
| `kubernetes/`                                       | ARCHIVE          | Unknown                | Fusion images/ports                                                           | `infrastructure/archive/kubernetes-simple`   | Medium | Not launch infrastructure.                        |
| `deployment/k8s/`                                   | ARCHIVE          | Unknown                | Fusion names, domains, Istio assumptions                                      | `infrastructure/archive/kubernetes-advanced` | Medium | Preserve as reference only.                       |
| `deployment/scripts/`                               | ARCHIVE          | Unknown                | Script defaults target Fusion cluster                                         | `infrastructure/archive/scripts`             | Medium | Do not execute.                                   |
| `terraform/`                                        | ARCHIVE          | Unknown                | Fusion default name/template                                                  | `infrastructure/archive/terraform`           | Medium | No state/backend evidence.                        |
| `nomad/`                                            | ARCHIVE          | Unknown                | Fusion image references                                                       | `infrastructure/archive/nomad`               | Low    | Preserve historical template.                     |
| `packer/`                                           | ARCHIVE          | Unknown                | Node 18/Fusion image recipe                                                   | `infrastructure/archive/packer`              | Low    | Preserve historical template.                     |
| `vault/`                                            | ARCHIVE          | Unknown                | Fusion secret paths                                                           | `infrastructure/archive/vault`               | Medium | Recreate only with real Vault adoption.           |
| `Jenkinsfile`                                       | ARCHIVE          | Unknown                | References missing Dockerfiles and Fusion infrastructure                      | `infrastructure/archive/jenkins`             | Medium | Do not enable.                                    |
| `.github/workflows/ci.yml`                          | MODERNIZE        | Yes                    | Active workflow, Node 18/20/Fusion/Docker mismatch                            | `.github/workflows/ci.yml`                   | High   | Update after workspace design.                    |
| `Makefile`                                          | ARCHIVE          | Unknown                | Stale package/image/test assumptions                                          | `scripts/archive/Makefile`                   | Low    | Replace only if make is chosen.                   |
| `publish.sh`, `push_image.sh`, backend publish/push | ARCHIVE          | Unknown                | Historical registry/deployment helpers                                        | `scripts/archive/`                           | Medium | Do not run without target review.                 |
| `run-fusion-cron.sh`                                | DELETE           | No evidence            | Fusion-named one-off script, no consumer found                                | none                                         | Low    | Remove only after approval.                       |
| Pinecone/Gemini legacy integration                  | MODERNIZE        | Partial                | Legacy routes/hooks, graceful fallback                                        | chosen recommendation service                | High   | Choose one supported architecture.                |
| Weaviate integration                                | ARCHIVE          | Scripts only           | No v1 route dependency found                                                  | legacy AI archive                            | Medium | Avoid duplicate vector stores.                    |
| FAISS integration                                   | ARCHIVE          | Scripts/artifacts only | No v1 route dependency found                                                  | legacy AI archive                            | Medium | Avoid generated artifact coupling.                |
| MUI + Emotion                                       | KEEP             | Yes                    | 25 MUI-importing frontend files; Emotion peer styling                         | `frontend/`                                  | High   | Retain during Tailwind migration.                 |
| React Buddy + `src/dev/`                            | ARCHIVE          | No app entry consumer  | Development-only imports under orphan dev folder                              | `frontend/dev-tools/archive`                 | Low    | Decide after tool workflow review.                |
| Stripe packages                                     | DELETE candidate | No source import       | Manifest-only references                                                      | none                                         | Low    | Verify payment decision before removal.           |
| `react-credit-cards-2`                              | DELETE candidate | No source import       | Manifest-only reference                                                       | none                                         | Low    | Remove after payment/UI audit.                    |
| Root backend libraries                              | DELETE candidate | No root source use     | Backend owns its own dependencies                                             | none                                         | Medium | Remove after workspace split.                     |
| Webpack loaders/refresh plugin                      | DELETE candidate | No active config use   | Vite is active; package-only references                                       | none                                         | Low    | Remove after config validation.                   |
| `.husky/`                                           | DEFER            | Unknown                | Present; hooks not audited as active                                          | root                                         | Low    | Inspect before relocation.                        |
| `.claude/`, `.idea/`, `.kombai/`                    | DEFER            | Unknown                | Tool/editor metadata                                                          | root or local-ignore                         | Low    | Confirm team tooling policy first.                |
| `LICENSE`                                           | KEEP             | Yes                    | Repository legal metadata                                                     | root                                         | Low    | Retain.                                           |
| `openapi.yaml`                                      | DEFER            | Unknown                | Separate legacy API artifact; no current v1 generation evidence               | `docs/legacy` or refreshed API spec          | Medium | Decide during API documentation phase.            |

## 18. Proposed Production Repository Structure

```text
MansooriKart/
├── frontend/
│   ├── public/
│   ├── src/                    # retain current folders first; reorganize later
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   └── jest.config.js
├── backend/
│   ├── src/
│   ├── tests/
│   ├── scripts/
│   ├── package.json
│   └── tsconfig.json
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── security/
│   ├── testing/
│   ├── deployment/
│   └── legacy/
├── infrastructure/
│   ├── docker/
│   └── archive/                # only after explicit archival decision
├── scripts/                     # root orchestration only
├── .github/workflows/
├── package.json                 # workspace/orchestration only
├── README.md
├── .gitignore
└── .nvmrc
```

Do not create empty feature folders (`app`, `features`, `hooks`, etc.) until a frontend ownership need exists.

## 19. Frontend-to-/frontend Migration Map

| Current path                       | Future path                   |
| ---------------------------------- | ----------------------------- |
| `src/`                             | `frontend/src/`               |
| `public/`                          | `frontend/public/`            |
| `index.html`                       | `frontend/index.html`         |
| `vite.config.ts`                   | `frontend/vite.config.ts`     |
| `tsconfig.json`                    | `frontend/tsconfig.json`      |
| `tailwind.config.js`               | `frontend/tailwind.config.js` |
| `postcss.config.js`                | `frontend/postcss.config.js`  |
| `jest.config.js`                   | `frontend/jest.config.js`     |
| `jest.setup.js`                    | `frontend/jest.setup.js`      |
| `babel.config.js`                  | `frontend/babel.config.js`    |
| frontend section of `package.json` | `frontend/package.json`       |
| frontend section of `.env.example` | `frontend/.env.example`       |

Root-owned files remain root-owned: workspace `package.json`, lockfile, `.gitignore`, `.prettierrc`, `.nvmrc`, `README.md`, `docs/`, `.github/`, and approved infrastructure.

## 20. Files Proposed for Deletion

No deletion is authorized in this audit. Future candidates with evidence are: generated `build/`, `dist/`, `backend/.cache/`, dependency directories regenerated by npm, the unrelated `nginx/` Django proxy, `run-fusion-cron.sh`, and manifest-only legacy dependencies after separate validation. Their deletion must be staged, reviewed, and regression-tested.

## 21. Files Proposed for Archive

Archive candidates are the Fusion deployment/Kubernetes/Nomad/Packer/Terraform/Vault/Jenkins material, legacy deployment helper scripts, AI alternatives not selected for production, phase reports, UI screenshots, root Fusion architecture/deployment documents, and React Buddy dev tooling. Archive means preserve history and clearly remove current-production status; it does not mean delete.

## 22. Files Proposed for Modernization

Priority modernization items are root workspace metadata/scripts, frontend package boundary, `.gitignore`, root README, GitHub Actions, Docker assets, compose topology, current documentation structure, and the single selected recommendation architecture. The Vite config-loader notice and Browserslist data are low-priority maintenance items.

## 23. Deferred Items

- **Legacy `/api/*` code and tests — DEFER.** Frontend migration has not happened.
- Local `backend/.env` handling and repository secret history — DEFER to the secrets phase.
- `openapi.yaml`, Husky, editor/agent metadata, Vercel configuration, and historical scripts — DEFER pending a real ownership/deployment decision.
- Payment provider architecture — DEFER; provider is TBD and COD remains supported.

## 24. Docker Recommendation

**KEEP + MODERNIZE.** Containers remain useful for reproducible developer and deployment environments, but the current files cannot be trusted as production definitions. Recreate their assumptions only after the workspace/frontend move is complete and a hosting target is selected.

## 25. Kubernetes Recommendation

**ARCHIVE.** The repository proves neither a running cluster nor the operational prerequisites. Preserve manifests as historical material rather than investing in a partial, Fusion-branded Kubernetes stack for launch.

## 26. Future CI/CD Recommendation

After workspace migration, use one maintained GitHub Actions pipeline on Node 26 that runs immutable formatting checks, frontend typecheck/test/build, backend typecheck/v1 tests/legacy tests, and optional container builds only when modern Docker definitions exist. Do not deploy automatically until a target, secrets model, health checks, and rollback ownership are agreed.

## 27. Migration Risk Matrix

| Stage                                  | Risk   | Expected files affected                    | Validation                             | Rollback                                       |
| -------------------------------------- | ------ | ------------------------------------------ | -------------------------------------- | ---------------------------------------------- |
| Capture clean baseline                 | Low    | none                                       | Current full quality gates             | none needed                                    |
| Introduce frontend package boundary    | High   | root/frontend manifests and lockfile       | install, frontend test/build/typecheck | revert package/lock change                     |
| Move frontend source/config            | High   | source, public, Vite/Jest/Tailwind configs | dev start, test, build, aliases        | atomic commit/revert                           |
| Establish root workspace commands      | High   | root package/lock/CI references            | all root delegated commands            | revert orchestration only                      |
| Update CI and Docker                   | High   | workflows, Dockerfiles, compose            | CI dry run/build locally               | retain old definitions until replacement works |
| Archive/delete confirmed legacy assets | Medium | historical infra/docs/generated files      | repository search and regression       | archive first; restore from VCS                |
| Migrate frontend to v1                 | High   | frontend API client/features/tests         | real HTTP and full regression          | feature-by-feature rollback                    |
| Remove legacy API                      | High   | legacy backend and tests                   | zero-consumer proof + approval         | only after tagged release/backup               |

## 28. Recommended Restructuring Sequence

1. Preserve the current green baseline and this audit.
2. Approve frontend workspace/package-boundary migration only.
3. Move frontend source and its config atomically; repair paths, aliases, tests, and Vite.
4. Make the root an orchestrator with `frontend` and `backend` workspaces.
5. Modernize CI for Node 26 and workspace commands.
6. Rebuild Docker/compose around the new boundaries and selected deployment target.
7. Reclassify/archive historical infrastructure and documentation.
8. Migrate frontend API consumers incrementally to `/api/v1`.
9. Prove no legacy consumers, then separately approve legacy API removal.

## 29. Production Readiness Gaps Found

- Frontend uses legacy API paths; legacy API removal is blocked.
- Root/frontend package boundary is incomplete.
- CI/CD and Docker target Node 18/Fusion-era behavior, not Node 26/Vite/v1.
- Deployment configuration is unproven and internally inconsistent.
- Generated output/cache paths need ignore and cleanup policy.
- Multiple recommendation technologies need a single intentional ownership decision.
- Online payment provider is TBD; no provider integration should be assumed.
- Local secret history must be audited in a Git-capable environment.
- Large Three.js-related chunks need later performance review, not an audit-time rewrite.

## 30. Final Verdict

The repository is ready for a **carefully staged repository restructuring phase**, beginning with frontend package separation. It is not ready for broad cleanup, Docker/Kubernetes activation, legacy API removal, or payment-provider work. Preserve all compatibility layers until the frontend has migrated to `/api/v1` and regression evidence supports removal.

**LEGACY API READY FOR REMOVAL: NO**
