# MansooriKart deployment and container guidance

## Current status

Docker definitions are maintained for reproducible images and local container testing. No cloud host, Kubernetes cluster, or automatic deployment target is configured by this repository. GitHub Actions performs validation only; it does not publish images or deploy.

## Workspace-aware images

Both images build from the repository root and use the single root `package-lock.json`. This is required because `frontend/` and `backend/` are npm workspaces. The Dockerfiles are intentionally located in `infrastructure/docker/`:

- `frontend.Dockerfile` installs the frontend workspace, builds the Vite application, and serves `frontend/dist` through nginx on container port `80`.
- `backend.Dockerfile` typechecks and compiles `backend/src`, installs production backend dependencies in a separate stage, runs as the non-root `node` user, and starts `dist/server.js` on container port `5000`.

The backend image does not include MongoDB. Configure a managed or otherwise externally operated MongoDB instance through the runtime environment.

## Build commands

```sh
docker build -f infrastructure/docker/frontend.Dockerfile -t mansoorikart-frontend .
docker build -f infrastructure/docker/backend.Dockerfile -t mansoorikart-backend .
```

The frontend accepts the build-time, public `VITE_API_URL` argument. If omitted, the existing frontend default remains in effect. Supply an externally reachable API URL for split-host deployments; do not put credentials in this value.

## Compose

`docker compose up --build` starts only `frontend` and `backend`. It deliberately does not start MongoDB because normal development may use MongoDB Atlas or another externally managed database.

Compose maps frontend port `8080` to nginx port `80` and backend port `5000` to the v1 server. Values can be overridden with `FRONTEND_PORT` and `BACKEND_PORT`.

For local Compose use, provide these runtime environment variable names through your shell or an uncommitted environment file:

- `MONGO_URI`
- `JWT_SECRET`
- `FRONTEND_URL`
- `CORS_ALLOWED_ORIGINS`
- `PORT` (optional; Compose defaults it to `5000`)

`VITE_API_URL` is public build-time configuration, not a secret. The Compose default is `http://localhost:5000/api`, so the browser talks directly to the mapped backend port. nginx intentionally does not proxy `/api`; for a same-origin production design, configure that reverse proxy at the selected deployment edge, or provide the appropriate public `VITE_API_URL` at image build time.

## Health checks

The backend container and Compose service use `GET /api/v1/health`. The frontend health check only confirms that nginx serves the static SPA; it does not assert backend connectivity.

## CI and Kubernetes

GitHub Actions installs with `npm ci` against the root lockfile, then runs formatting, lint, workspace typechecks, frontend tests/build, legacy backend tests, and v1 integration tests on Node 26.

Kubernetes material is archived under `infrastructure/kubernetes-archive/`. It is historical reference only and must not be used as MansooriKart deployment guidance.
