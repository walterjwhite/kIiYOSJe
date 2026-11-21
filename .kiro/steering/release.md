---
inclusion: auto
---

# Release

## Artifacts

| Artifact | Built by | Notes |
| --- | --- | --- |
| Server archive `mind-server-<tag>.tgz` | `release.yml` | compiled `dist/`, migrations, manifests, LICENSE |
| VSIX `mind-vscode-<version>.vsix` | `scripts/build-extension.sh` | ships `extension/LICENSE` as `LICENSE.txt` |
| SBOM `mind-<tag>.sbom.cdx.json` | `npm sbom` | production dependencies |
| `SHA256SUMS` + build provenance attestation | `release.yml` | verify with `gh attestation verify` |

## Versioning

Semantic versioning, `0.x` until the safety gates, adapters, and migrations are
verified on live accounts. While `0.x`, a minor bump may break config or the API;
the changelog says how to migrate. Root and extension `package.json` versions and
the git tag (`vX.Y.Z`) must match; `release.yml` checks it.

## Changelog

`CHANGELOG.md` follows Keep a Changelog. Every user-visible change has an entry
under `[Unreleased]` in its PR. A release moves it under a dated version heading.

## Release checklist

1. All `launch-blocker` issues for the milestone are closed.
2. `main` is green: CI, Security, CodeQL.
3. Changelog and versions updated in a PR; `STATUS.md` matches reality.
4. Upgrade test passes against a database from the previous release.
5. Tag `vX.Y.Z` on `main`. The workflow builds, attests, and creates a **draft**
   release after the `release` environment's required reviewer approves.
6. A human installs the VSIX and runs the server from the archive on a clean
   machine, then publishes the draft.
7. Announce only what was verified. Do not claim provider verification,
   certification, or partnership.

## Migrations

Forward-only. Never edit an applied migration (`check-migrations.mjs` enforces it
in CI and on save). The server backs up the database before applying a pending
migration, refuses to start on a schema newer than it knows, and logs what ran.
Rollback is restore from that backup, not a down-migration.

## Rollback

Reinstall the previous VSIX and server archive, restore the pre-migration backup
if the schema changed, and open an issue with redacted logs.

## Hotfix

Branch from the release tag, fix with a regression test, release a patch version
through the same pipeline. No skipping gates.

## Support policy

Latest release only while `0.x`. Security fixes go through `SECURITY.md`.
