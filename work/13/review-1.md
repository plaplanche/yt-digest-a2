# Review 1

- Reviewed commit: `25ca939d8171dfcd82d9ee5c62e49a57c0e6d1d5`
- Reviewer model: openai/gpt-5
- Verdict: **no-go** (the reviewer answered go)

## Findings

- **minor** (`node/src/yt_digest_node/cli.py:41`) Undocumented behavior for empty --langs/TRANSCRIPT_LANGS

  When the computed language list is empty, the CLI errors out with exit code 2 (parser.error("no language given")). This is reasonable, but this specific open choice is not recorded in docs/decisions.md as required by the project rules.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Added decisions document truncation/page semantics, CLI validation and exit behavior, SponsorBlock invocation rules/attrs for non-ok, and console script mapping (docs/decisions.md lines 24–27). One open choice remains undocumented: how the CLI handles an empty language list from --langs/TRANSCRIPT_LANGS (cli.py:41).

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

  Implements truncation and paging per spec 5.5/5.6 (node/src/yt_digest_node/paging.py), adds end-to-end CLI command (node/src/yt_digest_node/cli.py) and pipeline (node/src/yt_digest_node/pipeline.py) honoring env config (spec 5.1), validates output with Pydantic models (contracts). Logging per spec 4.2 and 5.7: service.started then fetch.transcript (cli.py:49, pipeline.py:67) and sponsorblock.call (sponsorblock.py). Decision notes constrain SponsorBlock calling/attrs for non-ok statuses.

- met: The change is covered by tests that fail without it.

  Unit tests: node/tests/test_paging.py covers truncation and pagination edge cases (MAX_WORDS=10; PAGE_WORDS=5) and word counting; node/tests/test_vtt.py and node/tests/test_sponsorblock.py cover integrated cleaning and SponsorBlock behavior. End-to-end: node/tests/test_cli.py exercises ok with sponsor cuts, no_transcript, unavailable, blocked, invalid video id (exit 2), and asserts no transcript text in logs.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Added decisions document truncation/page semantics, CLI validation and exit behavior, SponsorBlock invocation rules/attrs for non-ok, and console script mapping (docs/decisions.md lines 24–27). One open choice remains undocumented: how the CLI handles an empty language list from --langs/TRANSCRIPT_LANGS (cli.py:41).

## Proposed learnings (not decided)

- Paginating around a zero-cost marker requires counting words at the paragraph level and treating the marker as a paragraph with zero weight to preserve ordering and limits cleanly.
- Logging contracts benefit from keeping attrs flexible in schema while documenting exact semantics in decisions, enabling evolutions without schema churn.
- Validating environment configuration early in the CLI simplifies downstream pipeline code and error paths.
