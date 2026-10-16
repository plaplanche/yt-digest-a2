2026-10-16: `node/pyproject.toml` pins `requires-python` to 3.12 only and builds with hatchling (src layout); the `lint` check runs `mypy --strict` from `node/` on the whole project (sources and tests).
2026-10-16: `worker/` is an ES module package; ESLint uses `typescript-eslint` recommended rules plus `no-explicit-any` as an error, and `tsc` covers `src/`, `tests/` and `vitest.config.ts` (the JS `eslint.config.js` is left to ESLint).
2026-10-16: The `contracts` check runs `scripts/contracts.sh --check` when that script is executable, and otherwise prints a note and passes.
2026-10-16: The `lint` check collects the shell scripts with `find scripts -name '*.sh'` for shellcheck.
2026-10-16: A `.gitignore` excludes virtualenvs, tool caches and `node_modules/`.
2026-10-16: `worker/tsconfig.json` uses `target` ES2022 and `moduleResolution` Bundler (with `module` ESNext), as Vitest bundles the sources and Node 22 supports ES2022.
2026-10-16: `worker/package.json` sets `engines.node` to `>=22` rather than pinning 22, so newer Node versions work locally while CI runs 22.
2026-10-16: `scripts/contracts.sh` installs its own dependencies (`npm ci` in `worker/`, `uv sync --locked` in `node/`) and calls the locally installed `json2ts` and `datamodel-codegen`, never `npx`, so that it works on a fresh checkout; both generators are dev dependencies.
2026-10-16: The TypeScript types come from `json-schema-to-typescript` and the Pydantic v2 models from `datamodel-code-generator` (formatted with ruff); the generated files are named after the schema (`log-event.ts`, `log_event.py`), and `contracts/__init__.py` holds only the generated-file header.
2026-10-16: The schemas declare their enums as `type: string` with a `$defs` entry (`EventName`, `Source`) so that the generators emit a named union and a `StrEnum`; `source` is that enum or null.
2026-10-16: `attrs` is a free JSON object in the log schema; the per-event attributes of section 4.2 are documented, not validated.
2026-10-16: `--check` also names a committed generated file that the schemas no longer produce, and a generated file that is missing.
2026-10-16: `log.emit` accepts only the fields `request_id`, `video_id` and `attrs` besides `event` and `level` (`ts` and `service` are set by the logger); the TypeScript `log(event, fields, level)` follows the same rule, and keeps a runtime list of events checked at compile time against the generated union.
2026-10-16: Contract tests run `--check` on a temporary copy of the schemas and generated files, reusing the installed `node_modules`, with a 60 s timeout since each run regenerates everything.
2026-10-16: `@types/node` is a dev dependency of `worker/`, for the tests that run `scripts/contracts.sh`.
