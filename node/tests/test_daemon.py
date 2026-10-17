import http.server
import json
import os
import signal
import subprocess
import sys
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

from yt_digest_node.contracts.log_event import LogEvent

TOKEN = "ytd_node_secret-token-value"
VTT = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nalpha beta gamma.\n"
LEASE = "lease-0123456789abcdef"
Reply = tuple[int, dict[str, Any]]


class FakeWorker:
    def __init__(self) -> None:
        self.requests: list[tuple[str, dict[str, Any], str | None]] = []
        self.jobs: list[str] = []
        self.replies: dict[str, list[Reply]] = {}
        self.on_request: Callable[[str], None] = lambda path: None
        self.server: http.server.HTTPServer | None = None

    def reply(self, path: str) -> Reply:
        queue = self.replies.get(path)
        if queue:
            return queue.pop(0)
        if path == "/node/claim":
            return 200, {
                "jobs": [
                    {
                        "video_id": video,
                        "lease_id": f"{LEASE}-{video}",
                        "lease_expires_at": "2026-10-16T07:00:01.123Z",
                    }
                    for video in self.jobs
                ]
            }
        if path == "/node/heartbeat":
            return 200, {
                "node_id": "n1",
                "state": "healthy",
                "hourly_budget": 10,
                "directive": "run",
            }
        return 200, {"video_id": "x" * 11, "status": "done"}

    def paths(self) -> list[str]:
        return [path for path, _, _ in self.requests]

    def bodies(self, path: str) -> list[dict[str, Any]]:
        return [body for p, body, _ in self.requests if p == path]


@pytest.fixture
def worker() -> Iterator[FakeWorker]:
    fake = FakeWorker()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            body = json.loads(self.rfile.read(length))
            fake.requests.append((self.path, body, self.headers["Authorization"]))
            status, payload = fake.reply(self.path)
            fake.on_request(self.path)
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: object) -> None:
            pass

    fake.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=fake.server.serve_forever, daemon=True).start()
    yield fake
    fake.server.shutdown()


@pytest.fixture
def fixtures(tmp_path: Path) -> Path:
    for name, meta, files in [
        ("okvideo0001", {"duration": 40}, {"en.manual.vtt": VTT}),
        ("okvideo0002", {"duration": 40}, {"en.manual.vtt": VTT}),
        ("okvideo0003", {"duration": 40}, {"en.manual.vtt": VTT}),
        ("notranscrip", {"duration": 40}, {"de.manual.vtt": VTT}),
        ("blockedvid_", {"duration": 40, "status": "blocked"}, {}),
    ]:
        (tmp_path / name).mkdir()
        (tmp_path / name / "meta.json").write_text(json.dumps(meta))
        for file, text in files.items():
            (tmp_path / name / file).write_text(text)
    return tmp_path


def _port(worker: FakeWorker) -> int:
    assert worker.server is not None
    return int(worker.server.server_port)


