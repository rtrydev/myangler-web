#!/usr/bin/env python
"""Download the EngMyanDictionary HuggingFace dataset, text columns only.

This script is **build-time tooling**. The core ``data_pipeline`` package
remains stdlib-only — its ``engmyan`` step reads from a local JSONL file
this script produces, so the runtime pipeline never depends on
HuggingFace libraries or network access.

Usage::

    python tools/data-pipeline/scripts/download_engmyan.py
    # writes data/engmyan/engmyan.jsonl (git-ignored)

The dataset ships HTML + raw text plus two large PNG columns. We
**explicitly drop the image columns** (~950 MB combined) and keep only
the text columns the ``engmyan`` inversion step consumes. The shipped
``dictionary.sqlite`` must never contain images — that constraint lives
in ``docs/burmese-dictionary-spec.md`` §3.1 and is enforced both here
(text-only projection) and in the pipeline's size guard.

Optional dependencies (install separately):

  pip install "huggingface_hub>=0.24" "pyarrow>=15.0"

Both are dev-time only. If they are not importable, the script prints a
clean instruction and exits 1 — no stack trace at the user.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DATASET_REPO_ID = "chuuhtetnaing/english-myanmar-dictionary-dataset-EngMyanDictionary"

# Columns the pipeline consumes. Everything else (including the two PNG
# blob columns) is dropped at download time so the working text never
# touches the disk in its full ~950 MB form.
TEXT_COLUMNS: tuple[str, ...] = (
    "word",
    "stripword",
    "title",
    "definition",
    "raw_definition",
    "keywords",
    "synonym",
)

# Columns we MUST NOT export. Listed explicitly so a future schema
# change surfaces here rather than silently leaking image bytes into the
# shipped bundle.
FORBIDDEN_COLUMNS: tuple[str, ...] = ("image_definition", "picture")


def _resolve_repo_root() -> Path:
    here = Path(__file__).resolve()
    for candidate in (here, *here.parents):
        if (candidate / ".git").exists():
            return candidate
    return here.parents[3]


def _require_optional_deps() -> tuple[object, object]:
    """Import the optional deps with a clean failure message."""
    try:
        from huggingface_hub import snapshot_download  # type: ignore[import-not-found]
    except ImportError as exc:
        print(
            "error: this downloader needs huggingface_hub. Install with:\n"
            "  pip install 'huggingface_hub>=0.24' 'pyarrow>=15.0'",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc
    try:
        import pyarrow.parquet as pq  # type: ignore[import-not-found]
    except ImportError as exc:
        print(
            "error: this downloader needs pyarrow. Install with:\n"
            "  pip install 'pyarrow>=15.0'",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc
    return snapshot_download, pq


def _download_parquets(snapshot_download, cache_dir: Path) -> Path:
    """Download dataset shards into ``cache_dir`` and return its path.

    Restricts the download to parquet files under ``data/`` so we never
    pull the README / images / lfs artifacts we don't need.
    """
    return Path(
        snapshot_download(
            repo_id=DATASET_REPO_ID,
            repo_type="dataset",
            cache_dir=str(cache_dir),
            allow_patterns=["data/*.parquet", "*.parquet"],
        )
    )


def _iter_rows(snapshot_dir: Path, pq):
    """Yield row dicts from every parquet file in ``snapshot_dir``.

    Projects to ``TEXT_COLUMNS`` so the image columns never materialize
    in memory.
    """
    parquet_files = sorted(snapshot_dir.rglob("*.parquet"))
    if not parquet_files:
        print(
            f"error: no parquet files found under {snapshot_dir}.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    for pf in parquet_files:
        table = pq.read_table(pf, columns=list(TEXT_COLUMNS))
        # Sanity-check that no forbidden column slipped through.
        for forbidden in FORBIDDEN_COLUMNS:
            if forbidden in table.column_names:
                print(
                    f"error: forbidden column '{forbidden}' present in "
                    f"{pf}; refusing to export (would ship images).",
                    file=sys.stderr,
                )
                raise SystemExit(2)
        for batch in table.to_batches():
            cols = {name: batch.column(name).to_pylist() for name in batch.column_names}
            num_rows = batch.num_rows
            for i in range(num_rows):
                yield {name: cols[name][i] for name in cols}


def _write_jsonl(rows, out_path: Path) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with out_path.open("w", encoding="utf-8") as fh:
        for row in rows:
            # Normalize None → "" so the downstream parser does not have
            # to special-case nulls.
            clean = {k: ("" if v is None else v) for k, v in row.items()}
            fh.write(json.dumps(clean, ensure_ascii=False))
            fh.write("\n")
            written += 1
    return written


def main(argv: list[str] | None = None) -> int:
    repo_root = _resolve_repo_root()
    default_out = repo_root / "data" / "engmyan" / "engmyan.jsonl"
    default_cache = repo_root / "data" / "engmyan" / ".hf-cache"

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=str(default_out),
        help=f"output JSONL path (default: {default_out})",
    )
    parser.add_argument(
        "--cache-dir",
        default=str(default_cache),
        help=f"HuggingFace snapshot cache dir (default: {default_cache})",
    )
    args = parser.parse_args(argv)

    snapshot_download, pq = _require_optional_deps()
    out_path = Path(args.out).resolve()
    cache_dir = Path(args.cache_dir).resolve()

    print(f"downloading {DATASET_REPO_ID} parquet shards to {cache_dir}...")
    snapshot_dir = _download_parquets(snapshot_download, cache_dir)
    print(f"reading rows from {snapshot_dir}")
    written = _write_jsonl(_iter_rows(snapshot_dir, pq), out_path)
    size = out_path.stat().st_size
    print(f"wrote {written:,} rows to {out_path} ({size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
