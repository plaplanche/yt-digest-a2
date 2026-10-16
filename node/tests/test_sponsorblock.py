import json
import socket
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest

from yt_digest_node.sponsorblock import fetch_segments, sponsor_ratio

_SEEN: list[str] = []
_ANSWER: dict[str, Any] = {}


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        _SEEN.append(self.path)
        self.send_response(_ANSWER["status"])
        self.end_headers()
        self.wfile.write(_ANSWER.get("body", b""))

    def log_message(self, format: str, *args: Any) -> None:
        pass


@pytest.fixture
def server() -> Iterator[str]:
    _SEEN.clear()
    httpd = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()
    httpd.server_close()


def _log(capsys: pytest.CaptureFixture[str]) -> dict[str, Any]:
    lines = capsys.readouterr().err.splitlines()
    assert len(lines) == 1
    parsed: dict[str, Any] = json.loads(lines[0])
    assert parsed["event"] == "sponsorblock.call"
    return parsed


def test_200_returns_segments(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    body = [{"segment": [1, 2.5], "category": "sponsor"}, {"segment": [10, 12]}]
    _ANSWER.update(status=200, body=json.dumps(body).encode())
    result = fetch_segments("abc", server, "r1")
    assert result.state == "ok"
    assert result.segments == [(1.0, 2.5), (10.0, 12.0)]
    assert "videoID=abc" in _SEEN[0]
    assert (
        "categories=%5B%22sponsor%22%2C%22selfpromo%22%2C%22interaction%22%5D"
        in _SEEN[0]
    )
    assert _SEEN[0].startswith("/api/skipSegments?")
    line = _log(capsys)
    assert line["attrs"]["status"] == 200
    assert line["attrs"]["segments"] == 2
    assert line["request_id"] == "r1"
    assert line["video_id"] == "abc"
    assert line["level"] == "info"


def test_404_is_none(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    _ANSWER.update(status=404, body=b"Not Found")
    result = fetch_segments("abc", server)
    assert (result.state, result.segments) == ("none", [])
    line = _log(capsys)
    assert line["attrs"]["status"] == 404
    assert line["attrs"]["segments"] == 0


def test_500_is_error(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    _ANSWER.update(status=500, body=b"boom")
    result = fetch_segments("abc", server)
    assert (result.state, result.segments) == ("error", [])
    line = _log(capsys)
    assert line["attrs"]["status"] == 500
    assert line["level"] == "warn"


def test_malformed_200_is_error(
    server: str, capsys: pytest.CaptureFixture[str]
) -> None:
    _ANSWER.update(status=200, body=b"not json")
    result = fetch_segments("abc", server)
    assert (result.state, result.segments) == ("error", [])
    assert _log(capsys)["attrs"]["segments"] == 0


def test_connection_refused_is_error(capsys: pytest.CaptureFixture[str]) -> None:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    result = fetch_segments("abc", f"http://127.0.0.1:{port}")
    assert (result.state, result.segments) == ("error", [])
    line = _log(capsys)
    assert line["attrs"]["status"] == 0
    assert line["attrs"]["segments"] == 0


def test_ratio_without_segments_is_zero() -> None:
    assert sponsor_ratio([], 100) == 0.0


def test_ratio_unions_overlapping_segments() -> None:
    assert sponsor_ratio([(0, 10), (5, 20), (50, 60)], 100) == 0.3


def test_ratio_clips_segment_past_the_end() -> None:
    assert sponsor_ratio([(90, 200)], 100) == 0.1
    assert sponsor_ratio([(150, 200)], 100) == 0.0


def test_ratio_rounds_to_three_decimals() -> None:
    assert sponsor_ratio([(0, 1)], 3) == 0.333
