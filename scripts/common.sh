#!/usr/bin/env bash

set -euo pipefail

APP_NAME="MDV.app"
APP_INSTALL_PATH="/Applications/${APP_NAME}"
REPO_OWNER="${MDV_REPO_OWNER:-oiysful}"
REPO_NAME="${MDV_REPO_NAME:-MDV}"

info() {
  printf '[MDV] %s\n' "$*" >&2
}

fail() {
  printf '[MDV] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found on PATH: ${cmd}"
  done
}

clear_quarantine() {
  local app_path="$1"
  xattr -dr com.apple.quarantine "$app_path" 2>/dev/null || true
}

# electron-builder only adds an arch suffix when the arch differs from its x64
# default, so an Intel build lands in dist/mac while Apple Silicon gets mac-arm64.
resolve_local_build_path() {
  local candidate
  for candidate in "dist/mac-$(uname -m)" dist/mac-universal dist/mac dist/mac-arm64 dist/mac-x64; do
    if [ -d "${candidate}/${APP_NAME}" ]; then
      printf '%s\n' "${candidate}/${APP_NAME}"
      return 0
    fi
  done
  fail "No built ${APP_NAME} found under dist/ (looked for mac-$(uname -m), mac-universal, mac)"
}

app_is_running() {
  pgrep -f "${APP_INSTALL_PATH}/Contents/MacOS/" >/dev/null 2>&1
}

# Stage the new bundle beside the target, then swap it in, so a failed copy can
# never leave the user without a working /Applications/MDV.app.
install_app_bundle() {
  local source_app_path="$1"
  local staging_dir backup_path

  [ -d "$source_app_path" ] || fail "App bundle not found: ${source_app_path}"
  [ -f "${source_app_path}/Contents/Info.plist" ] \
    || fail "Not an app bundle (no Contents/Info.plist): ${source_app_path}"

  if app_is_running; then
    fail "${APP_NAME} is currently running. Quit it and re-run this command."
  fi

  info "Installing ${APP_NAME} to /Applications"

  staging_dir="$(mktemp -d /Applications/.mdv-install.XXXXXX)" \
    || fail "/Applications is not writable"
  backup_path="${APP_INSTALL_PATH}.backup-$$"

  if ! cp -R "$source_app_path" "${staging_dir}/${APP_NAME}"; then
    rm -rf "$staging_dir"
    fail "Copy failed; the existing ${APP_NAME} was left untouched."
  fi
  clear_quarantine "${staging_dir}/${APP_NAME}"

  if [ -e "$APP_INSTALL_PATH" ]; then
    if ! mv "$APP_INSTALL_PATH" "$backup_path"; then
      rm -rf "$staging_dir"
      fail "Could not move the existing ${APP_NAME} aside."
    fi
  fi

  if ! mv "${staging_dir}/${APP_NAME}" "$APP_INSTALL_PATH"; then
    [ -e "$backup_path" ] && mv "$backup_path" "$APP_INSTALL_PATH"
    rm -rf "$staging_dir"
    fail "Install failed; the previous ${APP_NAME} has been restored."
  fi

  rm -rf "$staging_dir" "$backup_path"

  info "BUILD SUCCESS"
  info "Installed: ${APP_INSTALL_PATH}"
}

verify_checksum() {
  local artifact_path="$1"
  local sums_url="$2"
  local filename="${artifact_path##*/}"
  local sums expected actual

  if ! sums="$(curl -fsSL --proto '=https' "$sums_url" 2>/dev/null)"; then
    info "WARNING: release has no SHA256SUMS asset; skipping integrity check."
    return 0
  fi

  expected="$(printf '%s\n' "$sums" | awk -v f="$filename" '$2 == f || $2 == "*"f { print $1 }')"
  [ -n "$expected" ] || fail "SHA256SUMS has no entry for ${filename}"

  actual="$(shasum -a 256 "$artifact_path" | awk '{ print $1 }')"
  [ "$expected" = "$actual" ] || fail "Checksum mismatch for ${filename} (download corrupt or tampered)"

  info "Checksum OK"
}

download_latest_release_asset() {
  local destination_dir="$1"
  local tag="${MDV_RELEASE_TAG:-latest}"
  local api_url

  require_cmd curl node shasum

  if [ "$tag" = "latest" ]; then
    api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
  else
    api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${tag}"
  fi

  info "Resolving GitHub release asset (${tag})"

  local release_json
  release_json="$(curl -fsSL --proto '=https' "$api_url")" \
    || fail "GitHub API request failed (${api_url}). Bad tag, no network, or rate limited (60 req/hr unauthenticated)."

  local asset_url
  asset_url="$(RELEASE_JSON="$release_json" node <<'NODE'
const release = JSON.parse(process.env.RELEASE_JSON || '{}')
const assets = Array.isArray(release.assets) ? release.assets : []
const preferred = assets.find(asset => /MDV.*arm64.*\.dmg$/i.test(asset.name))
  || assets.find(asset => /MDV.*\.dmg$/i.test(asset.name))
  || assets.find(asset => /MDV.*arm64.*\.zip$/i.test(asset.name))
  || assets.find(asset => /MDV.*\.zip$/i.test(asset.name))

if (!preferred) process.exit(1)
process.stdout.write(preferred.browser_download_url)
NODE
)" || fail "Release ${tag} ships no MDV .dmg or .zip asset. Releases must have a built artifact attached; see README."

  local filename="${asset_url##*/}"
  local output_path="${destination_dir}/${filename}"
  info "Downloading ${filename}"
  curl -fL --retry 3 --proto '=https' "$asset_url" -o "$output_path" \
    || fail "Download failed: ${asset_url}"

  verify_checksum "$output_path" "${asset_url%/*}/SHA256SUMS"

  printf '%s\n' "$output_path"
}

detach_if_mounted() {
  local mount_point="$1"
  if mount | grep -q " ${mount_point} "; then
    hdiutil detach "$mount_point" -force -quiet || true
  fi
}

install_release_artifact() {
  local artifact_path="$1"
  local work_dir="$2"

  case "$artifact_path" in
    *.dmg)
      local mount_point="${work_dir}/mount"
      mkdir -p "$mount_point"
      info "Mounting ${artifact_path##*/}"
      hdiutil attach "$artifact_path" -mountpoint "$mount_point" -nobrowse -quiet
      install_app_bundle "${mount_point}/${APP_NAME}"
      info "Unmounting release image"
      detach_if_mounted "$mount_point"
      ;;
    *.zip)
      local unzip_dir="${work_dir}/unzipped"
      mkdir -p "$unzip_dir"
      info "Extracting ${artifact_path##*/}"
      unzip -q "$artifact_path" -d "$unzip_dir"
      install_app_bundle "${unzip_dir}/${APP_NAME}"
      ;;
    *)
      fail "Unsupported release artifact: ${artifact_path}"
      ;;
  esac
}
