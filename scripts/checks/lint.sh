#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

(
  cd node
  uv sync --locked
  uv run ruff check .
  uv run ruff format --check .
  uv run mypy --strict .
)
(
  cd worker
  npm ci
  npx tsc --noEmit
  npx eslint .
)
mapfile -d '' scripts < <(find scripts -name '*.sh' -print0)
uvx --from shellcheck-py shellcheck "${scripts[@]}"
