# Checks

Replayed by Ariane on commit `4f03b9324d4265f638a4b9181328e62fb6f0aa54`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 7.5 s |
| contracts | yes | pass | 4.7 s |
| test-node | yes | pass | 27.4 s |
| test-worker | yes | pass | 23.6 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 7.5 s)

```text
(35 earlier lines omitted)
 + ruff==0.17.1
 + typeguard==4.6.0
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a2.ariane/worktrees/13-replay/node)
 + yt-dlp==2026.8.19
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
19 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 19 source files

added 142 packages, and audited 143 packages in 2s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 4.7 s)

```text
== contracts
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 27.4 s)

```text
(2 earlier lines omitted)
Resolved 33 packages in 1ms
Checked 32 packages in 0.32ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a2.ariane/worktrees/13-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 68 items

tests/test_cli.py ........                                               [ 11%]
tests/test_contracts.py ..............                                   [ 32%]
tests/test_extractors.py ...............                                 [ 54%]
tests/test_log.py ....                                                   [ 60%]
tests/test_paging.py ......                                              [ 69%]
tests/test_placeholder.py .                                              [ 70%]
tests/test_sponsorblock.py .........                                     [ 83%]
tests/test_vtt.py ...........                                            [100%]

============================= 68 passed in 26.65s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 23.6 s)

```text
== test-worker

added 142 packages, and audited 143 packages in 4s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a2.ariane/worktrees/13-replay/worker


 Test Files  3 passed (3)
      Tests  8 passed (8)
   Start at  23:14:02
   Duration  18.37s (tests 99%, transform 1%)
```

Summary: 4 passed, 0 failed (0 blocking).
