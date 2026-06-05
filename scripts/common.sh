#!/usr/bin/env bash

set -euo pipefail

APP_NAME="MDV.app"
APP_INSTALL_PATH="/Applications/${APP_NAME}"
LOCAL_BUILD_PATH="dist/mac-arm64/${APP_NAME}"
REPO_OWNER="${MDV_REPO_OWNER:-oiysful}"
REPO_NAME="${MDV_REPO_NAME:-MDV}"

info() {
  printf '[MDV] %s\n' "$1" >&2
}

fail() {
  printf '[MDV] ERROR: %s\n' "$1" >&2
  exit 1
}

clear_quarantine() {
  local app_path="$1"
  xattr -dr com.apple.quarantine "$app_path" 2>/dev/null || true
}

install_app_bundle() {
  local source_app_path="$1"

  [ -d "$source_app_path" ] || fail "App bundle not found: ${source_app_path}"

  info "Installing ${APP_NAME} to /Applications"
  rm -rf "$APP_INSTALL_PATH"
  cp -R "$source_app_path" "$APP_INSTALL_PATH"
  clear_quarantine "$APP_INSTALL_PATH"

  info "BUILD SUCCESS"
  info "Installed: ${APP_INSTALL_PATH}"
}

download_latest_release_asset() {
  local destination_dir="$1"
  local tag="${MDV_RELEASE_TAG:-latest}"
  local api_url

  if [ "$tag" = "latest" ]; then
    api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
  else
    api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${tag}"
  fi

  info "Resolving GitHub release asset (${tag})"

  local release_json
  release_json="$(curl -fsSL "$api_url")"

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
)" || fail "No downloadable MDV .dmg or .zip asset found in release ${tag}"

  local filename="${asset_url##*/}"
  local output_path="${destination_dir}/${filename}"
  info "Downloading ${filename}"
  curl -fL "$asset_url" -o "$output_path"
  printf '%s\n' "$output_path"
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
      hdiutil detach "$mount_point" -quiet
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
