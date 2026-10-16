"""The `yt-digest-node` command (spec section 5)."""

import argparse
import os
import re
import sys
from importlib.metadata import version

from yt_digest_node.extractors import make_extractor
from yt_digest_node.log import emit
from yt_digest_node.pipeline import run

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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="yt-digest-node")
    commands = parser.add_subparsers(dest="command", required=True)
    transcript = commands.add_parser("transcript")
    transcript.add_argument("video_id", type=_video_id)
    transcript.add_argument("--langs")
    transcript.add_argument("--request-id")
    args = parser.parse_args(argv)

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
