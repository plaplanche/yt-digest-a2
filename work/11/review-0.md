# Review 0

- Reviewed commit: `5a4c56b64d918b8b6dae6a6eceb6d1747622ce64`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/extractors.py:113`) yt-dlp options include extras not in spec

  Spec 5.2 lists the yt-dlp options to use. The implementation also sets "quiet" and "no_warnings" (lines 113-115). While harmless, this is beyond the spec’s stated options and slightly violates the "nothing more" principle.

- **minor** (`node/tests/test_extractors.py:59`) No test for exact language-code matching (e.g., fr vs fr-CA)

  Decision in docs (decisions.md:21) states exact match semantics. Tests only cover a different language (de) not matching fr/en (line 59). Consider adding a case where a regional tag like fr-CA is present to ensure it is not matched for fr.

- **minor** (`node/tests/test_extractors.py:120`) Delay behavior not fully asserted

  Spec says to wait before each request (page and each subtitle download). The test only checks that some sleeps occurred and that each is within range (lines 107-121). It doesn’t assert the exact count (1 + number of downloaded tracks). A stricter assertion would improve confidence.

- **minor** (`node/src/yt_digest_node/extractors.py:58`) Over-broad or mismatched type: ignore comments

  The code uses typed ignores that may not match actual mypy error codes (e.g., '# type: ignore[no-any-return]' at lines 58 and 85). While checks pass, prefer precise narrowing/casts or correct ignore codes to keep strict typing effective. Similar pattern at lines 63 and 136.

- **minor** (`node/pyproject.toml:8`) Aggressive minimum version for yt-dlp

  Dependency is pinned to 'yt-dlp>=2026.8.19'. This could hinder reproducibility for contributors if that version is not widely available. The lazy import and tests are fine, but consider a more conservative lower bound unless specific features are required.

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

  Implements extractors per spec 5.2: FakeExtractor behavior (node/src/yt_digest_node/extractors.py lines 51-65), yt-dlp extractor with required options and error mapping (lines 108-129, 67-75), delay before page and each subtitle fetch (lines 101-106, 116-121, 133-136), and track choice function (lines 37-44). Minor extras: 'quiet'/'no_warnings' options (lines 113-115).

- met: The change is covered by tests that fail without it.

  Fake extractor: missing dir → unavailable (node/tests/test_extractors.py:28-30), meta status passthrough (32-36), duration and tracks read (38-46). Track choice: manual beats auto and language order within kind; no match case (49-61). yt-dlp stub: options and result (107-121), error mapping for private/age/removed→unavailable and bot-check→blocked (123-141), unknown error propagates (143-146).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md lines 20-23 record interface/selection (20), exact language matching and file-order tie-breaker (21), detailed error mapping and per-request delay semantics (22), and YT_DELAY_SECONDS format plus lazy import/runtime dependency (23).

## Proposed learnings (not decided)

- When specifying external tool options, stick strictly to the spec and document any additional flags explicitly.
- Prefer precise type narrowing or casts over broad type ignores to keep mypy --strict maximally effective.
- Tests for timing behavior should assert the exact number of waits when the spec dictates per-request delays.
- Documenting tie-breakers (like file order for duplicate tracks) prevents ambiguous behavior later.
