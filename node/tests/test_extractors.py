import json
from pathlib import Path
from typing import Any, ClassVar, Self

import pytest

from yt_digest_node.extractors import (
    Extraction,
    FakeExtractor,
    Track,
    YtDlpExtractor,
    choose_track,
    make_extractor,
    parse_delay,
)


def _video(
    root: Path, files: dict[str, str], meta: dict[str, Any] | None = None
) -> None:
    directory = root / "vid"
    directory.mkdir()
    (directory / "meta.json").write_text(json.dumps(meta or {"duration": 120}))
    for name, text in files.items():
        (directory / name).write_text(text)


def test_missing_directory_is_unavailable(tmp_path: Path) -> None:
    assert FakeExtractor(tmp_path).extract("vid") == "unavailable"


@pytest.mark.parametrize("status", ["blocked", "unavailable"])
def test_meta_status_is_returned(tmp_path: Path, status: str) -> None:
    _video(tmp_path, {}, {"duration": 1, "status": status})
    assert FakeExtractor(tmp_path).extract("vid") == status


def test_fake_reads_duration_and_tracks(tmp_path: Path) -> None:
    _video(tmp_path, {"fr.auto.vtt": "A", "en.manual.vtt": "B"})
    result = FakeExtractor(tmp_path).extract("vid")
    assert isinstance(result, Extraction)
    assert result.duration == 120
    assert sorted((t.lang, t.kind, t.vtt) for t in result.tracks) == [
        ("en", "manual", "B"),
        ("fr", "auto", "A"),
    ]


def test_manual_beats_auto_in_language_order() -> None:
    tracks = [Track("fr", "auto", "A"), Track("en", "manual", "B")]
    assert choose_track(tracks, ["fr", "en"]) == tracks[1]


def test_language_order_within_kind() -> None:
    tracks = [Track("en", "auto", "A"), Track("fr", "auto", "B")]
    assert choose_track(tracks, ["fr", "en"]) == tracks[1]


def test_no_matching_track(tmp_path: Path) -> None:
    assert choose_track([Track("de", "manual", "X")], ["fr", "en"]) is None


class _Stub:
    instances: ClassVar[list["_Stub"]] = []
    error: ClassVar[Exception | None] = None

    def __init__(self, options: dict[str, Any]) -> None:
        self.options = options
        self.urls: list[str] = []
        _Stub.instances.append(self)

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def extract_info(self, url: str, download: bool) -> dict[str, Any]:
        assert download is False
        self.urls.append(url)
        if _Stub.error:
            raise _Stub.error
        return {
            "duration": 90,
            "subtitles": {
                "en": [{"ext": "json3", "url": "x"}, {"ext": "vtt", "url": "u-en"}]
            },
            "automatic_captions": {"fr": [{"ext": "vtt", "url": "u-fr"}]},
        }


@pytest.fixture(autouse=True)
def _reset() -> None:
    _Stub.instances = []
    _Stub.error = None


def _extractor(sleeps: list[float]) -> YtDlpExtractor:
    return YtDlpExtractor(
        (2.0, 5.0),
        ydl_class=_Stub,
        fetch_text=lambda url: f"text:{url}",
        sleep=sleeps.append,
    )


def test_ytdlp_options_and_result() -> None:
    sleeps: list[float] = []
    result = _extractor(sleeps).extract("abc")
    options = _Stub.instances[0].options
    assert options["skip_download"] is True
    assert options["writesubtitles"] is True
    assert options["writeautomaticsub"] is True
    assert options["subtitlesformat"] == "vtt"
    assert "cookiefile" not in options and "cookiesfrombrowser" not in options
    assert _Stub.instances[0].urls == ["https://www.youtube.com/watch?v=abc"]
    assert result == Extraction(
        90, [Track("en", "manual", "text:u-en"), Track("fr", "auto", "text:u-fr")]
    )
    assert sleeps and all(2.0 <= s <= 5.0 for s in sleeps)


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        (
            "ERROR: [youtube] abc: Private video. Sign in if you've been granted access",
            "unavailable",
        ),
        (
            "ERROR: Sign in to confirm your age. This video may be inappropriate",
            "unavailable",
        ),
        ("ERROR: Video unavailable. This video has been removed", "unavailable"),
        ("ERROR: Sign in to confirm you're not a bot", "blocked"),
    ],
)
def test_ytdlp_error_mapping(message: str, expected: str) -> None:
    _Stub.error = RuntimeError(message)
    assert _extractor([]).extract("abc") == expected


def test_ytdlp_unknown_error_propagates() -> None:
    _Stub.error = RuntimeError("boom")
    with pytest.raises(RuntimeError):
        _extractor([]).extract("abc")


def test_make_extractor_fake_and_default(tmp_path: Path) -> None:
    fake = make_extractor({"FETCHER_FAKE_YTDLP": "1", "FAKE_YTDLP_DIR": str(tmp_path)})
    assert isinstance(fake, FakeExtractor)
    assert isinstance(make_extractor({}), YtDlpExtractor)
    with pytest.raises(ValueError):
        make_extractor({"FETCHER_FAKE_YTDLP": "1"})


def test_parse_delay() -> None:
    assert parse_delay(None) == (2.0, 5.0)
    assert parse_delay("1-3") == (1.0, 3.0)
    assert parse_delay("0") == (0.0, 0.0)
