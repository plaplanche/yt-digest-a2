# Review 0

- Reviewed commit: `327baf0c53acae82e6da4bb5e2229c8198311650`
- Reviewer model: openai/gpt-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`spec/lot-2.md:92`) Node does not validate every response it reads

  Spec 4.4 requires: "the node validates every response it reads" and the ticket adds "reusing ... the generated contracts ... for every request and response." In code, only the claim response is validated (`NodeClaimResponse.model_validate_json`). Heartbeat and result/release responses are not validated against their schemas. See `node/src/yt_digest_node/daemon.py` line 88 (heartbeat result ignored) and lines 118-131 (result/release sent via `_send` and response ignored). `node/src/yt_digest_node/worker_client.py` line 80 only `json.loads` the payload but does not validate against generated models. This violates the spec requirement.

- **minor** (`node/src/yt_digest_node/worker_client.py:80`) JSON parsed but discarded; no schema-level guardrail

  The client ensures payload is JSON (`json.loads(payload or b"null")`) but discards the parsed object and returns raw bytes. While functionally sufficient for current callers, keeping only a parse check silently accepts shape drift. Validating to the generated Pydantic response models (e.g., `NodeHeartbeatResponse`, `NodeJobAck`) would make deviations fail fast and align with spec 4.4.

- **minor** (`docs/decisions.md:53`) Decisions capture open choices; consider noting response validation scope

  You documented client tech, retry logging, serialization, loop behavior, exit codes, and signal handling. Given the spec’s explicit requirement to validate every response, a short line confirming that all `/node/*` responses are validated with generated models would remove ambiguity and set an expectation for future changes.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Spec 4.4 mandates validating every response; only `/node/claim` is validated (`node/src/yt_digest_node/daemon.py` lines 91-95). Heartbeat and result/release responses are not validated (`daemon.py` line 88, lines 118-131; `worker_client.py` line 80 only parses JSON).

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: check e2e passes

  Replayed by Ariane: exit 0.

- **not met**: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Spec 4.4 mandates validating every response; only `/node/claim` is validated (`node/src/yt_digest_node/daemon.py` lines 91-95). Heartbeat and result/release responses are not validated (`daemon.py` line 88, lines 118-131; `worker_client.py` line 80 only parses JSON).

- met: The change is covered by tests that fail without it.

  Unit tests in `node/tests/test_daemon.py` cover heartbeats, claims, result outcomes, retries (503), non-retries (409), exit codes (1/2), signals releasing leases, and log safety. The e2e test `e2e/tests/daemon.api.spec.ts` validates end-to-end processing and transcript retrieval. These would fail if the daemon behavior were removed or regressed.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  New entries on 2026-10-17 document urllib usage and retry logging, heartbeat timing policy, request serialization (`exclude_unset`), loop vs `--once` failure semantics, config validation and exit codes, and honoring SIGTERM/SIGINT including `--once` (`docs/decisions.md` lines 53-57).

## Proposed learnings (not decided)

- When a spec requires contract validation on both requests and responses, enforce it uniformly even when the response is not currently used; it prevents silent drift.
- Emit a log event for each retry attempt to make flaky network conditions observable without extra instrumentation.
- Keep stdout and stderr roles strict in CLIs: operational logs as structured JSON on stderr, human-facing errors on stdout when required by tests/spec.
