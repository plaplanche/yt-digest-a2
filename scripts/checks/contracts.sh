#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ -x scripts/contracts.sh ]]; then
  ./scripts/contracts.sh --check
else
  echo "no contracts to check yet"
fi
