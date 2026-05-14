"""Command-line interface for the data pipeline.

Each pipeline step from spec §6 is exposed as its own subcommand; the
``all`` command runs every implemented step in dependency order against
a single streamed pass over the input file.

``merge-g2p`` and ``convert-ngram`` remain logging-only stubs in this
task (see ``README.md`` and the task brief).
"""

from __future__ import annotations

import argparse
import logging
from collections.abc import Callable, Sequence
from pathlib import Path

from data_pipeline import __version__
from data_pipeline.config import (
    BKTREE_EN_FILENAME,
    BKTREE_MY_FILENAME,
    DB_FILENAME,
    DEFAULT_INPUT_PATH,
    DEFAULT_OUTPUT_DIR,
    VERSION_FILENAME,
    PipelineConfig,
)
from data_pipeline.io import ReadStats, ensure_output_dir, iter_jsonl, output_path
from data_pipeline.steps.bktree_en import build_english_bktree, write_english_bktree
from data_pipeline.steps.bktree_my import build_burmese_bktree, write_burmese_bktree
from data_pipeline.steps.build_db import build_database
from data_pipeline.steps.index_en import IndexStats, build_index
from data_pipeline.steps.report import PipelineReport, measure_asset_sizes
from data_pipeline.steps.strip import StripStats, strip_entries
from data_pipeline.steps.version import build_version_string, write_version_stamp

logger = logging.getLogger("data_pipeline")


# Ordered list of (subcommand, help text). Order is the order ``all`` runs
# them in — mirrors spec §6 steps 2–10. ``merge-g2p`` and ``convert-ngram``
# remain stubs in this task.
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

# Steps `all` actually runs (in this order). Stubs are intentionally skipped.
ALL_STEPS: tuple[str, ...] = (
    "strip",
    "index-en",
    "build-db",
    "bktree-en",
    "bktree-my",
    "version",
    "report",
)


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


def _require_input(cfg: PipelineConfig) -> int | None:
    if not cfg.input_path.exists():
        logger.error("input file not found: %s", cfg.input_path)
        return 1
    return None


# --- Step handlers ----------------------------------------------------------


