# Infrastructure

This directory separates the current container definitions from archived infrastructure history.

- `docker/` contains the active MansooriKart container definitions used by the root `docker-compose.yml`.
- `kubernetes-archive/` preserves the former Fusion Kubernetes manifests and deployment scripts. It is reference material only and is not current deployment guidance.
- `ci-archive/` preserves the former Jenkins pipeline. GitHub Actions is the only active CI configuration in this repository.
- `legacy-archive/` preserves inactive Fusion infrastructure templates and publishing helpers with no current consumer.

No hosting provider or production deployment target is selected by this structure.
