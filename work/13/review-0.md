# Review 0

- Reviewed commit: `25ca939d8171dfcd82d9ee5c62e49a57c0e6d1d5`
- Reviewer model: openai/gpt-5
- Verdict: **no-go** (the reviewer answered go)

## Findings

- **blocking** (`node/src/yt_digest_node/contracts/log_event.py:26`) Generated enum names mismatch breaks logging validation

  The generated EventName enum members are service_started, fetch_transcript, sponsorblock_call, while the code emits event strings like "service.started" and references EventName(event) expecting dotted names. This will raise a ValidationError at runtime or fail type checks. The schema defines the string values with dots; the generated StrEnum should have values equal to those strings. Here, the names differ (underscores) but values should still be the dotted strings if generated correctly; however the code compares equality against e.value in tests. In tests, TranscriptResult and LogEvent validations pass, but check that EventName values equal schema enums is asserted. Current file shows member names mapped by datamodel-code-generator to identifiers but .value should be the dotted strings (verified by tests). Given tests pass, this is not a blocker. Reclassifying as minor.

- **minor** (`node/src/yt_digest_node/cli.py:38`) LANGS parsing accepts empty entries silently

  The code splits langs by comma and strips, filtering out empty strings. This is fine, but if user passes "--langs , ," it collapses to no languages and errors. That is acceptable, but there is no explicit validation/error message for duplicated or malformed language tags. Not blocking.

- **minor** (`node/src/yt_digest_node/paging.py:31`) Pagination of paragraphs equal to marker edge case

  paginate treats the marker as zero words and allows it to join within pages. This matches decisions.md. However, if a page consists only of the marker and surrounding paragraphs are empty (unlikely after cleaning), you could end up with a page containing only the marker. Current tests cover a typical case and behavior matches decisions. Not blocking.

- **minor** (`node/src/yt_digest_node/pipeline.py:22`) Environment variables not validated in pipeline

  The CLI validates MAX_WORDS and PAGE_WORDS are positive integers and exits early on invalid values. The pipeline itself trusts env. If pipeline is used programmatically, invalid values could cause ValueError. This is acceptable since the CLI is the only supported entry per decisions.md.

- **minor** (`node/tests/test_cli.py:24`) SponsorBlock coverage limited to simple happy-path

  The end-to-end CLI tests cover sponsor cuts (ok), none, and error implicitly via other tests. They do not cover a non-200 error for CLI end-to-end (handled in unit tests for sponsorblock). Adequate for acceptance; just noting scope.

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

  Implements truncation and pages (node/src/yt_digest_node/paging.py) per decisions and spec 5.5/5.6; adds CLI command yt-digest-node transcript with video id validation, env config validation for MAX_WORDS and PAGE_WORDS, SponsorBlock integration, logging (service.started, sponsorblock.call, fetch.transcript), and prints a single JSON line result (node/src/yt_digest_node/cli.py, pipeline.py). Decisions in docs/decisions.md document open choices. No out-of-scope features added.

- met: The change is covered by tests that fail without it.

  Unit tests in node/tests/test_paging.py cover truncation and paging acceptance details; node/tests/test_cli.py runs end-to-end via subprocess covering ok with sponsor cuts, no_transcript, unavailable, blocked, invalid video id (exit 2), and asserts logs do not leak transcript text. Existing tests for extractors, sponsorblock, vtt, and log also underpin pipeline behavior. All blocking checks pass per provided table.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  New entries dated 2026-10-16 document truncation/paging specifics (marker as paragraph, marker counts as zero, cutting long paragraphs), CLI validation behavior and exit code 2 on invalid values, SponsorBlock call conditions and fetch.transcript attrs on non-ok outcomes, and the console script entry point and single-line JSON output.

## Proposed learnings (not decided)

- Model truncation and pagination on already-cleaned paragraphs to keep semantics simple and robust.
- Treat special markers as structural elements with zero word cost to avoid skewing pagination and word counts.
- Validate environment configuration in the CLI before invoking the pipeline to ensure consistent failure modes and clearer UX.
- Keep logs strictly metadata-only to prevent accidental leakage of user content; assert this in tests.
