# Review 0

- Reviewed commit: `d14a817f8fc1f5ee41fe725c95ae9278f73daace`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`worker/package-lock.json:1`) Wrangler version drift vs. decisions note

  The lockfile resolves wrangler to 4.151.1 in addition to 4.124.0 via transitive deps. Decisions mention using the newest compatibility_date the installed workerd supports, which is fine, but the presence of multiple wrangler/workerd versions may cause confusion. Not blocking; tests use Miniflare’s bundled workerd and pass.

- **minor** (`worker/src/ops.ts:30`) Constant-time comparison approach not documented

  Authentication uses a hash-then-compare strategy for constant-time equality. It’s a reasonable choice given token lengths, but this implementation decision isn’t explicitly recorded in docs/decisions.md. Not blocking.

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

  Routes implemented: GET /health and /ops/* only (worker/src/index.ts:8-12). /health returns {status:"ok", version} per spec 6.2 (spec/lot-2.md:150-153; worker/src/index.ts:9). Unknown routes/methods 404 not_found (worker/src/http.ts:12; tests worker/tests/worker/worker.test.ts:58-69). Operator auth matches section 7 (spec/lot-2.md:177-183; worker/src/ops.ts). No extra routes beyond ticket scope.

- met: The change is covered by tests that fail without it.

  Worker tests use real Miniflare D1/R2 with migrations applied (worker/vitest.config.ts:9-18, tests/worker/setup.ts:1-4). Tests cover: migrations columns (worker/tests/worker/worker.test.ts:40-47), /health response (lines 49-56), 404 shape for unknown routes/methods (lines 58-69), operator auth behaviors incl. 404 when OPS_TOKEN empty and 401 for missing/wrong bearer (lines 71-101), and POST /ops/reset empties all tables and R2 under transcripts/ (lines 104-134).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Decisions added for test projects order and real Miniflare (docs/decisions.md:32-33), compatibility_date and placeholder D1 id (line 34), manual error-body checks due to Ajv codegen limits (line 35), migration CHECK constraints and indexes (line 36), auth failure logging (line 37), and dependency/tooling adjustments (lines 31-33).

## Proposed learnings (not decided)

- Using @cloudflare/vitest-pool-workers with readD1Migrations/applyD1Migrations provides a clean, realistic D1/R2 testing setup with minimal harness code.
- Hash-then-compare is a practical constant-time equality pattern in Workers where subtle crypto is available and token sizes are bounded.
- Paginating R2 deletions validates real-world cleanup logic; including >1000 keys in tests helps catch pagination oversights.
- Keeping HTTP error-body shape checks decoupled from Ajv allows Worker tests to run under workerd without eval-capable codegen.
