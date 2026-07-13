#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${SCRIPT_DIR}/common.sh"

cd "$PROJECT_ROOT"

require_cmd git npm

# Pulling while on another branch would fast-forward that branch onto main, and a
# dirty tree would ship uncommitted code into /Applications under an "updated" banner.
current_branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$current_branch" = "main" ] \
  || fail "On branch '${current_branch}', not main. Switch to main, or use 'npm run install:local' to build what you have."

if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "Working tree has uncommitted changes. Commit or stash them, or use 'npm run install:local'."
fi

info "Updating repository from origin/main"
git pull --ff-only origin main

info "Installing dependencies"
npm install

info "Building unsigned local app"
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build -- --publish=never

install_app_bundle "$(resolve_local_build_path)"
