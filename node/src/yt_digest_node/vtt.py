"""VTT parsing and cleaning (spec section 5.4)."""

import html
import re
from dataclasses import dataclass

_TIMING = re.compile(
    r"((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})"
)
_TAG = re.compile(r"<[^>]*>")
_BRACKETS = re.compile(r"\[[^\]]*\]")
_SKIPPED_BLOCKS = ("NOTE", "STYLE", "REGION")
_PARAGRAPH_GAP_MS = 2000


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    lines: tuple[str, ...]


def _seconds(stamp: str) -> float:
    parts = stamp.replace(",", ".").split(":")
    hours = int(parts[0]) if len(parts) == 3 else 0
    minutes, seconds = int(parts[-2]), parts[-1]
    whole, millis = seconds.split(".")
    return hours * 3600 + minutes * 60 + int(whole) + int(millis) / 1000


def parse_vtt(text: str) -> list[Cue]:
    """Parse VTT text into cues, ignoring the header, NOTE/STYLE/REGION blocks and cue settings."""
    blocks = re.split(
        r"\n\s*\n", text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    )
    cues: list[Cue] = []
    for block in blocks:
        lines = block.strip("\n").split("\n")
        if lines[0].startswith("WEBVTT") or lines[0].split(" ")[0] in _SKIPPED_BLOCKS:
            continue
        for i, line in enumerate(lines[:2]):
            match = _TIMING.search(line)
            if match:
                cues.append(
                    Cue(_seconds(match[1]), _seconds(match[2]), tuple(lines[i + 1 :]))
                )
                break
    return cues


def _clean_line(line: str) -> str:
    line = html.unescape(_TAG.sub("", line))
    return " ".join(_BRACKETS.sub("", line).split())


def _in_segment(cue: Cue, segments: list[tuple[float, float]]) -> bool:
    midpoint = (cue.start + cue.end) / 2
    return any(start <= midpoint < end for start, end in segments)


def clean_cues(cues: list[Cue], segments: list[tuple[float, float]]) -> list[str]:
    """Apply steps 2 to 5 of section 5.4 and return the paragraphs."""
    paragraphs: list[list[str]] = []
    previous_line: str | None = None
    previous_end: float | None = None
    for cue in cues:
        if _in_segment(cue, segments):
            continue
        kept: list[str] = []
        for line in map(_clean_line, cue.lines):
            if line and line != previous_line:
                kept.append(line)
                previous_line = line
        if not kept:
            continue
        gap_ms = (
            None if previous_end is None else round((cue.start - previous_end) * 1000)
        )
        if gap_ms is None or gap_ms >= _PARAGRAPH_GAP_MS:
            paragraphs.append([])
        paragraphs[-1].extend(kept)
        previous_end = cue.end
    return [" ".join(lines) for lines in paragraphs]
