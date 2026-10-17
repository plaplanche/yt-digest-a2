"""The `yt-digest-node` command (spec section 5)."""

import argparse
import os
import re
import sys
from importlib.metadata import version

from yt_digest_node.daemon import Daemon
from yt_digest_node.extractors import make_extractor
from yt_digest_node.log import emit
from yt_digest_node.pipeline import run
from yt_digest_node.worker_client import WorkerClient

_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")


def _video_id(value: str) -> str:
    if not _VIDEO_ID.fullmatch(value):
        raise argparse.ArgumentTypeError(f"invalid video id: {value!r}")
    return value


def _positive(name: str, default: str) -> int:
    value = int(os.environ.get(name, default))
    if value < 1:
        raise ValueError(f"{name} must be at least 1")
    return value


def _work(once: bool) -> int:
    env = os.environ
    url, token = env.get("WORKER_URL"), env.get("NODE_TOKEN")
    try:
        if not url or not token:
            raise ValueError("WORKER_URL and NODE_TOKEN are required")
        batch = _positive("CLAIM_BATCH", "3")
        if batch > 10:
            raise ValueError("CLAIM_BATCH must be at most 10")
        poll = _positive("POLL_SECONDS", "10")
        heartbeat = _positive("HEARTBEAT_SECONDS", "60")
        _positive("MAX_WORDS", "60000")
        _positive("PAGE_WORDS", "12000")
        languages = [
            lang.strip()
            for lang in env.get("TRANSCRIPT_LANGS", "fr,en").split(",")
            if lang.strip()
        ]
        if not languages:
            raise ValueError("no language given")
        extractor = make_extractor(dict(env))
    except ValueError as error:
        # Standard error holds only log lines, so the reason goes to standard output.
        sys.stdout.write(f"yt-digest-node: {error}\n")
        return 2
    emit("service.started", attrs={"version": version("yt-digest-node")})
    daemon = Daemon(
        WorkerClient(url, token),
        dict(env),
        extractor,
        languages,
        batch,
        poll,
        heartbeat,
    )
    return daemon.work(once)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="yt-digest-node")
    commands = parser.add_subparsers(dest="command", required=True)
    transcript = commands.add_parser("transcript")
    transcript.add_argument("video_id", type=_video_id)
    transcript.add_argument("--langs")
    transcript.add_argument("--request-id")
    work = commands.add_parser("work")
    work.add_argument("--once", action="store_true")
    args = parser.parse_args(argv)
    if args.command == "work":
        return _work(args.once)

    langs = args.langs or os.environ.get("TRANSCRIPT_LANGS", "fr,en")
    languages = [lang.strip() for lang in langs.split(",") if lang.strip()]
    if not languages:
        parser.error("no language given")
    try:
        _positive("MAX_WORDS", "60000")
        _positive("PAGE_WORDS", "12000")
        extractor = make_extractor(dict(os.environ))
    except ValueError as error:
        parser.error(str(error))

    emit("service.started", attrs={"version": version("yt-digest-node")})
    result = run(args.video_id, languages, os.environ, extractor, args.request_id)
    sys.stdout.write(result.model_dump_json() + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
