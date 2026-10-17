# Checks

Replayed by Ariane on commit `7adcb34e095294831e2d336a8c703fc3300428de`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 20.4 s |
| contracts | yes | pass | 14.6 s |
| test-node | yes | pass | 50.0 s |
| test-worker | yes | pass | 59.6 s |
| e2e | yes | pass | 22.6 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 20.4 s)

```text
(48 earlier lines omitted)

added 209 packages, and audited 210 packages in 8s

69 packages are looking for funding
  run `npm fund` for details

5 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

added 104 packages, and audited 105 packages in 2s

30 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 14.6 s)

```text
== contracts
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 50.0 s)

```text
(3 earlier lines omitted)
Checked 32 packages in 0.37ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a2.ariane/worktrees/23-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 104 items

tests/test_cli.py ........                                               [  7%]
tests/test_contracts.py ..............                                   [ 21%]
tests/test_extractors.py ...............                                 [ 35%]
tests/test_log.py .....                                                  [ 40%]
tests/test_node_protocol.py ...................................          [ 74%]
tests/test_paging.py ......                                              [ 79%]
tests/test_placeholder.py .                                              [ 80%]
tests/test_sponsorblock.py .........                                     [ 89%]
tests/test_vtt.py ...........                                            [100%]

============================= 104 passed in 49.17s =============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 59.6 s)

```text
(32 earlier lines omitted)

[33m▲ [43;33m[[43;30mWARNING[43;33m][0m [1mProxy environment variables detected. We'll use your proxy for fetch requests.[0m



=======================================================================================
WARNING: @cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin.
This package will not receive future updates.
Run `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin` to migrate.
=======================================================================================


 RUN  v4.1.12 /home/user/yt-digest-a2.ariane/worktrees/23-replay/worker


 Test Files  3 passed (3)
      Tests  43 passed (43)
   Start at  00:47:32
   Duration  43.88s (transform 143ms, setup 0ms, import 277ms, tests 43.75s, environment 0ms)
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 22.6 s)

```text
(40 earlier lines omitted)
Error: Download failure, code=1
    at ChildProcess.<anonymous> (/home/user/yt-digest-a2.ariane/worktrees/23-replay/e2e/node_modules/playwright-core/lib/coreBundle.js:33774:32)
    at ChildProcess.emit (node:events:519:28)
    at ChildProcess._handle.onexit (node:internal/child_process:293:12)
e2e: chromium unavailable, browser project skipped
stack: ready http://127.0.0.1:8787

Running 9 tests using 1 worker

  ✓  1 [api] › tests/claims.api.spec.ts:11:1 › 2 nodes claiming 6 jobs concurrently get each job once (270ms)
  ✓  2 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (12ms)
  ✓  3 [api] › tests/health.api.spec.ts:11:1 › the mocks server answers /health (8ms)
  ✓  4 [api] › tests/health.api.spec.ts:17:1 › SponsorBlock has no segment for any video (14ms)
  ✓  5 [api] › tests/leases.api.spec.ts:28:1 › E2E-13 (reduced): the 6 jobs claimed concurrently all end done (269ms)
  ✓  6 [api] › tests/leases.api.spec.ts:41:1 › E2E-14: an expired lease goes to another node and the late result gets 409 (2.6s)
  ✓  7 [api] › tests/leases.api.spec.ts:56:1 › E2E-16 (reduced): unavailable on 3 nodes gives failed_video and a 4th node gets nothing (197ms)
  ✓  8 [api] › tests/leases.api.spec.ts:68:1 › E2E-20: a revoked node is refused and its job reassigned (138ms)
  ✓  9 [api] › tests/leases.api.spec.ts:81:1 › E2E-21: /node/* responses hold no user data (131ms)

  9 passed (4.6s)
```

Summary: 5 passed, 0 failed (0 blocking).
