import json

import pytest

from yt_digest_node.log import emit


def test_emit_writes_one_valid_json_line(capsys: pytest.CaptureFixture[str]) -> None:
    emit("service.started", attrs={"version": "0.1.0"}, request_id="r1")
    err = capsys.readouterr().err
    assert err.endswith("\n") and err.count("\n") == 1
    line = json.loads(err)
    assert line["event"] == "service.started"
    assert line["level"] == "info"
    assert line["service"] == "node"
    assert line["request_id"] == "r1"
    assert line["attrs"] == {"version": "0.1.0"}
    assert line["ts"].endswith("Z")


def test_emit_rejects_an_event_outside_the_catalogue(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(ValueError):
        emit("not.catalogued")
    assert capsys.readouterr().err == ""


def test_emit_rejects_an_unknown_field() -> None:
    with pytest.raises(ValueError):
        emit("service.started", bogus=1)


def test_emit_rejects_a_bad_level() -> None:
    with pytest.raises(ValueError):
        emit("service.started", level="loud")
