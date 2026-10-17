# Review 1

- Reviewed commit: `ee4443b4cc71d6f914c6f3756377ee26cd49fb2b`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/daemon.py:84`) Heartbeat timestamp set before successful send

  In _heartbeat, _last_heartbeat is updated before the POST is attempted. If the heartbeat call fails (e.g., network error/5xx), the next cycle within HEARTBEAT_SECONDS will skip sending another heartbeat, potentially delaying the next successful heartbeat. Setting the timestamp after a successful call would keep heartbeats strictly periodic. This is documented as an accepted choice (decisions.md 2026-10-17), so not blocking.

- **minor** (`node/tests/test_daemon.py:283`) No explicit test for SIGINT/SIGTERM handling in --once mode

  docs/decisions.md states SIGTERM/SIGINT are honored by --once, but tests cover signal handling only in loop mode (test_sigterm_releases_unstarted_jobs) and not explicitly for --once. Not required by acceptance criteria, but adding a focused --once signal test would lock this behavior down.

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

- met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Implements yt-digest-node work [--once] using lot 1 pipeline and generated contracts (cli.py lines 56-66; daemon.py; worker_client.py). Logs worker.call per request (worker_client.py lines 91-98). Behavior matches spec 9 and 8: heartbeats, claim with max_jobs, result/release posting, retries per 9. Retries and validation align with 9 and decisions. No unrelated scope added.

- met: The change is covered by tests that fail without it.

  Unit tests node/tests/test_daemon.py cover: heartbeat/claim/results including outcomes and transcript (lines ~283-, 305-), pipeline exception → error (test_pipeline_exception_sends_error), 503 retried then 200 (test_result_503_is_retried), 409 not retried (test_result_409_is_not_retried), failed claim/heartbeat exit 1, missing vars exit 2, SIGTERM releases unstarted jobs, stderr JSON-only and no token. E2E test e2e/tests/daemon.api.spec.ts validates end-to-end processing and stored transcript.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md 2026-10-17 entries document: urllib usage and worker.call per attempt; heartbeat scheduling; exclude_unset serialization; loop failure handling vs --once; exit code 2 and stdout for bad settings; honoring SIGTERM/SIGINT in --once; response validation and non-retry on validation failure (lines 53-58).

## Proposed learnings (not decided)

- Validate all /node/* responses against generated models and treat validation failures as non-retryable to avoid retry loops on bad servers.
- Log one worker.call per network attempt to make retries observable and debuggable.
- Keep stderr strictly JSON logs and route human-readable errors to stdout to simplify test assertions and log ingestion.
- Decouple retry policy from business flow by centralizing it in a small client wrapper with injectable sleep for testability.
