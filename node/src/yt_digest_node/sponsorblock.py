"""SponsorBlock client and sponsor ratio (spec sections 5.3 and 5.4)."""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Literal

from yt_digest_node.log import emit

_CATEGORIES = '["sponsor","selfpromo","interaction"]'
_TIMEOUT_SECONDS = 10

State = Literal["ok", "none", "error"]


@dataclass(frozen=True)
class SponsorBlockResult:
    segments: list[tuple[float, float]]
    state: State


def _parse(body: bytes) -> list[tuple[float, float]]:
    items = json.loads(body)
    return [(float(i["segment"][0]), float(i["segment"][1])) for i in items]


def fetch_segments(
    video_id: str, base_url: str, request_id: str | None = None
) -> SponsorBlockResult:
    """Call SponsorBlock once and log `sponsorblock.call`; never raises on a bad answer."""
    query = urllib.parse.urlencode({"videoID": video_id, "categories": _CATEGORIES})
    url = f"{base_url.rstrip('/')}/api/skipSegments?{query}"
    started = time.monotonic()
    status = 0
    result = SponsorBlockResult([], "error")
    try:
        with urllib.request.urlopen(url, timeout=_TIMEOUT_SECONDS) as response:
            status = response.status
            if status == 200:
                result = SponsorBlockResult(_parse(response.read()), "ok")
    except urllib.error.HTTPError as error:
        status = error.code
        if status == 404:
            result = SponsorBlockResult([], "none")
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        pass
    fields = {"request_id": request_id} if request_id else {}
    emit(
        "sponsorblock.call",
        level="info" if result.state != "error" else "warn",
        video_id=video_id,
        attrs={
            "status": status,
            "segments": len(result.segments),
            "duration_ms": round((time.monotonic() - started) * 1000),
        },
        **fields,
    )
    return result


def sponsor_ratio(segments: list[tuple[float, float]], duration: float) -> float:
    """Length of the union of the segments clipped to [0, duration], over the duration."""
    if not segments or duration <= 0:
        return 0.0
    covered = 0.0
    reach = 0.0
    for start, end in sorted(
        (max(0.0, s), min(duration, e)) for s, e in segments if e > s
    ):
        if end <= start:
            continue
        start = max(start, reach)
        if end > start:
            covered += end - start
            reach = end
    return round(covered / duration, 3)
