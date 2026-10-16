"""JSON-lines logger: one validated event per line on standard error."""

import sys
from datetime import UTC, datetime
from typing import Any

from yt_digest_node.contracts.log_event import EventName, Level, LogEvent, Service

_FIELDS = frozenset({"request_id", "video_id", "attrs"})


def emit(event: str, level: str = "info", **fields: Any) -> None:
    """Write one log line; raise ValueError for an event outside the catalogue or an unknown field."""
    unknown = sorted(set(fields) - _FIELDS)
    if unknown:
        raise ValueError(f"unknown log field(s): {', '.join(unknown)}")
    ts = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    line = LogEvent(
        ts=ts,
        level=Level(level),
        service=Service.node,
        event=EventName(event),
        **{"attrs": {}, **fields},
    )
    sys.stderr.write(line.model_dump_json(exclude_none=True) + "\n")
