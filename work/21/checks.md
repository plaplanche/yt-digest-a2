# Checks

Replayed by Ariane on commit `562e1cce72635cd2988426863a9085815a62cb07`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 19.6 s |
| contracts | yes | pass | 15.2 s |
| test-node | yes | pass | 52.0 s |
| test-worker | yes | pass | 65.3 s |
| e2e | yes | pass | 19.4 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 19.6 s)

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
- Result: passed (exit 0, 15.2 s)

```text
== contracts
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 52.0 s)

```text
(3 earlier lines omitted)
Checked 32 packages in 0.50ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a2.ariane/worktrees/21-replay/node
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

============================= 104 passed in 51.19s =============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 65.3 s)

```text
(32 earlier lines omitted)

[33m▲ [43;33m[[43;30mWARNING[43;33m][0m [1mProxy environment variables detected. We'll use your proxy for fetch requests.[0m



=======================================================================================
WARNING: @cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin.
This package will not receive future updates.
Run `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin` to migrate.
=======================================================================================


 RUN  v4.1.12 /home/user/yt-digest-a2.ariane/worktrees/21-replay/worker


 Test Files  3 passed (3)
      Tests  43 passed (43)
   Start at  00:33:34
   Duration  47.65s (transform 183ms, setup 0ms, import 345ms, tests 47.50s, environment 0ms)
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 19.4 s)

```text
(35 earlier lines omitted)
    at IncomingMessage.emit (node:events:531:35)
    at endReadableNT (node:internal/streams/readable:1698:12)
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)
Failed to install browsers
Error: Failed to download Chrome for Testing 156.0.8078.4 (playwright chromium v1248), caused by
Error: Download failure, code=1
    at ChildProcess.<anonymous> (/home/user/yt-digest-a2.ariane/worktrees/21-replay/e2e/node_modules/playwright-core/lib/coreBundle.js:33774:32)
    at ChildProcess.emit (node:events:519:28)
    at ChildProcess._handle.onexit (node:internal/child_process:293:12)
e2e: chromium unavailable, browser project skipped
stack: ready http://127.0.0.1:8787

Running 4 tests using 1 worker

  ✓  1 [api] › tests/claims.api.spec.ts:11:1 › 2 nodes claiming 6 jobs concurrently get each job once (262ms)
  ✓  2 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (13ms)
  ✓  3 [api] › tests/health.api.spec.ts:11:1 › the mocks server answers /health (8ms)
  ✓  4 [api] › tests/health.api.spec.ts:17:1 › SponsorBlock has no segment for any video (12ms)

  4 passed (1.1s)
```

Summary: 5 passed, 0 failed (0 blocking).
