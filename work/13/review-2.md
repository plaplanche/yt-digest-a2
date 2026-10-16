# Review 2

- Reviewed commit: `4f03b9324d4265f638a4b9181328e62fb6f0aa54`
- Reviewer model: openai/gpt-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/cli.py:38`) Empty --langs is not rejected as required

  The code uses `langs = args.langs or os.environ.get("TRANSCRIPT_LANGS", "fr,en")`. If the user explicitly passes an empty string with `--langs ""`, this falls back to `TRANSCRIPT_LANGS` instead of being rejected. docs/decisions.md (2026-10-16, last line) requires that an empty language list from `--langs` or `TRANSCRIPT_LANGS` be rejected with exit code 2. The subsequent empty-check at line 40 will never trigger for explicit `--langs ""` due to this fallback.

- **minor** (`node/tests/test_cli.py:115`) Partial assertion of 'no transcript text in logs'

  The test asserts absence of a handful of words in stderr for the OK case, which is a reasonable smoke test. To better guard against regressions, consider asserting this property across other statuses as well, or asserting more comprehensively that stderr contains only JSON log lines (no transcript tokens).

- **minor** (`node/tests/test_cli.py:145`) Return code not asserted for 'unavailable' case

  Spec 5.0/5.7 require exit 0 for all results (and 2 only for bad arguments). Other tests assert return code 0 for OK and blocked; adding an assertion for `unavailable` would close that small gap.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  docs/decisions.md (2026-10-16: An empty language list is rejected) clarifies behavior. In node/src/yt_digest_node/cli.py lines 38-41, an explicit `--langs ""` is not rejected because the code falls back to TRANSCRIPT_LANGS. This diverges from the documented decision. Other aspects (truncation 5.5, paging 5.6, command behavior 5/5.7, SponsorBlock 5.3) align: pipeline implements truncation/paging (node/src/yt_digest_node/paging.py), SponsorBlock only when a track is chosen (node/src/yt_digest_node/pipeline.py:37-47), logs per 4.2/5.7, and prints one JSON line.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- **not met**: The change does what the ticket and spec/lot-1.md say, and nothing more.

  docs/decisions.md (2026-10-16: An empty language list is rejected) clarifies behavior. In node/src/yt_digest_node/cli.py lines 38-41, an explicit `--langs ""` is not rejected because the code falls back to TRANSCRIPT_LANGS. This diverges from the documented decision. Other aspects (truncation 5.5, paging 5.6, command behavior 5/5.7, SponsorBlock 5.3) align: pipeline implements truncation/paging (node/src/yt_digest_node/paging.py), SponsorBlock only when a track is chosen (node/src/yt_digest_node/pipeline.py:37-47), logs per 4.2/5.7, and prints one JSON line.

- met: The change is covered by tests that fail without it.

  New unit tests validate truncation and paging semantics (node/tests/test_paging.py:8-47), including MAX_WORDS=10 on 25 words and PAGE_WORDS=5 with a 12-word paragraph cut and order preservation. End-to-end subprocess tests cover the command with a fake extractor and local SponsorBlock server (node/tests/test_cli.py:93-161): OK with sponsor cuts (ratio, pages, logs), no_transcript (lines 137-143), unavailable (145-147), blocked (150-154), invalid video id with exit 2 (157-161), and ensure logs don’t contain transcript text (115-116). These would fail without the added CLI, pipeline, paging, and SponsorBlock integration.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md gained entries on truncation/paging details, validation of MAX_WORDS/PAGE_WORDS and fake extractor setup/exit 2, SponsorBlock call timing and reduced attrs, console script name and single-line JSON output, and rejection of empty language lists (lines 24-28).

## Proposed learnings (not decided)

- When flags can be empty strings, avoid truthy/falsy fallbacks; validate presence before falling back to environment defaults.
- Codify edge-case behavior (like empty language lists) in both decisions and tests to prevent subtle regressions.
- Keep log attributes minimal and never include user content; tests should assert this property robustly.
- Console script wiring with uv-run works well in E2E tests; using importlib.metadata requires ensuring the project is discoverable as an installed distribution.
