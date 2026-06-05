#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/common.sh"

cd "$PROJECT_ROOT"

info "Installing dependencies"
npm install

info "Building unsigned local app"
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build -- --publish=never

install_app_bundle "$LOCAL_BUILD_PATH"
