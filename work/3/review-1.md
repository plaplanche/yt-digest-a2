# Review 1

- Reviewed commit: `36d2feb247d7032cf4b5c7c07bfca9a1794c790b`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/log.py:10`) Level passed via kwargs overrides early enum cast

  emit(event, level="info", **fields) casts the positional level via Level(level) but then spreads **fields after, allowing a 'level' key in kwargs to overwrite it. Validation is still enforced by the Pydantic model, and tests assert ValueError on bad levels, but the early cast is effectively bypassed when 'level' is provided in kwargs. Behavior matches tests and spec, but the code path is a little surprising.

- **minor** (`scripts/contracts.sh:52`) Generated directories fully rewritten

  The script removes and recreates worker/src/contracts and node/src/yt_digest_node/contracts on each run. This is documented in docs/decisions.md and consistent with the spec, but it is destructive if non-generated files were ever added to those directories by mistake.

- **minor** (`docs/decisions.md:11`) Service–event mapping choice not explicitly recorded

  Spec 4.2 lists which service emits each event. The implementation does not enforce a per-event service constraint in schemas or loggers (only the catalogue and 'service' values are enforced). Consider adding a decisions.md note that this mapping is not validated at runtime or in schemas in lot 1.

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

  Added JSON Schemas (contracts/*.schema.json) match 4.1 and 4.2; generation script scripts/contracts.sh with --check per 4.3; generated TS types and Python Pydantic v2 models under worker/src/contracts/ and node/src/yt_digest_node/contracts/; TS catalogue union and LOG_EVENTS emitted (worker/src/contracts/log-events.ts); loggers implemented as specified (node/src/yt_digest_node/log.py writes to stderr and validates; worker/src/log.ts writes to console.log, enforces catalogue). No edits to spec/ or .github/workflows/.

- met: The change is covered by tests that fail without it.

  Python tests (node/tests/test_contracts.py) validate: accepting valid TranscriptResult and LogEvent; rejecting extra fields, bad video_id/status/sponsor_ratio; logger emit writes one line and raises on unknown event/field/level; contracts --check fails and names stale files (hand edit and schema change). TypeScript tests (worker/tests/contracts.test.ts) validate: Ajv acceptance/rejection of valid/invalid result and log line; logger throws on non-catalogued event and unknown field; logger writes one valid line. Removing generation/loggers or relaxing validation causes these to fail.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md records generator tools and locking (line 9), directory rewrite and emitted files including log-events.ts and StrEnum (line 10), free-form attrs and logger field behavior and TS stdout (line 11), tsconfig resolveJsonModule for tests (line 8).

## Proposed learnings (not decided)

- Generate both a runtime catalogue (const array) and a union type from the schema to keep TS compile-time and runtime checks in sync.
- Using Pydantic v2 models for log/event validation gives strict runtime guarantees with minimal code in Python.
- A dedicated --check mode that regenerates into a temp dir and diffs is a robust way to detect stale generated artifacts across languages.
- Allowing free-form attrs in the log schema keeps lot 1 simple while still enforcing the common envelope; document such choices explicitly.
