"""Command-line interface for the data pipeline.

The CLI exposes one subcommand per build-pipeline step (spec §6) plus an
``all`` command that will eventually run them in order. At the scaffold
stage every subcommand except ``load`` is a logging-only stub.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from data_pipeline import __version__
from data_pipeline.config import (
    DEFAULT_INPUT_PATH,
    DEFAULT_OUTPUT_DIR,
    PipelineConfig,
)
from data_pipeline.io import ReadStats, ensure_output_dir, iter_jsonl

logger = logging.getLogger("data_pipeline")


# Ordered list of (subcommand, help text). Order is the order ``all`` will
# eventually invoke them in — mirrors spec §6 steps 2–10.
PIPELINE_STEPS: list[tuple[str, str]] = [
    ("load", "Load and validate the raw kaikki Burmese JSONL extract."),
    ("strip", "Strip entries to required fields and join glosses (spec §6.2)."),
    ("index-en", "Build the English inverted index (spec §6.3)."),
    ("merge-g2p", "Optionally merge the myG2P headword list (spec §6.4)."),
    ("build-db", "Build, index, and VACUUM the SQLite database (spec §6.5)."),
    ("convert-ngram", "Convert myWord n-gram dictionaries to JS-loadable form (spec §6.6)."),
    ("bktree-en", "Build the English BK-tree (spec §6.7)."),
    ("bktree-my", "Build the Burmese BK-tree (spec §6.8)."),
    ("version", "Emit the version stamp (spec §6.9)."),
    ("report", "Report final entry count and asset sizes (spec §6.10)."),
]


def _configure_logging(verbosity: int) -> None:
    level = logging.WARNING
    if verbosity == 1:
        level = logging.INFO
    elif verbosity >= 2:
        level = logging.DEBUG
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def _config_from_args(args: argparse.Namespace) -> PipelineConfig:
    return PipelineConfig(
        input_path=Path(args.input).resolve(),
        output_dir=Path(args.output_dir).resolve(),
    )


# --- Step handlers ----------------------------------------------------------


def cmd_load(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    if not cfg.input_path.exists():
        logger.error("input file not found: %s", cfg.input_path)
        return 1

    logger.info("loading %s", cfg.input_path)
    stats = ReadStats()
    for _ in iter_jsonl(cfg.input_path, stats=stats):
        pass

    print(f"parsed:  {stats.parsed}")
    print(f"skipped: {stats.skipped}")
    return 0


def _make_stub(step_name: str, description: str) -> Callable[[argparse.Namespace], int]:
    def _run(args: argparse.Namespace) -> int:
        cfg = _config_from_args(args)
        ensure_output_dir(cfg.output_dir)
        logger.info(
            "[%s] %s — not yet implemented (scaffold stub). input=%s output=%s",
            step_name,
            description,
            cfg.input_path,
            cfg.output_dir,
        )
        return 0

    _run.__name__ = f"cmd_{step_name.replace('-', '_')}"
    return _run


def cmd_all(args: argparse.Namespace) -> int:
    logger.info("running full pipeline (scaffold: stubs only)")
    for name, _help in PIPELINE_STEPS:
        handler = HANDLERS[name]
        rc = handler(args)
        if rc != 0:
            logger.error("step %s failed with exit code %d; aborting", name, rc)
            return rc
    return 0


HANDLERS: dict[str, Callable[[argparse.Namespace], int]] = {
    "load": cmd_load,
}
for _name, _help in PIPELINE_STEPS:
    if _name not in HANDLERS:
        HANDLERS[_name] = _make_stub(_name, _help)


# --- Argument parser --------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="data-pipeline",
        description=(
            "Build the static data assets shipped by the myangler-web PWA. "
            "See docs/burmese-dictionary-spec.md (§3, §6) for context."
        ),
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INPUT_PATH),
        help="path to the raw kaikki Burmese JSONL (default: %(default)s)",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="directory built assets are written to (default: %(default)s)",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="increase logging verbosity (-v info, -vv debug)",
    )

    subparsers = parser.add_subparsers(dest="command", required=True, metavar="COMMAND")

    for name, help_text in PIPELINE_STEPS:
        sp = subparsers.add_parser(name, help=help_text, description=help_text)
        sp.set_defaults(handler=HANDLERS[name])

    sp_all = subparsers.add_parser(
        "all",
        help="Run every pipeline step in order (scaffold: stubs only).",
        description="Run every pipeline step in order. Currently scaffolding only.",
    )
    sp_all.set_defaults(handler=cmd_all)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)
    handler: Callable[[argparse.Namespace], int] = args.handler
    return handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
