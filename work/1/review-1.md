# Review 1

- Reviewed commit: `d895d08fcd303d4f5a9ba16791144ab76ecbd383`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`scripts/checks/lint.sh:7`) Possible dependency group ambiguity for uv dev tools

  The script runs `uv sync --locked` before invoking ruff and mypy via `uv run`. If a uv release requires explicit dev group selection, dev-only tools (ruff, mypy, pytest) might not be installed. Consider `uv sync --locked --all-groups` or `--group dev` to make intent explicit. Current CI run is green, so this is non-blocking.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Repository layout matches spec section 2 (node/, worker/, scripts/, ci/jobs.json). Four check scripts implemented per 3.1: scripts/checks/lint.sh (lines 5-19), contracts.sh (lines 5-9), test-node.sh (lines 5-6), test-worker.sh (lines 5-6). CI jobs one per check per 3.2: ci/jobs.json lines 2-5. No contracts or pipeline implemented beyond skeleton; only placeholders in node/src and worker/src.

- met: The change is covered by tests that fail without it.

  Placeholder tests exist in both packages and require the new skeleton code: node/tests/test_placeholder.py asserts importing yt_digest_node (lines 1-5) which relies on node/src/yt_digest_node/__init__.py; worker/tests/placeholder.test.ts (lines 1-6) imports from worker/src/index.ts and checks the exported value. Removing the corresponding package code would make these tests fail.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md lists the chosen details: Python version pin/build system and mypy scope (line 1), worker ESM/ESLint rules and tsconfig coverage (line 2), contracts check behavior when generator absent (line 3), shellcheck file collection method (line 4), .gitignore contents (line 5), tsconfig target/moduleResolution (line 6), Node engines policy (line 7).

## Proposed learnings (not decided)

- Keep check scripts self-contained and explicit about dependency groups to avoid tooling drift across environments.
- Documenting small but impactful defaults (ESM, tsconfig include, engines) in decisions.md prevents confusion later.
- Using uvx for shellcheck ensures only uv is required for all checks, simplifying bootstrap.
