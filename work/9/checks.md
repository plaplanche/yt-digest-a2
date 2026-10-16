# Checks

Replayed by Ariane on commit `641269724cf5f5dd02851e7c5cb628524c0fd9c7`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 9.8 s |
| contracts | yes | pass | 4.8 s |
| test-node | yes | pass | 24.0 s |
| test-worker | yes | pass | 21.8 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 9.8 s)

```text
(34 earlier lines omitted)
 + pyyaml==6.0.3
 + ruff==0.17.1
 + typeguard==4.6.0
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a2.ariane/worktrees/9-replay/node)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
12 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 12 source files

added 142 packages, and audited 143 packages in 3s

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
- Result: passed (exit 0, 24.0 s)

```text
== test-node
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Resolved 32 packages in 1ms
Checked 31 packages in 0.33ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a2.ariane/worktrees/9-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 39 items

tests/test_contracts.py ..............                                   [ 35%]
tests/test_log.py ....                                                   [ 46%]
tests/test_placeholder.py .                                              [ 48%]
tests/test_sponsorblock.py .........                                     [ 71%]
tests/test_vtt.py ...........                                            [100%]

============================= 39 passed in 23.21s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 21.8 s)

```text
== test-worker

added 142 packages, and audited 143 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a2.ariane/worktrees/9-replay/worker


 Test Files  3 passed (3)
      Tests  8 passed (8)
   Start at  22:52:00
   Duration  17.87s (tests 99%)
```

Summary: 4 passed, 0 failed (0 blocking).
