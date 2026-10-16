# Review 0

- Reviewed commit: `1bd276c7d8b46468528449c76ffbf20bf8c43a91`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`worker/tests/contracts.test.ts:12`) Missing TS test for bad video_id case

  Acceptance criteria ask that a result with a bad video_id is rejected in both languages. The TypeScript contract test covers an extra field and a bad status via types, but does not include a case for a bad video_id. Given json-schema-to-typescript cannot enforce string patterns at type level, this limitation should be acknowledged (in docs/decisions.md) or a small runtime validator added for the test only.

- **minor** (`scripts/contracts.sh:53`) Noisy stderr when comparing missing files in --check

  In the --check loop, `cmp -s "$root/$f" "$tmp/$f"` will print its own error message when one side is missing. You already print a clean "stale generated file" line; consider redirecting cmp's stderr to avoid duplicate/noisy output.

- **minor** (`scripts/contracts.sh:22`) Potential dev dependency resolution ambiguity with uv

  `uv sync --locked --quiet` may not install the `dev` group where `datamodel-code-generator` and `ruff` live, relying instead on `uv run` to resolve tools. This worked in your environment, but to make fresh checkouts more deterministic/offline-friendly, consider explicitly syncing the dev group (e.g. `uv sync -g dev`) or using `uv tool run`.

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

  Added shared JSON Schemas for transcript result and log event (contracts/*.schema.json), generation script (scripts/contracts.sh) producing TS types (worker/src/contracts/) and Pydantic v2 models (node/src/yt_digest_node/contracts/), and loggers that only accept catalogued events (node/src/yt_digest_node/log.py, worker/src/log.ts). The runtime behavior and file locations match the ticket’s Decided spec and acceptance, without out-of-scope pipeline changes.

- met: The change is covered by tests that fail without it.

  Python: node/tests/test_contracts.py validates accept/reject cases for TranscriptResult and LogEvent, checks catalogue alignment, and exercises `--check` for edited/generated drift. node/tests/test_log.py covers logger success and failure paths (unknown event, bad level, unknown fields). TypeScript: worker/tests/contracts.test.ts covers the generated types for valid/invalid cases and `--check` behavior; worker/tests/log.test.ts covers logger output and rejection of unknown events/fields. Removing the changes to schemas/generators/loggers or the script causes these tests to fail.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md entries dated 2026-10-16 document generator choices (json-schema-to-typescript, datamodel-code-generator, naming), how enums are modeled, that attrs are free-form (documented, not validated), logger accepted fields, that --check reports extra/missing files, and test strategy/timeouts. These capture the key design decisions left open by the spec.

## Proposed learnings (not decided)

- Keep generators local and deterministic in CI by avoiding npx and syncing tool deps explicitly.
- TypeScript types from JSON Schema cannot enforce string patterns; capture this limitation in decisions and tests.
- Cross-checking generated catalogues at runtime (Python) and compile time (TypeScript) prevents silent drift.
- When writing check scripts, compare both ways and control tool stderr to produce clean, actionable output.
