"""Structured logger: one JSON line per event on standard error, catalogued events only."""

import sys
from datetime import UTC, datetime
from typing import Any

from yt_digest_node.contracts.log_event import Event, Level, LogEvent, Service


def emit(event: str, level: str = "info", **fields: Any) -> None:
    """Write one log line; raises ValueError for an unknown event, level or field."""
    record = LogEvent.model_validate(
        {
            "ts": datetime.now(UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": Level(level),
            "service": Service.node,
            "event": Event(event),
            "attrs": {},
            **fields,
        }
    )
    sys.stderr.write(record.model_dump_json(exclude_none=True) + "\n")
