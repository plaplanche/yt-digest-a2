# Review 0

- Reviewed commit: `28a0461437fd42d6009af9c11164d4b8459655fe`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`scripts/stack.sh:32`) File descriptor left open in port check

  The port_taken() helper opens FD 3 with 'exec 3<>/dev/tcp/…' and never closes it. It’s harmless here (called twice) but can be tidied by closing FD 3 afterwards (e.g. 'exec 3>&-') to avoid descriptor leaks if this grows.

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

  Stack lifecycle matches 5.1: down first, install deps if node_modules missing, reset .stack/state, apply D1, start mocks+wrangler, readiness on both /health, logs truncated, process-group control (scripts/stack.sh:15-29,41-96). Configuration of 5.2 passed via --var and env (scripts/stack.sh:66-80). Mocks server serves only /health and SponsorBlock 404 per ticket scope (e2e/mocks/server.ts:12-18). Playwright setup with api and browser projects and single worker (e2e/playwright.config.ts:6-14). CI job added (ci/jobs.json:+e2e). Lint extended to e2e (scripts/checks/lint.sh:15-21). No extra routes or behaviors beyond the ticket.

- met: The change is covered by tests that fail without it.

  End-to-end tests validate Worker /health and mocks /health and SponsorBlock 404 (e2e/tests/health.api.spec.ts:5-20). The e2e check starts the stack and runs Playwright (scripts/checks/e2e.sh:22-27). Without the new stack script and mocks server, these tests would fail to reach the endpoints.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Decisions added: process-group mgmt with setsid and TERM/KILL timing (docs/decisions.md:38), port probing via TCP connect after stopping stack (line 39), Playwright project selection by filename and single worker (line 40), artifact collection on Playwright failure (line 41).

## Proposed learnings (not decided)

- Using setsid and killing process groups makes local stack teardown robust against child processes.
- Gate browser e2e by opportunistic Chromium install to keep e2e useful in headless/container environments.
- Selecting Playwright projects by filename patterns keeps config simple and discoverable.
- Health-based readiness checks across all services prevent flaky e2e start conditions.
