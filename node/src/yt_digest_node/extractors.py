"""Extractors and subtitle track choice (spec section 5.2)."""

import importlib
import json
import random
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

Kind = Literal["manual", "auto"]
Failure = Literal["unavailable", "blocked"]


@dataclass(frozen=True)
class Track:
    lang: str
    kind: Kind
    vtt: str


@dataclass(frozen=True)
class Extraction:
    duration: float
    tracks: list[Track]


ExtractorResult = Failure | Extraction


class Extractor(Protocol):
    def extract(self, video_id: str) -> ExtractorResult: ...


def choose_track(tracks: list[Track], languages: list[str]) -> Track | None:
    """First manual track in language order, then first auto track in language order."""
    for kind in ("manual", "auto"):
        for lang in languages:
            for track in tracks:
                if track.kind == kind and track.lang == lang:
                    return track
    return None


class FakeExtractor:
    def __init__(self, root: Path) -> None:
        self._root = root

    def extract(self, video_id: str) -> ExtractorResult:
        directory = self._root / video_id
        if not directory.is_dir():
            return "unavailable"
        meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
        status = meta.get("status")
        if status in ("unavailable", "blocked"):
            return status  # type: ignore[no-any-return]
        tracks = []
        for path in sorted(directory.glob("*.vtt")):
            lang, kind, _ = path.name.rsplit(".", 2)
            if kind in ("manual", "auto"):
                tracks.append(Track(lang, kind, path.read_text(encoding="utf-8")))  # type: ignore[arg-type]
        return Extraction(float(meta["duration"]), tracks)


_BLOCKED_MARKERS = ("not a bot",)
_UNAVAILABLE_MARKERS = (
    "private video",
    "age",
    "removed",
    "unavailable",
    "terminated",
    "does not exist",
)


def _download_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as response:
        return bytes(response.read()).decode("utf-8")


def _default_ydl_class() -> Callable[[dict[str, Any]], Any]:
    module = importlib.import_module("yt_dlp")
    return module.YoutubeDL  # type: ignore[no-any-return]


class YtDlpExtractor:
    def __init__(
        self,
        delay_range: tuple[float, float] = (2.0, 5.0),
        ydl_class: Callable[[dict[str, Any]], Any] | None = None,
        fetch_text: Callable[[str], str] = _download_text,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._delay_range = delay_range
        self._ydl_class = ydl_class
        self._fetch_text = fetch_text
        self._sleep = sleep

    def _wait(self) -> None:
        low, high = self._delay_range
        delay = random.uniform(low, high)
        if delay > 0:
            self._sleep(delay)

    def extract(self, video_id: str) -> ExtractorResult:
        options: dict[str, Any] = {
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitlesformat": "vtt",
            "quiet": True,
            "no_warnings": True,
        }
        ydl_class = self._ydl_class or _default_ydl_class()
        self._wait()
        try:
            with ydl_class(options) as ydl:
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )
        except Exception as error:
            message = str(error).lower()
            if any(marker in message for marker in _BLOCKED_MARKERS):
                return "blocked"
            if any(marker in message for marker in _UNAVAILABLE_MARKERS):
                return "unavailable"
            raise
        tracks: list[Track] = []
        for kind, key in (("manual", "subtitles"), ("auto", "automatic_captions")):
            for lang, formats in (info.get(key) or {}).items():
                vtt = next((f for f in formats if f.get("ext") == "vtt"), None)
                if vtt is not None:
                    self._wait()
                    tracks.append(Track(lang, kind, self._fetch_text(vtt["url"])))  # type: ignore[arg-type]
        return Extraction(float(info["duration"]), tracks)


def parse_delay(value: str | None) -> tuple[float, float]:
    """`YT_DELAY_SECONDS` as `low-high` (default 2-5), or a single number."""
    if not value:
        return (2.0, 5.0)
    low, _, high = value.partition("-")
    return (float(low), float(high or low))


def make_extractor(env: dict[str, str]) -> Extractor:
    """The fake extractor when `FETCHER_FAKE_YTDLP=1` (no delay), else yt-dlp."""
    if env.get("FETCHER_FAKE_YTDLP") == "1":
        directory = env.get("FAKE_YTDLP_DIR")
        if not directory:
            raise ValueError("FAKE_YTDLP_DIR is required when FETCHER_FAKE_YTDLP=1")
        return FakeExtractor(Path(directory))
    return YtDlpExtractor(parse_delay(env.get("YT_DELAY_SECONDS")))