def _start(
    worker: FakeWorker, fixtures: Path, *args: str, **env: str
) -> subprocess.Popen[str]:
    environment = {
        **os.environ,
        "FETCHER_FAKE_YTDLP": "1",
        "FAKE_YTDLP_DIR": str(fixtures),
        "SPONSORBLOCK_URL": "http://127.0.0.1:9",
        "WORKER_URL": f"http://127.0.0.1:{_port(worker)}",
        "NODE_TOKEN": TOKEN,
        "POLL_SECONDS": "1",
        **env,
    }
    environment = {k: v for k, v in environment.items() if v != ""}
    return subprocess.Popen(
        [sys.executable, "-m", "yt_digest_node.cli", "work", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=environment,
    )


def _once(
    worker: FakeWorker, fixtures: Path, **env: str
) -> subprocess.CompletedProcess[str]:
    process = _start(worker, fixtures, "--once", **env)
    out, err = process.communicate(timeout=60)
    return subprocess.CompletedProcess(process.args, process.returncode, out, err)


def _logs(stderr: str) -> list[LogEvent]:
    lines = stderr.splitlines()
    assert all(line.startswith("{") for line in lines), stderr
    assert TOKEN not in stderr
    return [LogEvent.model_validate_json(line) for line in lines]


def test_once_heartbeat_claim_and_results(worker: FakeWorker, fixtures: Path) -> None:
    worker.jobs = ["okvideo0001", "notranscrip", "blockedvid_", "missing0000"]
    process = _once(worker, fixtures)
    assert process.returncode == 0
    assert worker.paths() == [
        "/node/heartbeat",
        "/node/claim",
        "/node/result",
        "/node/result",
        "/node/result",
        "/node/result",
    ]
    assert all(auth == f"Bearer {TOKEN}" for _, _, auth in worker.requests)
    assert worker.bodies("/node/heartbeat")[0]["version"]
    assert worker.bodies("/node/claim") == [{"max_jobs": 3}]
    results = worker.bodies("/node/result")
    assert [(r["lease_id"], r["outcome"]) for r in results] == [
        (f"{LEASE}-okvideo0001", "ok"),
        (f"{LEASE}-notranscrip", "no_transcript"),
        (f"{LEASE}-blockedvid_", "blocked"),
        (f"{LEASE}-missing0000", "unavailable"),
    ]
    assert results[0]["transcript"]["status"] == "ok"
    assert results[0]["transcript"]["pages"] == ["alpha beta gamma."]
    assert all(r["transcript"] is None for r in results[1:])
    events = _logs(process.stderr)
    assert events[0].event.value == "service.started"
    calls = [e.attrs for e in events if e.event.value == "worker.call"]
    assert [c["endpoint"] for c in calls] == ["heartbeat", "claim"] + ["result"] * 4
    assert all(c["status"] == 200 for c in calls)
    assert sum(e.event.value == "fetch.transcript" for e in events) == 4


def test_claim_batch(worker: FakeWorker, fixtures: Path) -> None:
    _once(worker, fixtures, CLAIM_BATCH="7")
    assert worker.bodies("/node/claim") == [{"max_jobs": 7}]


def test_pipeline_exception_sends_error(worker: FakeWorker, tmp_path: Path) -> None:
    broken = tmp_path / "brokenvid01"
    broken.mkdir()
    (broken / "meta.json").write_text("not json")
    worker.jobs = ["brokenvid01"]
    process = _once(worker, tmp_path)
    assert process.returncode == 0
    (result,) = worker.bodies("/node/result")
    assert result["outcome"] == "error" and result["transcript"] is None


def test_result_503_is_retried(worker: FakeWorker, fixtures: Path) -> None:
    worker.jobs = ["okvideo0001"]
    worker.replies["/node/result"] = [(503, {"error": "x"})]
    process = _once(worker, fixtures)
    assert process.returncode == 0
    assert worker.paths().count("/node/result") == 2
    statuses = [
        e.attrs["status"]
        for e in _logs(process.stderr)
        if e.event.value == "worker.call" and e.attrs["endpoint"] == "result"
    ]
    assert statuses == [503, 200]


def test_result_409_is_not_retried(worker: FakeWorker, fixtures: Path) -> None:
    worker.jobs = ["okvideo0001", "okvideo0002"]
    worker.replies["/node/result"] = [(409, {"error": "stale_lease"})]
    process = _once(worker, fixtures)
    assert process.returncode == 0
    assert worker.paths().count("/node/result") == 2
    assert len(_logs(process.stderr)) > 0


def test_failed_claim_exits_1(worker: FakeWorker, fixtures: Path) -> None:
    worker.replies["/node/claim"] = [(500, {"error": "x"})]
    process = _once(worker, fixtures)
    assert process.returncode == 1
    _logs(process.stderr)


def test_failed_heartbeat_exits_1(worker: FakeWorker, fixtures: Path) -> None:
    worker.replies["/node/heartbeat"] = [(500, {"error": "x"})]
    process = _once(worker, fixtures)
    assert process.returncode == 1
    assert worker.paths() == ["/node/heartbeat"]


def test_malformed_heartbeat_response_exits_1(
    worker: FakeWorker, fixtures: Path
) -> None:
    worker.replies["/node/heartbeat"] = [(200, {"node_id": "n1"})]
    process = _once(worker, fixtures)
    assert process.returncode == 1
    assert worker.paths() == ["/node/heartbeat"]


def test_malformed_result_response_is_not_retried(
    worker: FakeWorker, fixtures: Path
) -> None:
    worker.jobs = ["okvideo0001"]
    worker.replies["/node/result"] = [(200, {"unexpected": True})]
    process = _once(worker, fixtures)
    assert process.returncode == 0
    assert worker.paths().count("/node/result") == 1


def test_unreachable_worker_exits_1(worker: FakeWorker, fixtures: Path) -> None:
    process = _start(worker, fixtures, "--once", WORKER_URL="http://127.0.0.1:9")
    _, err = process.communicate(timeout=60)
    assert process.returncode == 1
    statuses = [e.attrs["status"] for e in _logs(err) if e.event.value == "worker.call"]
    assert statuses == [0]


def test_unauthorized_exits_1_in_loop(worker: FakeWorker, fixtures: Path) -> None:
    worker.replies["/node/heartbeat"] = [(401, {"error": "unauthorized"})]
    process = _start(worker, fixtures)
    _, err = process.communicate(timeout=60)
    assert process.returncode == 1
    _logs(err)


@pytest.mark.parametrize("missing", ["NODE_TOKEN", "WORKER_URL"])
def test_missing_variable_exits_2(
    worker: FakeWorker, fixtures: Path, missing: str
) -> None:
    process = _once(worker, fixtures, **{missing: ""})
    assert process.returncode == 2
    assert worker.requests == []
    assert process.stderr == ""


def test_bad_claim_batch_exits_2(worker: FakeWorker, fixtures: Path) -> None:
    assert _once(worker, fixtures, CLAIM_BATCH="11").returncode == 2
    assert worker.requests == []


@pytest.mark.skipif(sys.platform == "win32", reason="needs POSIX signals")
def test_sigterm_releases_unstarted_jobs(worker: FakeWorker, fixtures: Path) -> None:
    worker.jobs = ["okvideo0001", "okvideo0002", "okvideo0003"]
    process = _start(worker, fixtures)

    def on_request(path: str) -> None:
        if path == "/node/result" and process.poll() is None:
            process.send_signal(signal.SIGTERM)

    worker.on_request = on_request
    out, err = process.communicate(timeout=60)
    assert process.returncode == 0
    assert out == ""
    assert [r["lease_id"] for r in worker.bodies("/node/result")] == [
        f"{LEASE}-okvideo0001"
    ]
    assert [r["lease_id"] for r in worker.bodies("/node/release")] == [
        f"{LEASE}-okvideo0002",
        f"{LEASE}-okvideo0003",
    ]
    _logs(err)


def test_loop_polls_again_when_no_job(worker: FakeWorker, fixtures: Path) -> None:
    process = _start(worker, fixtures)

    def on_request(path: str) -> None:
        if worker.paths().count("/node/claim") >= 2 and process.poll() is None:
            process.send_signal(signal.SIGINT)

    worker.on_request = on_request
    _, err = process.communicate(timeout=60)
    assert process.returncode == 0
    assert worker.paths().count("/node/heartbeat") == 1
    _logs(err)
