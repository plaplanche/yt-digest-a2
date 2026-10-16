# Review 0

- Reviewed commit: `4feeffa3fd4bd2c886484aa27f57f1c8676e9570`
- Reviewer model: openai/gpt-5
- Verdict: **no-go** (the reviewer answered go)

## Findings

- **minor** (`docs/decisions.md:18`) Decision log misses chosen log attrs for sponsorblock.call

  The decision notes level and presence of video_id/request_id but not the specific attrs emitted (status, segments, duration_ms). Since the spec leaves sponsorblock.call payload open, the selected attributes should be documented per project rules.

- **minor** (`node/tests/test_sponsorblock.py:12`) Test server uses module-level mutable globals

  _SEEN and _ANSWER are shared mutable state which can cause interference if tests are ever run in parallel. Consider scoping them to the fixture or guarding with a lock to future-proof test isolation.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md line 18 records base_url parameterization and log level policy, but does not record the chosen sponsorblock.call attrs (status, segments, duration_ms), which are not specified by the spec but asserted by tests.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Implements a SponsorBlock client with 10 s timeout and categories JSON-encoded (node/src/yt_digest_node/sponsorblock.py:13-15,34-41), returns states ok/none/error with logging (lines 38-62), and adds sponsor_ratio per spec (lines 65-80). No unrelated files or features changed; spec and workflows untouched.

- met: The change is covered by tests that fail without it.

  New tests exercise 200/404/500/refused and malformed 200 with log assertions (node/tests/test_sponsorblock.py:46-101) and sponsor_ratio edge cases (lines 104-118). Without fetch_segments/sponsor_ratio these tests fail. Midpoint rule edge tests already exist (node/tests/test_vtt.py:72-76).

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md line 18 records base_url parameterization and log level policy, but does not record the chosen sponsorblock.call attrs (status, segments, duration_ms), which are not specified by the spec but asserted by tests.

## Proposed learnings (not decided)

- When specs only mandate that an event is logged, explicitly record the chosen attributes in decisions to keep telemetry consistent over time.
- Testing HTTP clients against a local HTTPServer with explicit 200/404/500 and connection-refused gives deterministic coverage without real network.
- Encode structured query parameters (like JSON lists) explicitly and assert on the URL-encoded form in tests to avoid regressions.
- Edge-inclusivity rules (start inclusive, end exclusive) benefit from tight unit tests at the boundaries to prevent off-by-one errors.
