# MansooriKart Repository Restructure — Stage 2

## Scope and outcome

Stage 2 modernizes the active container and CI configuration around the Stage 1 npm workspace while preserving application behavior, legacy API compatibility, MUI/Emotion, and all AI/vector integrations. No hosting provider or production deployment target is selected.

## Infrastructure boundary

`infrastructure/` now has three purposeful areas:

- `docker/` contains the active frontend and backend Dockerfiles plus the minimal nginx SPA configuration.
- `kubernetes-archive/` retains the former Kubernetes manifests and associated blue-green/canary deployment scripts as historical reference.
- `ci-archive/` retains the former Jenkins pipeline as historical reference.

The root `docker-compose.yml` remains at the repository root because it is a conventional local entry point. It references the Dockerfiles in `infrastructure/docker/`.

## Docker architecture

Both container builds use the one root workspace lockfile rather than package-local lockfiles.

- The frontend image uses Node 26 to install and build the `frontend` workspace, then serves `frontend/dist` with nginx. It is a production static server, not the Vite development server. nginx supports SPA routing and deliberately does not proxy `/api`.
- The backend image uses Node 26 multi-stage builds. It validates and compiles `backend/src`, installs production dependencies separately, runs `dist/server.js` as the non-root `node` user, exposes port 5000, and health-checks `/api/v1/health`.
- Docker Compose starts only frontend and backend. MongoDB is external; `MONGO_URI` and `JWT_SECRET` are supplied at runtime and never embedded in the image or Compose file.
- Compose's frontend build argument is a public `VITE_API_URL`. Its local default targets `http://localhost:5000/api`; split-host deployments must supply an appropriate public backend origin at build time.

The Dockerfiles and compose configuration passed static validation. Docker itself is unavailable in this environment, so image builds and `docker compose config` could not be executed.

## Kubernetes archival and security

The prior `kubernetes/` and `deployment/` directories were moved intact under `infrastructure/kubernetes-archive/`, including 30 historical manifest/script files. The archive README explicitly states that they are not MansooriKart deployment instructions.

The security inspection checked Kubernetes Secret resources, URI/token/private-key indicators, and certificate/private-key files without outputting values. The only Secret resource is a placeholder template; no literal secret values, tokens, database URIs, private registry credentials, or certificates were found.

## CI/CD

`.github/workflows/ci.yml` is now the sole active CI definition. It uses Node 26, root `npm ci`, root-lockfile npm caching, immutable `format:check`, lint, workspace typechecks, frontend tests/build, legacy backend tests, and v1 integration tests. The obsolete image-publish/deployment and recommendation-sanity jobs were removed; no CI secrets are referenced.

`Jenkinsfile` was moved to `infrastructure/ci-archive/` and is marked historical. No other deployment provider was activated or selected. `backend/vercel.json`, Terraform, Nomad, Packer, Vault, the old nginx directory, Makefile, and publishing helpers remain deferred historical/configuration material for a later, explicitly approved decision.

## Fusion assumptions addressed

Active Docker and CI files no longer contain Fusion branding, Node 18 images, CRA/CRACO/Webpack assumptions, legacy build output paths, stale port mappings, or stale workspace paths. Historical assets retain their original wording inside their clearly labeled archive locations.

The former root Fusion deployment and architecture documents now carry an explicit historical notice, and the root README points to the current deployment guidance instead of claiming an active Kubernetes capability.

## Files changed or moved

- Added `infrastructure/docker/frontend.Dockerfile`, `backend.Dockerfile`, and `nginx.conf`.
- Added root `.dockerignore` and modernized root `docker-compose.yml`.
- Modernized `.github/workflows/ci.yml`.
- Moved root/frontend and backend Dockerfiles to `infrastructure/docker/archive/`.
- Moved `Jenkinsfile` to `infrastructure/ci-archive/`.
- Moved `kubernetes/` and `deployment/` to `infrastructure/kubernetes-archive/`.
- Added infrastructure and deployment documentation.
- Added a container build-time environment fallback for the existing public `VITE_API_URL`; ordinary local Vite behavior remains unchanged.

## Deferred work and Stage 3 candidates

- Verify real image builds and Compose validation in a Docker-capable environment.
- Choose a hosting provider, production edge/reverse proxy, and final CORS/origin configuration.
- Decide whether to archive or modernize the remaining Terraform, Nomad, Packer, Vault, old nginx, Makefile, Vercel, and publishing artifacts.
- Perform the separately approved dead-file/dependency cleanup, frontend `/api/v1` migration, legacy API removal work, and AI/vector rationalization only in their respective future stages.

No audit delete candidate was removed in Stage 2.

## Rollback

Restore the former active Dockerfiles, Jenkinsfile, Kubernetes/deployment directories, Compose file, CI workflow, and Vite configuration from version control, then rerun the Stage 1 and Stage 2 regression gates. The archived assets remain in this repository, so archival moves are recoverable without reconstructing their contents.
