"""The node daemon: heartbeat, claim, run the pipeline, send results (spec lot 2 section 9)."""

import signal
import threading
import time
from collections.abc import Mapping
from importlib.metadata import version

from yt_digest_node.contracts.node_claim_request import NodeClaimRequest
from yt_digest_node.contracts.node_claim_response import Job, NodeClaimResponse
from yt_digest_node.contracts.node_heartbeat_request import NodeHeartbeatRequest
from yt_digest_node.contracts.node_heartbeat_response import NodeHeartbeatResponse
from yt_digest_node.contracts.node_job_ack import NodeJobAck
from yt_digest_node.contracts.node_release_request import NodeReleaseRequest
from yt_digest_node.contracts.node_result_request import NodeResultRequest, Outcome
from yt_digest_node.contracts.transcript_result import Status, TranscriptResult
from yt_digest_node.extractors import Extractor
from yt_digest_node.pipeline import run
from yt_digest_node.worker_client import WorkerClient, WorkerError


class Daemon:
    def __init__(
        self,
        client: WorkerClient,
        env: Mapping[str, str],
        extractor: Extractor,
        languages: list[str],
        claim_batch: int,
        poll_seconds: float,
        heartbeat_seconds: float,
    ) -> None:
        self._client = client
        self._env = env
        self._extractor = extractor
        self._languages = languages
        self._claim_batch = claim_batch
        self._poll_seconds = poll_seconds
        self._heartbeat_seconds = heartbeat_seconds
        self._started = time.monotonic()
        self._last_heartbeat: float | None = None
        self._in_progress = 0
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def work(self, once: bool) -> int:
        """Run until done (`--once`) or stopped; return the exit code."""
        previous = {
            sig: signal.signal(sig, lambda *_: self.stop())
            for sig in (signal.SIGTERM, signal.SIGINT)
        }
        try:
            return self._loop(once)
        except WorkerError:
            return 1  # a 401 on a result or a release
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)

    def _loop(self, once: bool) -> int:
        while not self._stop.is_set():
            claimed = False
            try:
                self._heartbeat()
                claimed = self._claim_and_run()
            except WorkerError as error:
                if once or error.status == 401:
                    return 1
            if once:
                return 0
            if not claimed:
                self._stop.wait(self._poll_seconds)
        return 0

    def _heartbeat(self) -> None:
        now = time.monotonic()
        if (
            self._last_heartbeat is not None
            and now - self._last_heartbeat < self._heartbeat_seconds
        ):
            return
        self._last_heartbeat = now
        body = NodeHeartbeatRequest(
            version=version("yt-digest-node"),
            uptime_s=int(now - self._started),
            jobs_in_progress=self._in_progress,
        )
        self._client.call("heartbeat", body, NodeHeartbeatResponse)

    def _claim_and_run(self) -> bool:
        jobs = self._client.call(
            "claim", NodeClaimRequest(max_jobs=self._claim_batch), NodeClaimResponse
        ).jobs
        for index, job in enumerate(jobs):
            if self._stop.is_set():
                for rest in jobs[index:]:
                    self._release(rest)
                break
            self._process(job)
        return bool(jobs)

    def _process(self, job: Job) -> None:
        self._in_progress = 1
        transcript: TranscriptResult | None = None
        try:
            result = run(job.video_id, self._languages, self._env, self._extractor)
            outcome = Outcome(result.status.value)
            if result.status == Status.ok:
                transcript = result
        except Exception:  # noqa: BLE001 - any pipeline failure is an `error` outcome
            outcome = Outcome.error
        finally:
            self._in_progress = 0
        body = NodeResultRequest(
            lease_id=job.lease_id, outcome=outcome, transcript=transcript
        )
        self._send("result", body)

    def _release(self, job: Job) -> None:
        self._send("release", NodeReleaseRequest(lease_id=job.lease_id))

    def _send(
        self, endpoint: str, body: NodeResultRequest | NodeReleaseRequest
    ) -> None:
        """Send a result or a release with retries; a 4xx or a spent retry is dropped, a 401 is not."""
        try:
            self._client.call(endpoint, body, NodeJobAck, retry=True)
        except WorkerError as error:
            if error.status == 401:
                raise
