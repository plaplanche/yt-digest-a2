# Checks

Replayed by Ariane on commit `6bd33bcd4975fe4fc4faa8993ff023432654ec63`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 8.8 s |
| contracts | yes | pass | 4.8 s |
| test-node | yes | pass | 16.9 s |
| test-worker | yes | pass | 20.8 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 8.8 s)

```text
(34 earlier lines omitted)
 + pyyaml==6.0.3
 + ruff==0.17.1
 + typeguard==4.6.0
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a2.ariane/worktrees/7-replay/node)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
10 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 10 source files

added 142 packages, and audited 143 packages in 2s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 4.8 s)

```text
== contracts
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 16.9 s)

```text
== test-node
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Resolved 32 packages in 1ms
Checked 31 packages in 0.36ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a2.ariane/worktrees/7-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 30 items

tests/test_contracts.py ..............                                   [ 46%]
tests/test_log.py ....                                                   [ 60%]
tests/test_placeholder.py .                                              [ 63%]
tests/test_vtt.py ...........                                            [100%]

============================= 30 passed in 16.12s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 20.8 s)

```text
== test-worker

added 142 packages, and audited 143 packages in 2s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a2.ariane/worktrees/7-replay/worker


 Test Files  3 passed (3)
      Tests  8 passed (8)
   Start at  22:42:30
   Duration  17.48s (tests 99%, transform 1%)
```

Summary: 4 passed, 0 failed (0 blocking).
