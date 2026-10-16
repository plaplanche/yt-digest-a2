# Checks

Replayed by Ariane on commit `5a4c56b64d918b8b6dae6a6eceb6d1747622ce64`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 9.2 s |
| contracts | yes | pass | 4.7 s |
| test-node | yes | pass | 17.3 s |
| test-worker | yes | pass | 19.4 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 9.2 s)

```text
(35 earlier lines omitted)
 + ruff==0.17.1
 + typeguard==4.6.0
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a2.ariane/worktrees/11-replay/node)
 + yt-dlp==2026.8.19
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
14 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 14 source files

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
- Result: passed (exit 0, 17.3 s)

```text
== test-node
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Resolved 33 packages in 1ms
Checked 32 packages in 0.32ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a2.ariane/worktrees/11-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 54 items

tests/test_contracts.py ..............                                   [ 25%]
tests/test_extractors.py ...............                                 [ 53%]
tests/test_log.py ....                                                   [ 61%]
tests/test_placeholder.py .                                              [ 62%]
tests/test_sponsorblock.py .........                                     [ 79%]
tests/test_vtt.py ...........                                            [100%]

============================= 54 passed in 16.56s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 19.4 s)

```text
== test-worker

added 142 packages, and audited 143 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a2.ariane/worktrees/11-replay/worker


 Test Files  3 passed (3)
      Tests  8 passed (8)
   Start at  22:58:23
   Duration  15.54s (tests 99%, transform 1%)
```

Summary: 4 passed, 0 failed (0 blocking).
