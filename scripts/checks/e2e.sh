#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
root=$PWD

(cd e2e && npm ci)

projects=()
if [[ -n "${CI:-}" ]]; then
  (cd e2e && npx playwright install --with-deps chromium)
elif ! (cd e2e && timeout 120 npx playwright install chromium); then
  echo "e2e: chromium unavailable, browser project skipped"
  projects=(--project api)
fi

collect_artifacts() {
  mkdir -p ci-artifacts
  cp -r .stack/logs ci-artifacts/ 2>/dev/null || true
  cp -r e2e/playwright-report ci-artifacts/ 2>/dev/null || true
}

trap '"$root/scripts/stack.sh" down' EXIT
LEASE_SECONDS=2 ./scripts/stack.sh up
if ! (cd e2e && npx playwright test "${projects[@]}"); then
  collect_artifacts
  exit 1
fi
