#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../worker"

npm ci
# One project after the other, the Workers one first: the contracts test runs `npm ci` through a symlink
# to node_modules, which empties it while another project is starting or running.
npx vitest run --project worker
npx vitest run --project node
