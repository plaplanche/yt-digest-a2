"""HTTP client of the node protocol (spec lot 2 sections 8 and 9)."""

import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable

from pydantic import BaseModel

from yt_digest_node.log import emit

RETRY_DELAYS = (1, 2, 4)


class WorkerError(Exception):
    """A call that failed: `status` is the HTTP status, 0 on a network error."""

    def __init__(self, endpoint: str, status: int) -> None:
        super().__init__(f"{endpoint} failed with status {status}")
        self.endpoint = endpoint
        self.status = status


class WorkerClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._sleep = sleep

    def call(self, endpoint: str, body: BaseModel, retry: bool = False) -> bytes:
        """POST `body` to `/node/<endpoint>`; with `retry`, retry network errors and 5xx."""
        delays = RETRY_DELAYS if retry else ()
        for attempt in range(len(delays) + 1):
            try:
                return self._once(endpoint, body)
            except WorkerError as error:
                if error.status != 0 and error.status < 500:
                    raise
                if attempt == len(delays):
                    raise
            self._sleep(delays[attempt])
        raise AssertionError("unreachable")

    def _once(self, endpoint: str, body: BaseModel) -> bytes:
        request = urllib.request.Request(
            f"{self._base_url}/node/{endpoint}",
            data=body.model_dump_json(exclude_unset=True).encode(),
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        started = time.monotonic()
        status = 0
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                status = response.status
                payload: bytes = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            raise WorkerError(endpoint, status) from None
        except (urllib.error.URLError, OSError):
            raise WorkerError(endpoint, 0) from None
        finally:
            emit(
                "worker.call",
                attrs={
                    "endpoint": endpoint,
                    "status": status,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                },
            )
        json.loads(payload or b"null")
        return payload
