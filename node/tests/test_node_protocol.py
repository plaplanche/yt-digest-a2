import inspect
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from yt_digest_node.contracts import transcript_result
from yt_digest_node.contracts.error import ErrorBody
from yt_digest_node.contracts.node_claim_request import NodeClaimRequest
from yt_digest_node.contracts.node_claim_response import NodeClaimResponse
from yt_digest_node.contracts.node_heartbeat_request import NodeHeartbeatRequest
from yt_digest_node.contracts.node_heartbeat_response import NodeHeartbeatResponse
from yt_digest_node.contracts.node_job_ack import NodeJobAck
from yt_digest_node.contracts.node_release_request import NodeReleaseRequest
from yt_digest_node.contracts.node_result_request import NodeResultRequest

TS = "2026-10-16T07:00:01.123Z"
TRANSCRIPT: dict[str, Any] = {
    "video_id": "dQw4w9WgXcQ",
    "status": "ok",
    "lang": "en",
    "source": "manual",
    "word_count": 3,
    "truncated": False,
    "sponsor_ratio": None,
    "pages": ["a b c"],
}
JOB = {
    "video_id": "dQw4w9WgXcQ",
    "lease_id": "0123456789abcdef",
    "lease_expires_at": TS,
}
HEARTBEAT = {"version": "1", "uptime_s": 0, "jobs_in_progress": 0}

# (model, valid instance, invalid instances)
CASES: dict[str, tuple[type[BaseModel], dict[str, Any], list[dict[str, Any]]]] = {
    "heartbeat-request": (
        NodeHeartbeatRequest,
        {
            **HEARTBEAT,
            "last_success_at": TS,
            "last_blocked_at": None,
            "disk_free_ratio": 0.5,
            "cpu_temp_c": 40.5,
        },
        [
            {**HEARTBEAT, "extra": 1},
            {"uptime_s": 0, "jobs_in_progress": 0},
            {**HEARTBEAT, "version": ""},
            {**HEARTBEAT, "uptime_s": -1},
            {**HEARTBEAT, "disk_free_ratio": 1.1},
        ],
    ),
    "heartbeat-response": (
        NodeHeartbeatResponse,
        {"node_id": "n1", "state": "healthy", "hourly_budget": 10, "directive": "run"},
        [
            {
                "node_id": "n1",
                "state": "healthy",
                "hourly_budget": 10,
                "directive": "run",
                "extra": 1,
            },
            {"node_id": "n1", "state": "sad", "hourly_budget": 10, "directive": "run"},
            {
                "node_id": "n1",
                "state": "healthy",
                "hourly_budget": 10,
                "directive": "stop",
            },
        ],
    ),
    "claim-request": (
        NodeClaimRequest,
        {"max_jobs": 3},
        [{"extra": 1}, {"max_jobs": 0}, {"max_jobs": 11}],
    ),
    "claim-response": (
        NodeClaimResponse,
        {"jobs": [JOB]},
        [
            {"jobs": [], "extra": 1},
            {"jobs": [{**JOB, "lease_id": "short"}]},
            {"jobs": [{**JOB, "video_id": "x"}]},
        ],
    ),
    "result-request": (
        NodeResultRequest,
        {"lease_id": "l1", "outcome": "ok", "transcript": TRANSCRIPT},
        [
            {"lease_id": "l1", "outcome": "error", "transcript": None, "extra": 1},
            {"lease_id": "l1", "outcome": "done", "transcript": None},
            {"lease_id": "l1", "outcome": "error"},
            {
                "lease_id": "l1",
                "outcome": "ok",
                "transcript": {**TRANSCRIPT, "status": "nope"},
            },
        ],
    ),
    "release-request": (
        NodeReleaseRequest,
        {"lease_id": "l1"},
        [{"lease_id": "l1", "extra": 1}, {"lease_id": ""}],
    ),
    "job-ack": (
        NodeJobAck,
        {"video_id": "dQw4w9WgXcQ", "status": "failed_video"},
        [
            {"video_id": "dQw4w9WgXcQ", "status": "done", "extra": 1},
            {"video_id": "dQw4w9WgXcQ", "status": "lost"},
        ],
    ),
    "error": (
        ErrorBody,
        {"error": {"code": "bad_request", "message": "no"}},
        [
            {"error": {"code": "a", "message": "b"}, "extra": 1},
            {"error": {"code": "a", "message": "b", "extra": 1}},
            {"error": {"code": "a"}},
        ],
    ),
}


@pytest.mark.parametrize("name", CASES)
def test_valid_instance_is_accepted(name: str) -> None:
    model, valid, _ = CASES[name]
    model.model_validate(valid)


@pytest.mark.parametrize(
    ("name", "index"),
    [(n, i) for n, (_, _, bad) in CASES.items() for i in range(len(bad))],
)
def test_invalid_instance_is_rejected(name: str, index: int) -> None:
    model, _, invalid = CASES[name]
    with pytest.raises(ValidationError):
        model.model_validate(invalid[index])


def test_claim_request_without_max_jobs_is_valid() -> None:
    NodeClaimRequest.model_validate({})


def test_result_request_uses_the_generated_transcript_result_type() -> None:
    request = NodeResultRequest.model_validate(CASES["result-request"][1])
    assert isinstance(request.transcript, transcript_result.TranscriptResult)
    module_file = Path(inspect.getfile(NodeResultRequest))
    text = module_file.read_text()
    assert (
        "from yt_digest_node.contracts.transcript_result import TranscriptResult"
        in text
    )
    assert "class Status" not in text