def cmd_load(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    err = _require_input(cfg)
    if err is not None:
        return err

    logger.info("loading %s", cfg.input_path)
    stats = ReadStats()
    for _ in iter_jsonl(cfg.input_path, stats=stats):
        pass

    print(f"parsed:  {stats.parsed}")
    print(f"skipped: {stats.skipped}")
    return 0


def _stream_and_strip(cfg: PipelineConfig) -> tuple[list, StripStats, ReadStats]:
    read_stats = ReadStats()
    strip_stats = StripStats()
    entries = list(
        strip_entries(iter_jsonl(cfg.input_path, stats=read_stats), stats=strip_stats)
    )
    return entries, strip_stats, read_stats


def cmd_strip(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    err = _require_input(cfg)
    if err is not None:
        return err
    ensure_output_dir(cfg.output_dir)
    entries, strip_stats, read_stats = _stream_and_strip(cfg)
    print(f"raw entries        : {read_stats.parsed}")
    print(f"malformed skipped  : {read_stats.skipped}")
    print(f"stripped           : {strip_stats.stripped}")
    print(f"missing headword   : {strip_stats.missing_headword}")
    print(f"empty glosses      : {strip_stats.empty_glosses}")
    print(f"distinct headwords : {strip_stats.distinct_headwords}")
    return 0 if entries else 1


def cmd_index_en(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    err = _require_input(cfg)
    if err is not None:
        return err
    ensure_output_dir(cfg.output_dir)
    entries, _, _ = _stream_and_strip(cfg)
    stats = IndexStats()
    index = build_index(entries, stopwords=cfg.stopwords, stats=stats)
    print(f"glosses indexed    : {stats.glosses_indexed}")
    print(f"glosses w/o words  : {stats.glosses_skipped_empty}")
    print(f"tokens seen        : {stats.tokens_seen}")
    print(f"stopwords removed  : {stats.tokens_excluded_stopword}")
    print(f"distinct words     : {stats.distinct_words}")
    print(f"total postings     : {stats.postings}")
    print(f"merge groups       : {len(index.normalized_to_entries)}")
    return 0


def cmd_build_db(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    err = _require_input(cfg)
    if err is not None:
        return err
    ensure_output_dir(cfg.output_dir)
    entries, _, _ = _stream_and_strip(cfg)
    index = build_index(entries, stopwords=cfg.stopwords)
    db_path = output_path(cfg.output_dir, DB_FILENAME)
    size = build_database(db_path, entries, index)
    print(f"wrote {db_path} ({size} bytes)")
    return 0


def cmd_bktree_en(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    err = _require_input(cfg)
    if err is not None:
        return err
    ensure_output_dir(cfg.output_dir)
    entries, _, _ = _stream_and_strip(cfg)
    index = build_index(entries, stopwords=cfg.stopwords)
    tree = build_english_bktree(index)
    out = output_path(cfg.output_dir, BKTREE_EN_FILENAME)
    size = write_english_bktree(out, tree)
    print(f"wrote {out} ({size} bytes, {len(tree)} nodes)")
    return 0


def cmd_bktree_my(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    err = _require_input(cfg)
    if err is not None:
        return err
    ensure_output_dir(cfg.output_dir)
    entries, _, _ = _stream_and_strip(cfg)
    tree = build_burmese_bktree(entries)
    out = output_path(cfg.output_dir, BKTREE_MY_FILENAME)
    size = write_burmese_bktree(out, tree)
    print(f"wrote {out} ({size} bytes, {len(tree)} nodes)")
    return 0


def cmd_version(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    ensure_output_dir(cfg.output_dir)
    version = build_version_string()
    out = output_path(cfg.output_dir, VERSION_FILENAME)
    size = write_version_stamp(out, version)
    print(f"version {version} -> {out} ({size} bytes)")
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    """Standalone report: rebuild the full pipeline once, then print."""
    cfg = _config_from_args(args)
    err = _require_input(cfg)
    if err is not None:
        return err
    return _run_all(cfg)


def cmd_all(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    err = _require_input(cfg)
    if err is not None:
        return err
    return _run_all(cfg)


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
        print(f"[{step_name}] stub: not yet implemented")
        return 0

    _run.__name__ = f"cmd_{step_name.replace('-', '_')}"
    return _run


def _run_all(cfg: PipelineConfig) -> int:
    """Run the full implemented pipeline.

    Streams the JSONL once, then reuses the stripped representation
    across every downstream stage (spec acceptance criterion: avoid
    re-reading the input ~10k-line file once per stage).
    """
    ensure_output_dir(cfg.output_dir)

    logger.info("[strip] stripping entries from %s", cfg.input_path)
    read_stats = ReadStats()
    strip_stats = StripStats()
    entries = list(
        strip_entries(iter_jsonl(cfg.input_path, stats=read_stats), stats=strip_stats)
    )
    if not entries:
        logger.error("strip produced 0 entries; aborting")
        return 1

    logger.info("[index-en] building inverted index")
    index_stats = IndexStats()
    index = build_index(entries, stopwords=cfg.stopwords, stats=index_stats)

    logger.info("[merge-g2p] skipped — not implemented in this task")
    print("[merge-g2p] skipped (not yet implemented)")

    logger.info("[build-db] writing SQLite database")
    db_path = output_path(cfg.output_dir, DB_FILENAME)
    build_database(db_path, entries, index)

    logger.info("[convert-ngram] skipped — not implemented in this task")
    print("[convert-ngram] skipped (not yet implemented)")

    logger.info("[bktree-en] building English BK-tree")
    en_tree = build_english_bktree(index)
    en_path = output_path(cfg.output_dir, BKTREE_EN_FILENAME)
    write_english_bktree(en_path, en_tree)

    logger.info("[bktree-my] building Burmese BK-tree")
    my_tree = build_burmese_bktree(entries)
    my_path = output_path(cfg.output_dir, BKTREE_MY_FILENAME)
    write_burmese_bktree(my_path, my_tree)

    logger.info("[version] writing version stamp")
    version = build_version_string()
    version_path = output_path(cfg.output_dir, VERSION_FILENAME)
    write_version_stamp(version_path, version)

    logger.info("[report] summarizing")
    report = PipelineReport(
        raw_entries=read_stats.parsed,
        stripped_entries=strip_stats.stripped,
        distinct_headwords=strip_stats.distinct_headwords,
        empty_glosses=strip_stats.empty_glosses,
        distinct_words=index_stats.distinct_words,
        total_postings=index_stats.postings,
        asset_sizes=measure_asset_sizes(
            {
                DB_FILENAME: db_path,
                BKTREE_EN_FILENAME: en_path,
                BKTREE_MY_FILENAME: my_path,
                VERSION_FILENAME: version_path,
            }
        ),
        version=version,
    )
    for line in report.to_lines():
        print(line)
    return 0


HANDLERS: dict[str, Callable[[argparse.Namespace], int]] = {
    "load": cmd_load,
    "strip": cmd_strip,
    "index-en": cmd_index_en,
    "build-db": cmd_build_db,
    "bktree-en": cmd_bktree_en,
    "bktree-my": cmd_bktree_my,
    "version": cmd_version,
    "report": cmd_report,
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
        help="Run every implemented pipeline step in order (spec §6).",
        description=(
            "Run strip → index-en → build-db → bktree-en → bktree-my → "
            "version → report against a single streaming pass over the "
            "input file. merge-g2p and convert-ngram are skipped (stubs)."
        ),
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
