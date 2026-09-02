# Historical infrastructure archive

This directory preserves inactive Fusion-era infrastructure and publishing helpers that have no active MansooriKart consumer:

- `Makefile`, `publish.sh`, and `push_image.sh` contain outdated package, registry, image, and deployment assumptions.
- `terraform/`, `nomad/`, `packer/`, and `vault/` are unverified historical templates with no selected target platform or state/configuration ownership.

These files are retained for migration history only. They are not current deployment, publishing, or secret-management instructions and must be redesigned and security-reviewed before any future adoption.
