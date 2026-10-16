import http.server
import json
import os
import subprocess
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

from yt_digest_node.contracts.log_event import LogEvent
from yt_digest_node.contracts.transcript_result import TranscriptResult

VTT = """WEBVTT

00:00:00.000 --> 00:00:02.000
Secret alpha beta.

00:00:10.000 --> 00:00:12.000
Buy this sponsor now.

00:00:20.000 --> 00:00:22.000
Gamma delta.
"""


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if "sponsored" in self.path:
            body = json.dumps([{"segment": [9, 13]}]).encode()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        pass


@pytest.fixture
def sponsor_url() -> Iterator[str]:
    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


@pytest.fixture
def fixtures(tmp_path: Path) -> Path:
    def video(name: str, meta: dict[str, object], files: dict[str, str]) -> None:
        directory = tmp_path / name
        directory.mkdir()
        (directory / "meta.json").write_text(json.dumps(meta))
        for file, text in files.items():
            (directory / file).write_text(text)

    video("sponsored01", {"duration": 40}, {"en.manual.vtt": VTT})
    video("plainvideo1", {"duration": 40}, {"en.manual.vtt": VTT, "fr.auto.vtt": VTT})
    video("notranscrip", {"duration": 40}, {"de.manual.vtt": VTT})
    video("blockedvid_", {"duration": 40, "status": "blocked"}, {})
    return tmp_path


def _run(
    fixtures: Path, sponsor_url: str, *args: str, **env: str
) -> subprocess.CompletedProcess[str]:
    environment = {
        **os.environ,
        "FETCHER_FAKE_YTDLP": "1",
        "FAKE_YTDLP_DIR": str(fixtures),
        "SPONSORBLOCK_URL": sponsor_url,
        **env,
    }
    return subprocess.run(
        ["uv", "run", "--locked", "yt-digest-node", "transcript", *args],
        capture_output=True,
        text=True,
        env=environment,
        check=False,
    )


def _logs(process: subprocess.CompletedProcess[str]) -> list[LogEvent]:
    return [
        LogEvent.model_validate_json(l)
        for l in process.stderr.splitlines()
        if l.startswith("{")
    ]


def test_ok_with_sponsor_cuts(fixtures: Path, sponsor_url: str) -> None:
    process = _run(fixtures, sponsor_url, "sponsored01", "--request-id", "req-1")
    assert process.returncode == 0
    result = TranscriptResult.model_validate_json(process.stdout)
    assert result.status == "ok"
    assert result.lang == "en"
    assert result.source == "manual"
    assert result.sponsor_ratio == 0.1
    assert result.pages == ["Secret alpha beta.\n\nGamma delta."]
    assert result.word_count == 5
    assert not result.truncated
    events = _logs(process)
    assert [e.event.value for e in events] == [
        "service.started",
        "sponsorblock.call",
        "fetch.transcript",
    ]
    final = events[-1]
    assert final.request_id == "req-1"
    assert final.video_id == "sponsored01"
    assert final.attrs["sponsorblock"] == "ok"
    assert final.attrs["words"] == 5
    for word in ("Secret", "alpha", "Gamma", "sponsor now"):
        assert word not in process.stderr


def test_langs_option_and_limits(fixtures: Path, sponsor_url: str) -> None:
    process = _run(
        fixtures,
        sponsor_url,
        "plainvideo1",
        "--langs",
        "fr",
        MAX_WORDS="4",
        PAGE_WORDS="2",
    )
    result = TranscriptResult.model_validate_json(process.stdout)
    assert (result.lang, result.source) == ("fr", "auto")
    assert result.truncated
    assert result.sponsor_ratio == 0
    assert result.word_count == 4
    assert result.pages == ["Secret alpha\n\n[…]", "Gamma delta."]


def test_no_transcript(fixtures: Path, sponsor_url: str) -> None:
    process = _run(fixtures, sponsor_url, "notranscrip")
    assert process.returncode == 0
    result = TranscriptResult.model_validate_json(process.stdout)
    assert result.status == "no_transcript"
    assert result.pages == [] and result.sponsor_ratio is None


def test_unavailable(fixtures: Path, sponsor_url: str) -> None:
    process = _run(fixtures, sponsor_url, "missing_vid")
    assert TranscriptResult.model_validate_json(process.stdout).status == "unavailable"


def test_blocked(fixtures: Path, sponsor_url: str) -> None:
    process = _run(fixtures, sponsor_url, "blockedvid_")
    assert process.returncode == 0
    assert TranscriptResult.model_validate_json(process.stdout).status == "blocked"
    assert _logs(process)[-1].attrs["outcome"] == "blocked"


@pytest.mark.parametrize("video_id", ["short", "has space!!", "waytoolongvideoid"])
def test_invalid_video_id(fixtures: Path, sponsor_url: str, video_id: str) -> None:
    process = _run(fixtures, sponsor_url, video_id)
    assert process.returncode == 2
    assert process.stdout == ""
