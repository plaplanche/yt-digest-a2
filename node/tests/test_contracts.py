import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from yt_digest_node.contracts.log_event import EventName, LogEvent
from yt_digest_node.contracts.transcript_result import TranscriptResult

ROOT = Path(__file__).resolve().parents[2]


def result(**changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "video_id": "dQw4w9WgXcQ",
        "status": "ok",
        "lang": "en",
        "source": "manual",
        "word_count": 3,
        "truncated": False,
        "sponsor_ratio": 0.1,
        "pages": ["a b c"],
    }
    return {**base, **changes}


def test_valid_result_is_accepted() -> None:
    assert TranscriptResult.model_validate(result()).word_count == 3


@pytest.mark.parametrize(
    "changes",
    [
        {"extra": 1},
        {"video_id": "short"},
        {"video_id": "dQw4w9WgXc!"},
        {"status": "nope"},
        {"source": "other"},
        {"sponsor_ratio": 1.5},
        {"word_count": -1},
    ],
)
def test_invalid_result_is_rejected(changes: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        TranscriptResult.model_validate(result(**changes))


def test_valid_log_line_is_accepted() -> None:
    line = {
        "ts": "2026-10-16T10:00:00.000Z",
        "level": "info",
        "service": "node",
        "event": "service.started",
        "attrs": {},
    }
    assert LogEvent.model_validate(line).event is EventName.service_started


def test_unknown_event_is_rejected() -> None:
    line = {
        "ts": "2026-10-16T10:00:00.000Z",
        "level": "info",
        "service": "node",
        "event": "nope",
        "attrs": {},
    }
    with pytest.raises(ValidationError):
        LogEvent.model_validate(line)


def test_generated_catalogue_matches_the_schema() -> None:
    schema = json.loads((ROOT / "contracts/log-event.schema.json").read_text())
    assert [e.value for e in EventName] == schema["$defs"]["EventName"]["enum"]


@pytest.fixture
def repo_copy(tmp_path: Path) -> Path:
    for name in (
        "contracts",
        "scripts",
        "worker/src/contracts",
        "node/src/yt_digest_node/contracts",
    ):
        shutil.copytree(
            ROOT / name, tmp_path / name, ignore=shutil.ignore_patterns("__pycache__")
        )
    # Reuse the installed dependencies instead of installing them again.
    (tmp_path / "worker/node_modules").symlink_to(ROOT / "worker/node_modules")
    for name in ("package.json", "package-lock.json"):
        shutil.copy(ROOT / "worker" / name, tmp_path / "worker" / name)
    for name in ("pyproject.toml", "uv.lock"):
        shutil.copy(ROOT / "node" / name, tmp_path / "node" / name)
    return tmp_path


def check(repo: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["./scripts/contracts.sh", "--check"],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )


def test_check_passes_when_up_to_date(repo_copy: Path) -> None:
    assert check(repo_copy).returncode == 0


def test_check_names_a_hand_edited_file(repo_copy: Path) -> None:
    target = repo_copy / "worker/src/contracts/transcript-result.ts"
    target.write_text(target.read_text() + "// edited\n")
    done = check(repo_copy)
    assert done.returncode == 1
    assert "worker/src/contracts/transcript-result.ts" in done.stderr


def test_check_names_files_when_a_schema_changes(repo_copy: Path) -> None:
    schema = repo_copy / "contracts/transcript-result.schema.json"
    schema.write_text(
        schema.read_text().replace('"blocked"', '"blocked", "extra_status"')
    )
    done = check(repo_copy)
    assert done.returncode == 1
    assert "worker/src/contracts/transcript-result.ts" in done.stderr
    assert "node/src/yt_digest_node/contracts/transcript_result.py" in done.stderr
