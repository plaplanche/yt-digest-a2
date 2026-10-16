# Review 1

- Reviewed commit: `641269724cf5f5dd02851e7c5cb628524c0fd9c7`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/sponsorblock.py:25`) No test for 200 with JSON of wrong shape

  The parser tolerates JSON that parses but has the wrong shape (e.g., missing or non-list `segment` fields) by raising and being caught as `error`. While `test_malformed_200_is_error` covers non-JSON bodies, there is no test for a 200 with JSON of the wrong structure (e.g., `{}` or `[{}]`). Adding such a test would close a gap in acceptance surface.

- **minor** (`node/tests/test_sponsorblock.py:73`) Encoding assertion is brittle to harmless formatting changes

  The test asserts a specific percent-encoding of the categories parameter. This would fail if the implementation used `json.dumps` with default separators (which include spaces) while still being standards-compliant. Consider loosening the assertion to decode and compare the `categories` value logically rather than byte-for-byte URL encoding.

- **minor** (`node/tests/test_sponsorblock.py:61`) Log attributes not fully asserted

  `sponsorblock.call`'s `duration_ms` is part of the documented attributes (spec 4.2, decisions.md), but tests do not assert its presence or type/range. Non-blocking, but an assertion that it exists and is a non-negative integer would improve confidence.

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

  Implements SponsorBlock client per spec 5.3 (10 s timeout, GET to `/api/skipSegments`, status handling 200/404/error) and computes `sponsor_ratio` as union clipped to [0,duration], rounded to 3 decimals (node/src/yt_digest_node/sponsorblock.py:30,65). Cue cut midpoint rule of 5.4(2) already exists and matches edges (node/src/yt_digest_node/vtt.py:56-59), with tests (node/tests/test_vtt.py:72). No unrelated code changes.

- met: The change is covered by tests that fail without it.

  Unit tests for SponsorBlock behavior against a local HTTP server: 200, 404, 500, and connection refused (node/tests/test_sponsorblock.py:61,83,92,110), plus malformed 200 (line 101). `sponsor_ratio` behavior tested for overlaps, clipping, and rounding (lines 121,125,129,134). Midpoint edge rule already covered by existing tests (node/tests/test_vtt.py:72). Removing the new module or functions would cause imports or assertions to fail.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md lines 18–19 document open choices: function signature taking base URL; treating malformed 200 as `error`; log level policy (`info` for ok/none, `warn` for error); and `sponsorblock.call` attrs including `status`, `segments`, `duration_ms`.

## Proposed learnings (not decided)

- Testing network integrations via a local HTTPServer gives deterministic coverage for status and body-shape variants without real network flakiness.
- Documenting log semantics (levels and attrs) as decisions keeps implementation and tests aligned with the spec while clarifying unspecified behaviors.
- Implementing cue filtering via midpoint with start-inclusive/end-exclusive avoids off-by-one regressions and simplifies boundary tests.
- Clipping and merging segments before computing ratios prevents edge-case inflation from out-of-bounds or overlapping SponsorBlock data.
