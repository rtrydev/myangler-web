"""Command-line interface for the data pipeline.

Each pipeline step from spec §6 is exposed as its own subcommand; the
``all`` command runs every implemented step in dependency order against
a single streamed pass over the input file.

Primary input is the **EngMyanDictionary** HuggingFace dataset, ingested
and inverted into Burmese-keyed entries by the ``engmyan`` step. The
legacy kaikki ``strip`` step is preserved as a standalone subcommand for
back-compat / regression testing but is not part of the default chain.

``merge-g2p`` remains a logging-only stub.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from data_pipeline import __version__
from data_pipeline.config import (
    BKTREE_EN_FILENAME,
    BKTREE_MY_FILENAME,
    DB_FILENAME,
    DEFAULT_INPUT_PATH,
    DEFAULT_NGRAM_DIR,
    DEFAULT_OUTPUT_DIR,
    LEGACY_KAIKKI_INPUT_PATH,
    MAX_DB_SIZE_BYTES,
    NGRAM_FILENAME,
    VERSION_FILENAME,
    PipelineConfig,
)
from data_pipeline.io import ReadStats, ensure_output_dir, iter_jsonl, output_path
from data_pipeline.steps.bktree_en import build_english_bktree, write_english_bktree
from data_pipeline.steps.bktree_my import build_burmese_bktree, write_burmese_bktree
from data_pipeline.steps.build_db import build_database
from data_pipeline.steps.convert_ngram import (
    MissingNgramInputError,
    NgramStats,
    convert_ngram_to_default,
)
from data_pipeline.steps.engmyan import EngmyanStats, invert_engmyan
from data_pipeline.steps.index_en import IndexStats, build_index
from data_pipeline.steps.merge import MergeStats, merge_dictionaries
from data_pipeline.steps.report import (
    NgramReport,
    PipelineReport,
    measure_asset_sizes,
    measure_asset_sizes_gzipped,
)
from data_pipeline.steps.strip import StripStats, strip_entries
from data_pipeline.steps.version import build_version_string, write_version_stamp

logger = logging.getLogger("data_pipeline")


# Ordered list of (subcommand, help text). Order is the order ``all`` runs
# them in — mirrors spec §6 steps 2–10. ``merge-g2p`` remains a stub.
PIPELINE_STEPS: list[tuple[str, str]] = [
    ("load", "Load and validate the EngMyanDictionary JSONL extract."),
    (
        "engmyan",
        "Ingest the EngMyanDictionary dataset and invert it into Burmese-keyed "
        "entries (spec §6.2 — replaces the legacy ``strip`` step).",
    ),
    (
        "strip",
        "Legacy kaikki strip step (back-compat for tests; no longer in `all`).",
    ),
    ("index-en", "Build the English inverted index (spec §6.3)."),
    ("merge-g2p", "Optionally merge the myG2P headword list (spec §6.4)."),
    ("build-db", "Build, index, and VACUUM the SQLite database (spec §6.5)."),
    ("convert-ngram", "Convert myWord n-gram dictionaries to JS-loadable form (spec §6.6)."),
    ("bktree-en", "Build the English BK-tree (spec §6.7)."),
    ("bktree-my", "Build the Burmese BK-tree (spec §6.8)."),
    ("version", "Emit the version stamp (spec §6.9)."),
    ("report", "Report final entry count and asset sizes (spec §6.10)."),
]

# Steps `all` actually runs (in this order). ``merge-g2p`` remains a stub.
# Note ``strip`` is intentionally absent — the EngMyanDictionary
# ingestion+inversion (``engmyan``) replaces it as the dictionary source.
ALL_STEPS: tuple[str, ...] = (
    "engmyan",
    "index-en",
    "build-db",
    "convert-ngram",
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
        ngram_dir=Path(args.ngram_dir).resolve(),
        kaikki_input_path=Path(args.kaikki_input).resolve(),
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


def _stream_and_invert(cfg: PipelineConfig) -> tuple[list, EngmyanStats, ReadStats]:
    """Primary input loader: EngMyanDictionary JSONL → Burmese-keyed entries."""
    read_stats = ReadStats()
    invert_stats = EngmyanStats()
    entries = list(
        invert_engmyan(
            iter_jsonl(cfg.input_path, stats=read_stats),
            stats=invert_stats,
        )
    )
    return entries, invert_stats, read_stats


def _stream_and_strip(cfg: PipelineConfig) -> tuple[list, StripStats, ReadStats]:
    """Legacy loader for the kaikki JSONL; back-compat only.

    The ``strip`` subcommand still uses this so existing fixture tests
    keep working; ``all`` switched to :func:`_stream_and_invert`.
    """
    read_stats = ReadStats()
    strip_stats = StripStats()
    entries = list(
        strip_entries(iter_jsonl(cfg.input_path, stats=read_stats), stats=strip_stats)
    )
    return entries, strip_stats, read_stats


def cmd_engmyan(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    err = _require_input(cfg)
    if err is not None:
        # Mirror convert-ngram's pattern: actionable instruction, no
        # stack trace at the user.
        logger.error(
            "EngMyanDictionary input not found at %s.\n"
            "Fetch it with: python tools/data-pipeline/scripts/download_engmyan.py",
            cfg.input_path,
        )
        return 1
    ensure_output_dir(cfg.output_dir)
    entries, invert_stats, read_stats = _stream_and_invert(cfg)
    print(f"raw rows           : {read_stats.parsed}")
    print(f"malformed skipped  : {read_stats.skipped}")
    print(f"dropped (no Burmese): {invert_stats.dropped_no_burmese}")
    print(f"Burmese terms (pre-merge): {invert_stats.burmese_terms_emitted}")
    print(f"distinct headwords : {invert_stats.distinct_headwords}")
    print(f"emitted entries    : {invert_stats.stripped}")
    print(f"empty glosses      : {invert_stats.empty_glosses}")
    print(f"pos inferred       : {invert_stats.pos_inferred}")
    return 0 if entries else 1


def cmd_strip(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    # `strip` is back-compat only — default it to the legacy kaikki
    # input so existing workflows keep working.
    if cfg.input_path == DEFAULT_INPUT_PATH:
        cfg = PipelineConfig(
            input_path=LEGACY_KAIKKI_INPUT_PATH,
            output_dir=cfg.output_dir,
            myg2p_path=cfg.myg2p_path,
            ngram_dir=cfg.ngram_dir,
            fuzzy_threshold_en=cfg.fuzzy_threshold_en,
            fuzzy_threshold_my=cfg.fuzzy_threshold_my,
            stopwords=cfg.stopwords,
        )
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
    entries, _, _ = _stream_and_invert(cfg)
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


def _check_db_size(size: int) -> int:
    """Bundle safety net: fail loudly if `dictionary.sqlite` is huge.

    EngMyanDictionary's image columns would balloon the bundle if a
    future change re-introduces them. The ``engmyan`` ingestion step
    and downloader explicitly exclude images, so a DB beyond the
    ceiling signals a real regression — exit 1 with a pointer.
    """
    if size > MAX_DB_SIZE_BYTES:
        logger.error(
            "dictionary.sqlite is %d bytes — exceeds %d-byte safety ceiling. "
            "Suspect: image columns leaked through. See docs/burmese-dictionary-spec.md §3.1.",
            size,
            MAX_DB_SIZE_BYTES,
        )
        return 1
    return 0


def cmd_build_db(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    err = _require_input(cfg)
    if err is not None:
        return err
    ensure_output_dir(cfg.output_dir)
    entries, _, _ = _stream_and_invert(cfg)
    index = build_index(entries, stopwords=cfg.stopwords)
    db_path = output_path(cfg.output_dir, DB_FILENAME)
    size = build_database(db_path, entries, index)
    print(f"wrote {db_path} ({size} bytes)")
    return _check_db_size(size)


def cmd_bktree_en(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    err = _require_input(cfg)
    if err is not None:
        return err
    ensure_output_dir(cfg.output_dir)
    entries, _, _ = _stream_and_invert(cfg)
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
    entries, _, _ = _stream_and_invert(cfg)
    tree = build_burmese_bktree(entries)
    out = output_path(cfg.output_dir, BKTREE_MY_FILENAME)
    size = write_burmese_bktree(out, tree)
    print(f"wrote {out} ({size} bytes, {len(tree)} nodes)")
    return 0


def cmd_convert_ngram(args: argparse.Namespace) -> int:
    cfg = _config_from_args(args)
    ensure_output_dir(cfg.output_dir)
    try:
        stats = convert_ngram_to_default(cfg.ngram_dir, cfg.output_dir)
    except MissingNgramInputError as exc:
        # The exception's message is the user-facing instruction; print and
        # exit cleanly without a stack trace.
        print(f"error: {exc}", file=sys.stderr)
        return 1
    out = output_path(cfg.output_dir, NGRAM_FILENAME)
    print(f"wrote {out} ({stats.output_size} bytes, {stats.output_size_gzipped} gz)")
    print(f"unigrams           : {stats.unigram_count:,}")
    print(f"bigrams            : {stats.bigram_count:,}")
    print(f"unigram total count: {stats.unigram_total:,}")
    print(f"bigram total count : {stats.bigram_total:,}")
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

    Streams the JSONL once, then reuses the inverted representation
    across every downstream stage (spec acceptance criterion: avoid
    re-reading the input file once per stage).
    """
    ensure_output_dir(cfg.output_dir)

    logger.info("[engmyan] ingesting + inverting %s", cfg.input_path)
    read_stats = ReadStats()
    invert_stats = EngmyanStats()
    engmyan_entries = list(
        invert_engmyan(
            iter_jsonl(cfg.input_path, stats=read_stats),
            stats=invert_stats,
        )
    )
    if not engmyan_entries:
        logger.error(
            "engmyan produced 0 entries; aborting. "
            "Run: python tools/data-pipeline/scripts/download_engmyan.py"
        )
        return 1

    # Hybrid pass: layer in the legacy kaikki-derived entries when their
    # JSONL is available. kaikki has dedicated POS-specific entries for
    # Burmese grammar particles (``တယ်``, ``တဲ့``, ``ပါ`` as particle,
    # …) that EngMyanDictionary's English-keyed shape cannot capture.
    # See ``steps/merge.py`` for the precedence rules.
    kaikki_entries: list = []
    kaikki_read_stats: ReadStats | None = None
    kaikki_strip_stats: StripStats | None = None
    if cfg.kaikki_input_path.exists():
        logger.info("[kaikki-overlay] stripping legacy %s", cfg.kaikki_input_path)
        kaikki_read_stats = ReadStats()
        kaikki_strip_stats = StripStats()
        kaikki_entries = list(
            strip_entries(
                iter_jsonl(cfg.kaikki_input_path, stats=kaikki_read_stats),
                stats=kaikki_strip_stats,
            )
        )
        logger.info(
            "[kaikki-overlay] %d kaikki entries from %d distinct headwords",
            len(kaikki_entries),
            kaikki_strip_stats.distinct_headwords,
        )
    else:
        logger.info(
            "[kaikki-overlay] %s not present — skipping (engmyan-only build)",
            cfg.kaikki_input_path,
        )

    merge_stats = MergeStats()
    entries = merge_dictionaries(
        kaikki_entries, engmyan_entries, stats=merge_stats
    )
    logger.info(
        "[merge] kaikki kept=%d, engmyan kept=%d (dropped %d as already in kaikki); "
        "total %d distinct headwords",
        merge_stats.kaikki_kept,
        merge_stats.engmyan_kept,
        merge_stats.engmyan_dropped,
        merge_stats.distinct_headwords,
    )

    logger.info("[index-en] building inverted index")
    index_stats = IndexStats()
    index = build_index(entries, stopwords=cfg.stopwords, stats=index_stats)

    logger.info("[merge-g2p] skipped — not implemented in this task")
    print("[merge-g2p] skipped (not yet implemented)")

    logger.info("[build-db] writing SQLite database")
    db_path = output_path(cfg.output_dir, DB_FILENAME)
    db_size = build_database(db_path, entries, index)
    rc = _check_db_size(db_size)
    if rc != 0:
        return rc

    logger.info("[convert-ngram] converting myWord pickled n-grams")
    ngram_path = output_path(cfg.output_dir, NGRAM_FILENAME)
    ngram_stats: NgramStats | None = None
    try:
        ngram_stats = convert_ngram_to_default(cfg.ngram_dir, cfg.output_dir)
    except MissingNgramInputError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

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
    asset_paths: dict[str, Path] = {
        DB_FILENAME: db_path,
        NGRAM_FILENAME: ngram_path,
        BKTREE_EN_FILENAME: en_path,
        BKTREE_MY_FILENAME: my_path,
        VERSION_FILENAME: version_path,
    }
    report = PipelineReport(
        raw_entries=read_stats.parsed,
        stripped_entries=invert_stats.stripped,
        distinct_headwords=invert_stats.distinct_headwords,
        empty_glosses=invert_stats.empty_glosses,
        distinct_words=index_stats.distinct_words,
        total_postings=index_stats.postings,
        asset_sizes=measure_asset_sizes(asset_paths),
        asset_sizes_gzipped=measure_asset_sizes_gzipped(asset_paths),
        version=version,
        ngram=NgramReport(
            raw_unigram_size=ngram_stats.raw_unigram_size,
            raw_bigram_size=ngram_stats.raw_bigram_size,
            unigram_count=ngram_stats.unigram_count,
            bigram_count=ngram_stats.bigram_count,
            unigram_total=ngram_stats.unigram_total,
            bigram_total=ngram_stats.bigram_total,
            output_size=ngram_stats.output_size,
            output_size_gzipped=ngram_stats.output_size_gzipped,
            source_unigram=ngram_stats.source_unigram,
            source_bigram=ngram_stats.source_bigram,
        )
        if ngram_stats is not None
        else None,
    )
    for line in report.to_lines():
        print(line)
    return 0


