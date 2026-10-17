# Checks

Replayed by Ariane on commit `fb778dcd39c45ce54af8b0e93bf9d7139c735da5`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 20.8 s |
| contracts | yes | pass | 15.4 s |
| test-node | yes | pass | 65.1 s |
| test-worker | yes | pass | 65.4 s |
| e2e | yes | pass | 24.1 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 20.8 s)

```text
(48 earlier lines omitted)

added 209 packages, and audited 210 packages in 7s

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
- Result: passed (exit 0, 15.4 s)

```text
== contracts
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 65.1 s)

```text
(4 earlier lines omitted)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a2.ariane/worktrees/27-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 120 items

tests/test_cli.py ........                                               [  6%]
tests/test_contracts.py ..............                                   [ 18%]
tests/test_daemon.py ................                                    [ 31%]
tests/test_extractors.py ...............                                 [ 44%]
tests/test_log.py .....                                                  [ 48%]
tests/test_node_protocol.py ...................................          [ 77%]
tests/test_paging.py ......                                              [ 82%]
tests/test_placeholder.py .                                              [ 83%]
tests/test_sponsorblock.py .........                                     [ 90%]
tests/test_vtt.py ...........                                            [100%]

======================== 120 passed in 64.28s (0:01:04) ========================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 65.4 s)

```text
(32 earlier lines omitted)

[33m▲ [43;33m[[43;30mWARNING[43;33m][0m [1mProxy environment variables detected. We'll use your proxy for fetch requests.[0m



=======================================================================================
WARNING: @cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin.
This package will not receive future updates.
Run `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin` to migrate.
=======================================================================================


 RUN  v4.1.12 /home/user/yt-digest-a2.ariane/worktrees/27-replay/worker


 Test Files  3 passed (3)
      Tests  43 passed (43)
   Start at  01:39:28
   Duration  46.64s (transform 199ms, setup 0ms, import 362ms, tests 46.52s, environment 0ms)
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 24.1 s)

```text
(49 earlier lines omitted)
  ✓   1 [api] › tests/claims.api.spec.ts:11:1 › 2 nodes claiming 6 jobs concurrently get each job once (248ms)
  ✓   2 [api] › tests/daemon.api.spec.ts:15:1 › yt-digest-node work --once processes a queued video (401ms)
  ✓   3 [api] › tests/google.api.spec.ts:25:1 › the discovery document lists the endpoints (9ms)
  ✓   4 [api] › tests/google.api.spec.ts:41:1 › authorize refuses a wrong client_id and a missing openid scope (10ms)
  ✓   5 [api] › tests/google.api.spec.ts:46:1 › authorize without login_hint shows a form repeating every parameter (11ms)
  ✓   6 [api] › tests/google.api.spec.ts:57:1 › the code gives a signed ID token with the claims of 5.3, and is single use (38ms)
  ✓   7 [api] › tests/google.api.spec.ts:90:1 › a wrong redirect_uri or an unknown code gives invalid_grant (18ms)
  ✓   8 [api] › tests/google.api.spec.ts:98:1 › a wrong client secret gives 401 invalid_client, HTTP Basic works (19ms)
  ✓   9 [api] › tests/google.api.spec.ts:111:1 › access_type=offline gives a refresh token that renews the access and ID tokens (22ms)
  ✓  10 [api] › tests/google.api.spec.ts:125:1 › userinfo answers for its access token only, revoke answers 200 (26ms)
  ✓  11 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (12ms)
  ✓  12 [api] › tests/health.api.spec.ts:11:1 › the mocks server answers /health (8ms)
  ✓  13 [api] › tests/health.api.spec.ts:17:1 › SponsorBlock has no segment for any video (8ms)
  ✓  14 [api] › tests/leases.api.spec.ts:28:1 › E2E-13 (reduced): the 6 jobs claimed concurrently all end done (292ms)
  ✓  15 [api] › tests/leases.api.spec.ts:41:1 › E2E-14: an expired lease goes to another node and the late result gets 409 (2.7s)
  ✓  16 [api] › tests/leases.api.spec.ts:56:1 › E2E-16 (reduced): unavailable on 3 nodes gives failed_video and a 4th node gets nothing (202ms)
  ✓  17 [api] › tests/leases.api.spec.ts:68:1 › E2E-20: a revoked node is refused and its job reassigned (161ms)
  ✓  18 [api] › tests/leases.api.spec.ts:81:1 › E2E-21: /node/* responses hold no user data (113ms)

  18 passed (5.4s)
```

Summary: 5 passed, 0 failed (0 blocking).
