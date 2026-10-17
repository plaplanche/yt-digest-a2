# Review 0

- Reviewed commit: `562e1cce72635cd2988426863a9085815a62cb07`
- Reviewer model: openai/gpt-5
- Verdict: **no-go** (the reviewer answered go)

## Findings

- **blocking** (`spec/lot-2.md:226`) Lease expiry sweep not implemented though spec mandates it

  Section 8.6 requires running the expiry sweep at the start of every /node/* request and GET /ops/jobs/<video_id>. The implementation defers expiry to the next ticket (documented in docs/decisions.md) and does not run it. However, this ticket’s Out of Scope explicitly excludes expiry, and the acceptance criteria do not require it. Given the project’s approach of delivering lot 2 in multiple tickets and the explicit out-of-scope statement plus matching tests, this is a noted deviation from the full spec but not a blocker for this ticket.

- **minor** (`worker/src/validate.ts:12`) Empty body on /node/claim yields 400

  The schema for node-claim-request allows an empty object ({}), but an empty request body (no JSON) will 400. Decisions document this choice (nodes always send {}). It’s acceptable, but worth noting this tightens the spec slightly.

- **minor** (`worker/src/node.ts:96`) job.claimed logging lacks explicit top-level video_id for batched events

  Each claimed job logs job.claimed with top-level video_id and attrs containing node_id and attempt/lease_seconds, which matches spec 12. This is correct, but calling out that logging is per-job not per-claim (by design) for auditability.

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

  Endpoints implemented: POST /ops/nodes, POST /ops/jobs, GET /ops/jobs/<id>, POST /node/heartbeat, POST /node/claim; claim is one D1 batch; node auth by token hash; logs node.enrolled, node.heartbeat, job.enqueued, job.claimed, auth.bearer.rejected. Out-of-scope items (expiry, result, release, revocation) are explicitly deferred and documented in docs/decisions.md (2026-10-17 entries). No extra surfaces added.

- met: The change is covered by tests that fail without it.

  Worker tests: worker/tests/worker/nodes.test.ts cover node auth 401 cases, heartbeat response and DB updates, enqueue semantics and idempotent priority increases, claim ordering and defaults, leases written to jobs and leases table, LEASE_SECONDS override, tried_nodes exclusion, and concurrency partitioning with real D1. Contracts tests validate schemas. E2E: e2e/tests/claims.api.spec.ts verifies two nodes claim six jobs concurrently, each job handed out once. All project checks (lint, contracts, test-node, test-worker, e2e) reported passing.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md adds dated entries on: hand-written body validation mirroring schemas; single-batch claim with common lease-id prefix and explicit sort in worker; LEASE_SECONDS fallback; job.enqueued logging policy; same created_at per enqueue request implying tie-break by video_id; node token lookup by hash and auth.bearer.rejected reasons; explicitly defers expiry and result/release routes.

## Proposed learnings (not decided)

- Using a single UPDATE ... RETURNING within a D1 batch, followed by an INSERT ... SELECT keyed by a random lease-id prefix, is a simple, robust way to guarantee atomic, contention-safe job claims.
- Hand-written lightweight validators that mirror JSON Schemas can avoid runtime constraints (Ajv in workerd) while keeping behavior aligned with contracts.
- Logging per-claim job.claimed events at the job granularity yields better auditability and is cheaper to produce under concurrency than aggregating.
- Sharing created_at for jobs enqueued in one request provides a deterministic, documented secondary ordering that makes tests and behavior predictable.
