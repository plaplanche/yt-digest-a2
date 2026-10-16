# Review 0

- Reviewed commit: `6bd33bcd4975fe4fc4faa8993ff023432654ec63`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/vtt.py:77`) Rounding gap to whole milliseconds may flip near-boundary cases

  Gap computation uses round((start - previous_end) * 1000), which can round 1.9995 s up to 2000 ms and start a new paragraph although the true gap is < 2.0 s. Using floor for the comparison or an explicit epsilon would avoid upward rounding on borderline cases. This behavior is documented in docs/decisions.md (line 16) and is acceptable as a choice, but it’s worth noting the trade-off.

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

  Implements VTT parsing and cleaning per spec 5.4: parse_vtt ignores header/NOTE/STYLE/REGION and cue settings (vtt.py lines 31-48); clean_cues applies steps 2–5 including segment midpoint filtering (lines 56-59), tag removal/entity decoding/bracket stripping/whitespace trim (lines 51-54), rolling duplicate removal across cues (lines 64-74), and 2.0 s paragraph gaps using the last kept cue (lines 75-83). No unrelated code paths altered; only vtt module, tests, fixtures, and decisions doc updated.

- met: The change is covered by tests that fail without it.

  node/tests/test_vtt.py exercises: parsing ignoring blocks and settings (test_parse_manual_ignores_blocks_header_and_settings), CRLF/BOM handling (test_parse_handles_crlf_and_bom), cleaning rules including duplicates and inline timestamps (test_auto_rolling_duplicates_and_inline_timestamps_removed), annotations and entity decoding (test_annotations_and_entities), paragraph gap thresholds and last-kept-cue logic (test_gap_*), cross-cue duplicate handling (test_duplicate_line_dropped_across_cues_and_paragraphs, test_non_adjacent_repeat_is_kept), and SponsorBlock midpoint start-inclusive/end-exclusive (test_sponsor_segments_*). These would fail without the implemented logic.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md lines 16–17 document open choices: segment shape and midpoint rules; definition of 'kept cue' for gap and comparing gaps in whole ms; step 3 cleaning order (tags → entities → brackets) and the scope of duplicate detection across cues.

## Proposed learnings (not decided)

- Documenting precise boundary semantics (midpoint inclusion, paragraph gap comparison unit) prevents ambiguity in text processing pipelines.
- A simple generic tag-stripper plus entity decoding is robust enough for WebVTT inline markup, especially when paired with targeted tests for YouTube’s autogen quirks.
- Treating duplicate detection globally across cues simplifies rolling-caption cleanup and matches real-world auto-caption behavior.