HANDLERS: dict[str, Callable[[argparse.Namespace], int]] = {
    "load": cmd_load,
    "engmyan": cmd_engmyan,
    "strip": cmd_strip,
    "index-en": cmd_index_en,
    "build-db": cmd_build_db,
    "convert-ngram": cmd_convert_ngram,
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
        help=(
            "path to the EngMyanDictionary JSONL extract "
            "(default: %(default)s). The ``strip`` subcommand falls back to "
            "the legacy kaikki path when this flag is left at the default."
        ),
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="directory built assets are written to (default: %(default)s)",
    )
    parser.add_argument(
        "--ngram-dir",
        default=str(DEFAULT_NGRAM_DIR),
        help=(
            "directory holding the myWord pickled n-gram dictionaries "
            "(unigram-word.bin, bigram-word.bin) — see README (default: %(default)s)"
        ),
    )
    parser.add_argument(
        "--kaikki-input",
        default=str(LEGACY_KAIKKI_INPUT_PATH),
        help=(
            "path to the optional kaikki Burmese JSONL extract. When the "
            "file exists, ``all`` layers its entries onto the EngMyan-"
            "derived ones — kaikki takes precedence on shared headwords, "
            "so its dedicated POS-specific particle entries lead. Point "
            "at a non-existent path to disable (default: %(default)s)."
        ),
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
            "Run engmyan → index-en → build-db → convert-ngram → bktree-en → "
            "bktree-my → version → report against a single streaming pass "
            "over the input file. merge-g2p is skipped (stub). The legacy "
            "``strip`` step (kaikki-derived) is no longer in the default "
            "chain — see docs/burmese-dictionary-spec.md §3.1 for the "
            "data-source migration."
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
