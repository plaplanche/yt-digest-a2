# Checks

Replayed by Ariane on commit `d51dde306000575c6c64b4f99dbc6cd98a7c4078`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 20.1 s |
| contracts | yes | pass | 15.0 s |
| test-node | yes | pass | 63.8 s |
| test-worker | yes | pass | 65.0 s |
| e2e | yes | pass | 22.9 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 20.1 s)

```text
(48 earlier lines omitted)

added 209 packages, and audited 210 packages in 7s

69 packages are looking for funding
  run `npm fund` for details

5 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

added 104 packages, and audited 105 packages in 1s

30 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 15.0 s)

```text
== contracts
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 63.8 s)

```text
(4 earlier lines omitted)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a2.ariane/worktrees/29-replay/node
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

======================== 120 passed in 63.16s (0:01:03) ========================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 65.0 s)

```text
(32 earlier lines omitted)

[33m▲ [43;33m[[43;30mWARNING[43;33m][0m [1mProxy environment variables detected. We'll use your proxy for fetch requests.[0m



=======================================================================================
WARNING: @cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin.
This package will not receive future updates.
Run `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin` to migrate.
=======================================================================================


 RUN  v4.1.12 /home/user/yt-digest-a2.ariane/worktrees/29-replay/worker


 Test Files  3 passed (3)
      Tests  43 passed (43)
   Start at  01:54:53
   Duration  48.11s (transform 232ms, setup 0ms, import 440ms, tests 47.94s, environment 0ms)
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 22.9 s)

```text
(53 earlier lines omitted)
  ✓   5 [api] › tests/google.api.spec.ts:46:1 › authorize without login_hint shows a form repeating every parameter (8ms)
  ✓   6 [api] › tests/google.api.spec.ts:57:1 › the code gives a signed ID token with the claims of 5.3, and is single use (32ms)
  ✓   7 [api] › tests/google.api.spec.ts:90:1 › a wrong redirect_uri or an unknown code gives invalid_grant (18ms)
  ✓   8 [api] › tests/google.api.spec.ts:98:1 › a wrong client secret gives 401 invalid_client, HTTP Basic works (18ms)
  ✓   9 [api] › tests/google.api.spec.ts:111:1 › access_type=offline gives a refresh token that renews the access and ID tokens (18ms)
  ✓  10 [api] › tests/google.api.spec.ts:125:1 › userinfo answers for its access token only, revoke answers 200 (22ms)
  ✓  11 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (13ms)
  ✓  12 [api] › tests/health.api.spec.ts:11:1 › the mocks server answers /health (6ms)
  ✓  13 [api] › tests/health.api.spec.ts:17:1 › SponsorBlock has no segment for any video (6ms)
  ✓  14 [api] › tests/leases.api.spec.ts:28:1 › E2E-13 (reduced): the 6 jobs claimed concurrently all end done (285ms)
  ✓  15 [api] › tests/leases.api.spec.ts:41:1 › E2E-14: an expired lease goes to another node and the late result gets 409 (2.6s)
  ✓  16 [api] › tests/leases.api.spec.ts:56:1 › E2E-16 (reduced): unavailable on 3 nodes gives failed_video and a 4th node gets nothing (179ms)
  ✓  17 [api] › tests/leases.api.spec.ts:68:1 › E2E-20: a revoked node is refused and its job reassigned (117ms)
  ✓  18 [api] › tests/leases.api.spec.ts:81:1 › E2E-21: /node/* responses hold no user data (106ms)
  ✓  19 [api] › tests/pkce.api.spec.ts:31:1 › an authorization request without PKCE is refused with invalid_request (42ms)
  ✓  20 [api] › tests/pkce.api.spec.ts:42:1 › plain PKCE is refused with invalid_request (32ms)
  ✓  21 [api] › tests/pkce.api.spec.ts:49:1 › a redirect_uri that is not exactly registered gets a 400 page, never a redirect (56ms)
  ✓  22 [api] › tests/pkce.api.spec.ts:59:1 › a valid request shows the consent page (33ms)

  22 passed (5.4s)
```

Summary: 5 passed, 0 failed (0 blocking).
