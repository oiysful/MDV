<!-- Parent: ../AGENTS.md -->

# SCRIPTS KNOWLEDGE BASE

## OVERVIEW
Shell scripts for building and installing the distributable `MDV.app`, either from a local build or from a GitHub release. Not part of the app runtime; invoked manually via the `npm run install:*` / `update:*` scripts in the root `package.json`.

## STRUCTURE
```text
scripts/
├── common.sh          # shared helpers: info/fail/require_cmd, app install/checksum/download logic
├── install-local.sh   # npm install + electron-builder build + install to /Applications
├── install-release.sh # download latest (or tagged) GitHub release asset, verify checksum, install
├── update-local.sh    # like install-local, but requires a clean `main` tree first
└── update-release.sh  # thin alias for install-release.sh
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add/adjust a shared helper | `common.sh` | Sourced by every other script; keep it `set -euo pipefail` compatible |
| Change the local build/install flow | `install-local.sh`, `update-local.sh` | Both call `common.sh#install_app_bundle` + `resolve_local_build_path` |
| Change the release download/verify flow | `install-release.sh`, `common.sh#download_latest_release_asset` | Also touches `verify_checksum`, `install_release_artifact` |
| Repo/tag override knobs | `common.sh` top (`MDV_REPO_OWNER`, `MDV_REPO_NAME`), `MDV_RELEASE_TAG` | Used to point installs at forks or a specific tag |

## CONVENTIONS
- `set -euo pipefail` in every script; `common.sh` is always sourced, never executed directly.
- Every script resolves `SCRIPT_DIR`/`PROJECT_ROOT` via `BASH_SOURCE` so behavior doesn't depend on invocation cwd.
- `info`/`fail` from `common.sh` are the only user-facing output channel; `fail` always exits non-zero.
- `install_app_bundle` stages the new bundle into a `mktemp -d` sibling of `/Applications`, then swaps it in and backs up any existing bundle first, so a failed copy/move can never leave `/Applications/MDV.app` missing or half-written.
- `require_cmd` gates on external tools (`npm`, `git`, `curl`, `node`, `shasum`) before any real work starts.

## ANTI-PATTERNS
- Do not call `install_app_bundle` without going through a path that already checked `app_is_running` — swapping the bundle under a running app is exactly what that guard exists to prevent.
- Do not skip `verify_checksum` for release artifacts; it already tolerates a missing `SHA256SUMS` asset (warn-and-continue) so there's no need for a second bypass.
- Do not let `update-local.sh` proceed on a non-`main` branch or a dirty tree; those checks exist so `npm run update:local` never ships uncommitted or wrong-branch code under an "updated" banner.
- Do not hardcode `oiysful/MDV`; `common.sh` already reads `MDV_REPO_OWNER`/`MDV_REPO_NAME` so forks can point installs at themselves.

## NOTES
- `update-release.sh` is just `install-release.sh` under another name — there is no behavioral difference between "install" and "update" for the release flow (both always fetch the latest/tagged asset).
- `resolve_local_build_path` depends on `electron-builder`'s per-arch output directory naming (`dist/mac`, `dist/mac-arm64`, `dist/mac-universal`, ...); if `package.json#build` targets change, check this function stays in sync.
- These scripts are meant to be run via `npm run install:local` / `install:release` / `update:local` / `update:release`, not invoked directly by convention.
