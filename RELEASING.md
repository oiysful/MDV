# Releasing

MDV is released by pushing a `v*` tag, which triggers `.github/workflows/release.yml`.

1. Bump `version` in `package.json` and merge a `Bump version to X.Y.Z` commit to `main`.
2. Tag and push:
   ```
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. The tag push triggers the release workflow: `electron-builder` builds an unsigned macOS `.zip`, a `SHA256SUMS` file is generated, and both are attached to the GitHub Release for that tag via `softprops/action-gh-release`.
4. Confirm the release: check the GitHub Release page for `MDV-*.zip` and `SHA256SUMS`.
