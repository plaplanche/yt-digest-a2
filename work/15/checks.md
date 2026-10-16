# Checks

Replayed by Ariane on commit `4afc3131a19be45eb8e638381c9f240914818299`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 8.8 s |
| contracts | yes | pass | 9.7 s |
| test-node | yes | pass | 37.5 s |
| test-worker | yes | pass | 35.1 s |
| e2e | yes | pass | 0.0 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 8.8 s)

```text
(35 earlier lines omitted)
 + ruff==0.17.1
 + typeguard==4.6.0
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a2.ariane/worktrees/15-replay/node)
 + yt-dlp==2026.8.19
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
28 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 28 source files

added 146 packages, and audited 147 packages in 2s

49 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 9.7 s)

```text
== contracts
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 37.5 s)

```text
(3 earlier lines omitted)
Checked 32 packages in 0.33ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a2.ariane/worktrees/15-replay/node
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

============================= 104 passed in 36.64s =============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 35.1 s)

```text
== test-worker

added 146 packages, and audited 147 packages in 3s

49 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a2.ariane/worktrees/15-replay/worker


 Test Files  4 passed (4)
      Tests  44 passed (44)
   Start at  23:26:33
   Duration  31.68s (tests 99%, transform 1%, import 1%)
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 0.0 s)

```text
== e2e: not implemented yet, skipped
```

Summary: 5 passed, 0 failed (0 blocking).
