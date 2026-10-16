2026-10-16: `node/pyproject.toml` pins `requires-python` to 3.12 only and builds with hatchling (src layout); the `lint` check runs `mypy --strict` from `node/` on the whole project (sources and tests).
2026-10-16: `worker/` is an ES module package; ESLint uses `typescript-eslint` recommended rules plus `no-explicit-any` as an error, and `tsc` covers `src/`, `tests/` and the config files.
2026-10-16: The `contracts` check runs `scripts/contracts.sh --check` when that script is executable, and otherwise prints a note and passes.
2026-10-16: The `lint` check collects the shell scripts with `find scripts -name '*.sh'` for shellcheck.
2026-10-16: A `.gitignore` excludes virtualenvs, tool caches and `node_modules/`.
