#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mdv-release-install.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

artifact_path="$(download_latest_release_asset "$WORK_DIR")"
install_release_artifact "$artifact_path" "$WORK_DIR"
