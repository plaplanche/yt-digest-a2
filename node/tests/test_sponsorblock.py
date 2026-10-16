import json
import socket
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest

from yt_digest_node.sponsorblock import fetch_segments, sponsor_ratio


class _Server(HTTPServer):
    seen: list[str]
    answer: dict[str, Any]


class _Handler(BaseHTTPRequestHandler):
    server: _Server

    def do_GET(self) -> None:
        self.server.seen.append(self.path)
        self.send_response(self.server.answer["status"])
        self.end_headers()
        self.wfile.write(self.server.answer.get("body", b""))

    def log_message(self, format: str, *args: Any) -> None:
        pass


class _Fake(str):
    """Base URL of a per-test server, with its recorded paths and canned answer."""

    seen: list[str]
    answer: dict[str, Any]


@pytest.fixture
def server() -> Iterator[_Fake]:
    httpd = _Server(("127.0.0.1", 0), _Handler)
    httpd.seen = []
    httpd.answer = {}
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    url = _Fake(f"http://127.0.0.1:{httpd.server_port}")
    url.seen = httpd.seen
    url.answer = httpd.answer
    yield url
    httpd.shutdown()
    httpd.server_close()


def _log(capsys: pytest.CaptureFixture[str]) -> dict[str, Any]:
    lines = capsys.readouterr().err.splitlines()
    assert len(lines) == 1
    parsed: dict[str, Any] = json.loads(lines[0])
    assert parsed["event"] == "sponsorblock.call"
    return parsed


def test_200_returns_segments(
    server: _Fake, capsys: pytest.CaptureFixture[str]
) -> None:
    body = [{"segment": [1, 2.5], "category": "sponsor"}, {"segment": [10, 12]}]
    server.answer.update(status=200, body=json.dumps(body).encode())
    result = fetch_segments("abc", server, "r1")
    assert result.state == "ok"
    assert result.segments == [(1.0, 2.5), (10.0, 12.0)]
    assert "videoID=abc" in server.seen[0]
    assert (
        "categories=%5B%22sponsor%22%2C%22selfpromo%22%2C%22interaction%22%5D"
        in server.seen[0]
    )
    assert server.seen[0].startswith("/api/skipSegments?")
    line = _log(capsys)
    assert line["attrs"]["status"] == 200
    assert line["attrs"]["segments"] == 2
    assert line["request_id"] == "r1"
    assert line["video_id"] == "abc"
    assert line["level"] == "info"


def test_404_is_none(server: _Fake, capsys: pytest.CaptureFixture[str]) -> None:
    server.answer.update(status=404, body=b"Not Found")
    result = fetch_segments("abc", server)
    assert (result.state, result.segments) == ("none", [])
    line = _log(capsys)
    assert line["attrs"]["status"] == 404
    assert line["attrs"]["segments"] == 0


def test_500_is_error(server: _Fake, capsys: pytest.CaptureFixture[str]) -> None:
    server.answer.update(status=500, body=b"boom")
    result = fetch_segments("abc", server)
    assert (result.state, result.segments) == ("error", [])
    line = _log(capsys)
    assert line["attrs"]["status"] == 500
    assert line["level"] == "warn"


def test_malformed_200_is_error(
    server: _Fake, capsys: pytest.CaptureFixture[str]
) -> None:
    server.answer.update(status=200, body=b"not json")
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
