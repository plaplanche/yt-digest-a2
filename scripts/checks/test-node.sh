#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../node"

uv sync --locked
uv run pytest tests/
