# Releasing

<div align="center">

**English** | [한국어](RELEASING.ko.md)
</div>

Releasing is the only thing that moves `main`. Work integrates on `develop`; a release is a deliberate pull request from `develop` into `main`, followed by a `v*` tag push that triggers `.github/workflows/release.yml`.

1. Bump `version` in `package.json` — `npm version X.Y.Z --no-git-tag-version` updates both `package.json` and `package-lock.json` in one step (skip the git tag it would otherwise create; that's step 3 below). Also update the hardcoded `dist/MDV-X.Y.Z-arm64-mac.zip` example path in both README.md's and README.ko.md's "Build a distributable app" section — it's not templated, so it silently goes stale otherwise. Commit everything as `chore(release): bump version to X.Y.Z` on a branch off `develop`, and merge it into `develop` through a pull request like any other change.
2. Open a pull request from `develop` to `main` and merge it. This is the act of releasing — `main` moves here and nowhere else.
3. Tag the merge commit on `main` and push:
   ```
   git checkout main && git pull --ff-only
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
   `v*` tags are protected against being moved or deleted, so a mistagged release cannot be quietly retagged — the ruleset has to be turned off deliberately first.
4. The tag push triggers the release workflow: `electron-builder` builds an unsigned macOS `.zip`, a `SHA256SUMS` file is generated, and both are attached to the GitHub Release for that tag via `softprops/action-gh-release`.
5. The workflow does **not** generate release notes (no `body`/`generate_release_notes` configured on the `softprops/action-gh-release` step) — the GitHub Release is published with an empty body. Write notes and attach them once the workflow finishes:
   ```
   gh release edit vX.Y.Z --notes-file <path-to-notes.md>
   ```
6. The workflow then runs `scripts/update-homebrew-tap.sh` to bump `version`/`sha256` in [`oiysful/homebrew-tap`](https://github.com/oiysful/homebrew-tap)'s `Casks/mdv.rb` and push the change to `main`, so `brew upgrade --cask oiysful/tap/mdv` picks up the new release. This step requires the `HOMEBREW_TAP_TOKEN` repo secret (see [Required secrets](#required-secrets) below); if it's unset, the step is skipped and the cask needs a manual bump.
7. Confirm the release: check the GitHub Release page for `MDV-*.zip`, `SHA256SUMS`, and the release notes, and check that `oiysful/homebrew-tap`'s `Casks/mdv.rb` shows the new version.

## Required secrets

- **`GITHUB_TOKEN`** (`env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`) is **not** a repo secret you need to create — it's the automatic per-run token GitHub Actions injects into every workflow, scoped to that run only. The only thing to verify is that the repo's **Settings → Actions → General → Workflow permissions** is set to "Read and write permissions" (or at least "read" plus the `contents: write` the workflow already declares at the top) — a repo defaulted to read-only Actions permissions would make `softprops/action-gh-release`'s upload step fail with a 403 even though the token itself needs no setup.
- Unlike `GITHUB_TOKEN`, **`HOMEBREW_TAP_TOKEN`** **is** a repo secret you must create manually: a fine-grained PAT with write access to `oiysful/homebrew-tap`, added under this repo's **Settings → Secrets and variables → Actions**. Without it, `scripts/update-homebrew-tap.sh` logs a notice and exits 0 (release still succeeds; only the tap bump is skipped).
