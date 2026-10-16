"""The transcript pipeline, from a video id to a result (spec section 5)."""

import time
from collections.abc import Mapping

from yt_digest_node.contracts.transcript_result import Source, Status, TranscriptResult
from yt_digest_node.extractors import Extraction, Extractor, choose_track
from yt_digest_node.log import emit
from yt_digest_node.paging import count_words, paginate, truncate
from yt_digest_node.sponsorblock import fetch_segments, sponsor_ratio
from yt_digest_node.vtt import clean_cues, parse_vtt


def run(
    video_id: str,
    languages: list[str],
    env: Mapping[str, str],
    extractor: Extractor,
    request_id: str | None = None,
) -> TranscriptResult:
    started = time.monotonic()
    max_words = int(env.get("MAX_WORDS", "60000"))
    page_words = int(env.get("PAGE_WORDS", "12000"))
    base_url = env.get("SPONSORBLOCK_URL", "https://sponsor.ajay.app")

    extraction = extractor.extract(video_id)
    track = (
        choose_track(extraction.tracks, languages)
        if isinstance(extraction, Extraction)
        else None
    )
    attrs: dict[str, object] = {}
    if not isinstance(extraction, Extraction):
        result = _empty(video_id, Status(extraction))
    elif track is None:
        result = _empty(video_id, Status.no_transcript)
    else:
        sponsor = fetch_segments(video_id, base_url, request_id)
        ratio = (
            None
            if sponsor.state == "error"
            else sponsor_ratio(sponsor.segments, extraction.duration)
        )
        cleaned = clean_cues(parse_vtt(track.vtt), sponsor.segments)
        paragraphs, truncated = truncate(cleaned, max_words)
        pages = paginate(paragraphs, page_words)
        result = TranscriptResult(
            video_id=video_id,
            status=Status.ok,
            lang=track.lang,
            source=Source(track.kind),
            word_count=count_words(pages),
            truncated=truncated,
            sponsor_ratio=ratio,
            pages=pages,
        )
        attrs = {
            "source": track.kind,
            "words": result.word_count,
            "pages": len(pages),
            "sponsorblock": sponsor.state,
        }
    attrs["outcome"] = result.status.value
    attrs["sponsor_ratio"] = result.sponsor_ratio
    attrs["duration_ms"] = round((time.monotonic() - started) * 1000)
    fields = {"request_id": request_id} if request_id else {}
    emit("fetch.transcript", video_id=video_id, attrs=attrs, **fields)
    return result


def _empty(video_id: str, status: Status) -> TranscriptResult:
    return TranscriptResult(
        video_id=video_id,
        status=status,
        lang=None,
        source=None,
        word_count=0,
        truncated=False,
        sponsor_ratio=None,
        pages=[],
    )
