from pathlib import Path

from yt_digest_node.vtt import Cue, clean_cues, parse_vtt

FIXTURES = Path(__file__).parent / "fixtures" / "vtt"


def _load(name: str) -> list[Cue]:
    return parse_vtt((FIXTURES / name).read_text(encoding="utf-8"))


def _cue(start: float, end: float, *lines: str) -> Cue:
    return Cue(start, end, lines)


def test_parse_manual_ignores_blocks_header_and_settings() -> None:
    cues = _load("manual.vtt")
    assert [(c.start, c.end) for c in cues] == [
        (0.0, 2.0),
        (2.5, 4.0),
        (6.0, 8.0),
        (3600.0, 3601.0),
    ]
    assert cues[0].lines == ("Hello and welcome.",)
    assert cues[1].lines == ("Today we talk about <i>parsing</i>.", "It is <b>fun</b>.")


def test_parse_handles_crlf_and_bom() -> None:
    cues = parse_vtt("﻿WEBVTT\r\n\r\n00:01.000 --> 00:02.500\r\nHi\r\n")
    assert cues == [Cue(1.0, 2.5, ("Hi",))]


def test_manual_paragraphs() -> None:
    assert clean_cues(_load("manual.vtt"), []) == [
        "Hello and welcome. Today we talk about parsing. It is fun.",
        "A new paragraph starts here.",
        "Much later.",
    ]


def test_auto_rolling_duplicates_and_inline_timestamps_removed() -> None:
    assert clean_cues(_load("auto.vtt"), []) == [
        "so today we start with the basics and more"
    ]


def test_annotations_and_entities() -> None:
    assert clean_cues(_load("annotations.vtt"), []) == ['Tom & Jerry say "hi" <3']


def test_gap_of_two_seconds_starts_paragraph() -> None:
    assert clean_cues([_cue(0, 1, "a"), _cue(3.0, 4, "b")], []) == ["a", "b"]


def test_gap_of_1_9_seconds_does_not() -> None:
    assert clean_cues([_cue(0, 1, "a"), _cue(2.9, 4, "b")], []) == ["a b"]


def test_gap_uses_last_kept_cue() -> None:
    cues = [_cue(0, 1, "a"), _cue(1.5, 9, "[Music]"), _cue(3.0, 4, "b")]
    assert clean_cues(cues, []) == ["a", "b"]


def test_duplicate_line_dropped_across_cues_and_paragraphs() -> None:
    assert clean_cues([_cue(0, 1, "a"), _cue(5, 6, "a", "b")], []) == ["a", "b"]


def test_non_adjacent_repeat_is_kept() -> None:
    assert clean_cues([_cue(0, 1, "a", "b", "a")], []) == ["a b a"]


def test_sponsor_segments_use_midpoint_start_inclusive_end_exclusive() -> None:
    assert clean_cues([_cue(0, 2, "start")], [(1.0, 5.0)]) == []
    assert clean_cues([_cue(4, 8, "end")], [(1.0, 6.0)]) == ["end"]
    cues = [_cue(0, 2, "in"), _cue(4, 6, "edge"), _cue(8, 10, "out")]
    assert clean_cues(cues, [(1.0, 5.0)]) == ["edge", "out"]
