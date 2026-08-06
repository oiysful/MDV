# Releasing

<div align="center">

**English** | [한국어](RELEASING.ko.md)
</div>

MDV is released by pushing a `v*` tag, which triggers `.github/workflows/release.yml`.

1. Bump `version` in `package.json` and merge a `Bump version to X.Y.Z` commit to `main`.
2. Tag and push:
   ```
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. The tag push triggers the release workflow: `electron-builder` builds an unsigned macOS `.zip`, a `SHA256SUMS` file is generated, and both are attached to the GitHub Release for that tag via `softprops/action-gh-release`.
4. The workflow then runs `scripts/update-homebrew-tap.sh` to bump `version`/`sha256` in [`oiysful/homebrew-tap`](https://github.com/oiysful/homebrew-tap)'s `Casks/mdv.rb` and push the change to `main`, so `brew upgrade --cask oiysful/tap/mdv` picks up the new release. This step requires the `HOMEBREW_TAP_TOKEN` repo secret (see README's Distribution Notes); if it's unset, the step is skipped and the cask needs a manual bump.
5. Confirm the release: check the GitHub Release page for `MDV-*.zip` and `SHA256SUMS`, and check that `oiysful/homebrew-tap`'s `Casks/mdv.rb` shows the new version.
