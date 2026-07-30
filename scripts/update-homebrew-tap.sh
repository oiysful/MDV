#!/usr/bin/env bash

set -euo pipefail

VERSION="${1:?Usage: update-homebrew-tap.sh <version> <sha256>}"
SHA256="${2:?Usage: update-homebrew-tap.sh <version> <sha256>}"

TAP_REPO="${HOMEBREW_TAP_REPO:-oiysful/homebrew-tap}"
TAP_TOKEN="${HOMEBREW_TAP_TOKEN:-}"

if [ -z "$TAP_TOKEN" ]; then
  echo "[update-homebrew-tap] HOMEBREW_TAP_TOKEN not set; skipping tap update." >&2
  exit 0
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

git clone --depth 1 "https://x-access-token:${TAP_TOKEN}@github.com/${TAP_REPO}.git" "$WORK_DIR"

CASK_FILE="${WORK_DIR}/Casks/mdv.rb"
[ -f "$CASK_FILE" ] || { echo "[update-homebrew-tap] Cask file not found: ${CASK_FILE}" >&2; exit 1; }

sed -i '' -e "s/^  version \".*\"/  version \"${VERSION}\"/" "$CASK_FILE"
sed -i '' -e "s/^  sha256 \".*\"/  sha256 \"${SHA256}\"/" "$CASK_FILE"

cd "$WORK_DIR"
if git diff --quiet; then
  echo "[update-homebrew-tap] Casks/mdv.rb already up to date; nothing to push."
  exit 0
fi

git config user.name "mdv-release-bot"
git config user.email "actions@github.com"
git add Casks/mdv.rb
git commit -q -m "mdv ${VERSION}"
git push origin HEAD:main
echo "[update-homebrew-tap] Updated ${TAP_REPO} to mdv ${VERSION}"
