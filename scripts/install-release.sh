#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${SCRIPT_DIR}/common.sh"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mdv-release-install.XXXXXX")"

cleanup() {
  detach_if_mounted "${WORK_DIR}/mount"
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

artifact_path="$(download_latest_release_asset "$WORK_DIR")"
install_release_artifact "$artifact_path" "$WORK_DIR"
