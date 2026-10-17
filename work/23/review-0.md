# Review 0

- Reviewed commit: `7adcb34e095294831e2d336a8c703fc3300428de`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/lease.ts:147`) Idempotent result retry can race to 409 if response_json not yet stored

  In result(), if a concurrent call has already completed the lease but has not yet persisted response_json, this branch returns 409 stale_lease (state !== 'active') instead of the stored 200. The loop retries only after a failed conditional UPDATE, not on this path. This contradicts the decision note about 're-reads the lease once so a concurrent retry gets the stored response'. Consider a single re-read/short retry when state !== 'active' and response_json is null, or atomically setting response_json with the state transition.

- **minor** (`worker/src/lease.ts:160`) R2 write-before-complete can leave orphan transcript on edge expiry race

  For outcome 'ok', the transcript is written to R2 before completing the lease. If the lease expires exactly then and sweepExpired wins the arbiter, the job is requeued/failed but the object remains in R2. This ordering matches the documented decision, but leaves a residual risk of orphaned objects on edge races.

- **minor** (`worker/src/lease.ts:182`) Log event naming: 'job.completed' used for non-terminal outcomes

  The code logs job.completed even when outcomes are 'unavailable'/'blocked'/'error' and the job stays queued. If section 12 intended 'completed' only for terminal outcomes, this may be confusing. If this is deliberate, consider a short decisions.md note clarifying the intent.

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

  Implemented POST /node/result and /node/release with 8.4–8.7 flow (worker/src/lease.ts), expiry sweep 8.6 invoked across node and ops handlers (worker/src/node.ts lines 50, 69; worker/src/ops.ts line 117), node revocation via DELETE /ops/nodes/<id> (worker/src/ops.ts lines 128–140) and lease revocation (worker/src/lease.ts lines 73–83), GET /ops/transcripts/<video_id> (worker/src/ops.ts lines 142–153). Added required log events (worker/src/log.ts) and node_events kinds (migrations/0001_init.sql).

- met: The change is covered by tests that fail without it.

  Worker tests in worker/tests/worker/leases.test.ts cover ok storing in R2, idempotent retries, validation 422s, expiry at boundary, release idempotence, and revocation flows. E2E tests in e2e/tests/leases.api.spec.ts implement E2E-13 (reduced), E2E-14, E2E-16 (reduced), E2E-20 and E2E-21. All checks reported green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md lines 47–52 document authentication reasons, lease-ending arbitration, keeping leased_by/lease_id on done, R2 write ordering and no node event on revoke, validation error messaging policy, and word counting rules.

## Proposed learnings (not decided)

- Using the leases table as the single arbiter with a conditional UPDATE is a simple, effective pattern to serialize lease conclusions across competing requests.
- Persisting the node ACK in the lease row (response_json) is a practical way to achieve idempotent retries for nodes without exposing job state.
- Sweeping expiries opportunistically at relevant endpoints keeps the system responsive without a dedicated scheduler.
- Documenting validation messages as fixed, non-user-data-bearing strings helps ensure PII-safe logs and responses.
