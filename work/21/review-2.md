# Review 2

- Reviewed commit: `562e1cce72635cd2988426863a9085815a62cb07`
- Reviewer model: openai/gpt-5
- Verdict: **no-go** (the reviewer answered go)

## Findings

- **blocking** (`worker/src/node.ts:104`) Missing 404 for /node/result and /node/release

  The ticket's decisions note that /node/result and /node/release should return 404 for now, but handleNode only maps /node/heartbeat and /node/claim. This is arguably acceptable because unhandled routes do return 404 via notFound(), but it's not explicit. Non-blocking in behavior, but mentioning to ensure spec intent is met.

- **minor** (`docs/decisions.md:42`) Body validation note for /node/claim conflicts with tests

  Decisions say an empty body on /node/claim is a 400, but nodes send {}. Tests call /node/claim with {} and expect 200 when the queue has items. The implementation correctly accepts {} and returns 200. The decisions entry should clarify that 'empty body' means non-JSON or non-object, while '{}' is valid.

- **minor** (`worker/src/ops.ts:111`) job.enqueued logging omits video_id by design; ensure observability

  Decisions specify logging only a count per request, which is implemented. This may hinder debugging specific IDs; acceptable per spec, but worth noting as an operational tradeoff.

- **minor** (`worker/src/node.ts:62`) Lease selection excludes jobs already tried by node but not explicitly excluding 'leased' in subquery

  The UPDATE WHERE clause filters status='queued', and the subquery also filters j.status='queued'. This aligns with the acceptance criteria that a leased job is not given. It's correct but subtle; a short code comment could emphasize this concurrency intent.

- **minor** (`worker/migrations/0001_init.sql:32`) Index supports ordering; confirm D1 uses it as intended

  Index jobs_claim on (status, priority DESC, created_at, video_id) matches the claim order. Given D1's SQLite basis, this should be used by the UPDATE ... IN (SELECT ... ORDER BY ... LIMIT ...). This is correct but performance should be observed under load.

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

  Added /ops/nodes, /ops/jobs, /ops/jobs/<id>, /node/heartbeat, /node/claim. Node token hashed lookup, auth.bearer.rejected reasons, node.heartbeat, node.enrolled, job.enqueued, job.claimed logs. Claims implemented atomically via single D1 batch with conditional UPDATE and INSERT INTO leases. LEASE_SECONDS fallback to 600. Unspecified /node/result and /node/release are not handled and fall through to 404 as required by the decisions note.

- met: The change is covered by tests that fail without it.

  worker/tests/worker/nodes.test.ts covers node auth (401 cases), heartbeat response and DB update, enqueue behavior (priority, existing IDs), claim behavior (defaults, ordering, leases, tried_nodes exclusion), LEASE_SECONDS override, and concurrent claims with partitioning and no duplicates using real D1 in the worker test project. e2e/tests/claims.api.spec.ts validates two nodes concurrently claim 6 jobs exactly once each. All checks reported as green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Decisions updated on 2026-10-17 to record: handwritten validators mirroring schemas; claim transaction strategy with lease ID prefix and worker-side sorting; LEASE_SECONDS fallback; job.enqueued logging semantics; shared created_at within one request affects order; node token lookup by hash and auth rejection reasons; unimplemented /node/result and /node/release returning 404.

## Proposed learnings (not decided)

- Using a single UPDATE ... RETURNING paired with an INSERT ... SELECT in one D1 batch provides a simple, robust atomic claim mechanism in SQLite/D1.
- Storing only a hash of node tokens and logging minimal data (counts) protects sensitive information without sacrificing essential observability.
- Handwritten lightweight validators can mirror JSON Schemas well enough inside workerd where dynamic code generation (Ajv) is not allowed.
- Stabilizing claim order by explicitly sorting in the worker after a set-based UPDATE helps keep user-observable behavior predictable.
- Prefixing lease IDs within a claim simplifies correlating updated rows for subsequent INSERTs without racing on timestamps.
