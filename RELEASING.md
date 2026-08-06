# Releasing

<div align="center">

**English** | [한국어](RELEASING.ko.md)
</div>

MDV is released by pushing a `v*` tag, which triggers `.github/workflows/release.yml`.

1. Bump `version` in `package.json` — `npm version X.Y.Z --no-git-tag-version` updates both `package.json` and `package-lock.json` in one step (skip the git tag it would otherwise create; that's step 2 below). Also update the hardcoded `dist/MDV-X.Y.Z-arm64-mac.zip` example path in both README.md's and README.ko.md's "Build a distributable app" section — it's not templated, so it silently goes stale otherwise. Commit everything as `Bump version to X.Y.Z` and merge to `main`.
2. Tag and push:
   ```
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. The tag push triggers the release workflow: `electron-builder` builds an unsigned macOS `.zip`, a `SHA256SUMS` file is generated, and both are attached to the GitHub Release for that tag via `softprops/action-gh-release`.
4. The workflow does **not** generate release notes (no `body`/`generate_release_notes` configured on the `softprops/action-gh-release` step) — the GitHub Release is published with an empty body. Write notes and attach them once the workflow finishes:
   ```
   gh release edit vX.Y.Z --notes-file <path-to-notes.md>
   ```
5. The workflow then runs `scripts/update-homebrew-tap.sh` to bump `version`/`sha256` in [`oiysful/homebrew-tap`](https://github.com/oiysful/homebrew-tap)'s `Casks/mdv.rb` and push the change to `main`, so `brew upgrade --cask oiysful/tap/mdv` picks up the new release. This step requires the `HOMEBREW_TAP_TOKEN` repo secret (see README's Distribution Notes); if it's unset, the step is skipped and the cask needs a manual bump.
6. Confirm the release: check the GitHub Release page for `MDV-*.zip`, `SHA256SUMS`, and the release notes, and check that `oiysful/homebrew-tap`'s `Casks/mdv.rb` shows the new version.
