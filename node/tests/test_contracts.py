import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from yt_digest_node.contracts.log_event import Event, LogEvent
from yt_digest_node.contracts.transcript_result import TranscriptResult
from yt_digest_node.log import emit

ROOT = Path(__file__).resolve().parents[2]

VALID_RESULT: dict[str, Any] = {
    "video_id": "dQw4w9WgXcQ",
    "status": "ok",
    "lang": "en",
    "source": "manual",
    "word_count": 3,
    "truncated": False,
    "sponsor_ratio": 0.25,
    "pages": ["a b c"],
}

VALID_LINE: dict[str, Any] = {
    "ts": "2026-10-16T10:00:00.000Z",
    "level": "info",
    "service": "node",
    "event": "service.started",
    "attrs": {"version": "0.1.0"},
}


def test_valid_result_is_accepted() -> None:
    assert TranscriptResult.model_validate(VALID_RESULT).word_count == 3


@pytest.mark.parametrize(
    "change",
    [
        {"extra": 1},
        {"video_id": "short"},
        {"video_id": "bad id with $$"},
        {"status": "maybe"},
        {"source": "other"},
        {"word_count": -1},
        {"sponsor_ratio": 1.5},
    ],
)
def test_invalid_result_is_rejected(change: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        TranscriptResult.model_validate({**VALID_RESULT, **change})


def test_valid_log_line_is_accepted() -> None:
    assert LogEvent.model_validate(VALID_LINE).event is Event.service_started


@pytest.mark.parametrize(
    "change", [{"event": "nope"}, {"extra": 1}, {"ts": "yesterday"}]
)
def test_invalid_log_line_is_rejected(change: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        LogEvent.model_validate({**VALID_LINE, **change})


def test_emit_writes_one_json_line(capsys: pytest.CaptureFixture[str]) -> None:
    emit("fetch.transcript", video_id="dQw4w9WgXcQ", attrs={"words": 3})
    lines = capsys.readouterr().err.splitlines()
    assert len(lines) == 1
    line = json.loads(lines[0])
    assert line["event"] == "fetch.transcript"
    assert line["service"] == "node"
    assert line["level"] == "info"
    assert line["attrs"] == {"words": 3}
    LogEvent.model_validate(line)


@pytest.mark.parametrize(
    ("event", "kwargs"),
    [
        ("not.catalogued", {}),
        ("service.started", {"bogus": 1}),
        ("service.started", {"level": "loud"}),
    ],
)
def test_emit_rejects_what_is_not_catalogued(
    event: str, kwargs: dict[str, Any]
) -> None:
    with pytest.raises(ValueError):
        emit(event, **kwargs)


def _copy_repo(dest: Path) -> Path:
    repo = dest / "repo"
    shutil.copytree(
        ROOT,
        repo,
        ignore=shutil.ignore_patterns(
            ".git",
            "node_modules",
            ".venv",
            "__pycache__",
            ".mypy_cache",
            ".ruff_cache",
            ".pytest_cache",
            "work",
        ),
        symlinks=True,
    )
    (repo / "worker/node_modules").symlink_to(ROOT / "worker/node_modules")
    (repo / "node/.venv").symlink_to(ROOT / "node/.venv")
    return repo


def _check(repo: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(repo / "scripts/contracts.sh"), "--check"],
        check=False,
        capture_output=True,
        text=True,
        cwd=repo,
    )


def test_check_passes_on_committed_files() -> None:
    result = _check(ROOT)
    assert result.returncode == 0, result.stderr


def test_check_names_a_hand_edited_file(tmp_path: Path) -> None:
    repo = _copy_repo(tmp_path)
    target = repo / "node/src/yt_digest_node/contracts/transcript_result.py"
    target.write_text(target.read_text() + "# hand edit\n")
    result = _check(repo)
    assert result.returncode == 1
    assert "node/src/yt_digest_node/contracts/transcript_result.py" in result.stderr


def test_check_names_files_when_a_schema_changes(tmp_path: Path) -> None:
    repo = _copy_repo(tmp_path)
    schema = repo / "contracts/log-event.schema.json"
    schema.write_text(
        schema.read_text().replace(
            '"sponsorblock.call"', '"sponsorblock.call", "new.event"'
        )
    )
    result = _check(repo)
    assert result.returncode == 1
    assert "worker/src/contracts/log-events.ts" in result.stderr
    assert "node/src/yt_digest_node/contracts/log_event.py" in result.stderr
