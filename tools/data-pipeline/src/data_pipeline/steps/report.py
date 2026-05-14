"""Final reporting step (spec §6.10).

Prints a human-readable summary of the build: entry counts, distinct
headwords, empty-gloss count, inverted-index size, and on-disk sizes of
every produced asset. Intended for the maintainer's terminal — not a
machine-readable format.

The n-gram block is given prominent placement: spec §4.2.3 calls out the
asset's size as the dominant factor in the precached PWA payload, and the
pruning decision (spec §6 step 6, deferred) needs the unigram/bigram
counts and uncompressed/gzipped sizes side-by-side with the rest of the
shipped assets.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class NgramReport:
    """Reportable subset of the n-gram conversion stats."""

    raw_unigram_size: int = 0
    raw_bigram_size: int = 0
    unigram_count: int = 0
    bigram_count: int = 0
    unigram_total: int = 0
    bigram_total: int = 0
    output_size: int = 0
    output_size_gzipped: int = 0
    source_unigram: Path | None = None
    source_bigram: Path | None = None


@dataclass
class PipelineReport:
    raw_entries: int
    stripped_entries: int
    distinct_headwords: int
    empty_glosses: int
    distinct_words: int
    total_postings: int
    asset_sizes: dict[str, int]  # path → size in bytes
    version: str
    ngram: NgramReport | None = None
    asset_sizes_gzipped: dict[str, int] = field(default_factory=dict)

    def to_lines(self) -> list[str]:
        lines: list[str] = [
            "=== Build report ===",
            f"version stamp           : {self.version}",
            f"raw entries             : {self.raw_entries}",
            f"stripped entries        : {self.stripped_entries}",
            f"distinct headwords      : {self.distinct_headwords}",
            f"entries w/ empty glosses: {self.empty_glosses}",
            f"distinct gloss-words    : {self.distinct_words}",
            f"total postings          : {self.total_postings}",
        ]

        if self.ngram is not None:
            ng = self.ngram
            lines.extend(
                [
                    "",
                    "=== n-gram dictionary (spec §4.2 — Viterbi segmenter input) ===",
                    f"  raw unigram pickle    : {_human_size(ng.raw_unigram_size)} "
                    f"({ng.raw_unigram_size:,} bytes)"
                    + (f"  [{ng.source_unigram}]" if ng.source_unigram else ""),
                    f"  raw bigram pickle     : {_human_size(ng.raw_bigram_size)} "
                    f"({ng.raw_bigram_size:,} bytes)"
                    + (f"  [{ng.source_bigram}]" if ng.source_bigram else ""),
                    f"  unigram entries       : {ng.unigram_count:,}",
                    f"  bigram entries        : {ng.bigram_count:,}",
                    f"  unigram total count   : {ng.unigram_total:,}",
                    f"  bigram total count    : {ng.bigram_total:,}",
                    f"  converted asset       : {_human_size(ng.output_size)} "
                    f"({ng.output_size:,} bytes)",
                    f"  converted gzipped     : {_human_size(ng.output_size_gzipped)} "
                    f"({ng.output_size_gzipped:,} bytes)",
                ]
            )

        lines.append("")
        lines.append("=== shipped assets (precached by service worker, spec §5.1) ===")
        total = 0
        total_gz = 0
        for name, size in self.asset_sizes.items():
            total += size
            gz = self.asset_sizes_gzipped.get(name, 0)
            total_gz += gz
            gz_part = f" / gz {_human_size(gz)}" if gz else ""
            lines.append(
                f"  {name:<22} {_human_size(size):>10} ({size:>12,} bytes){gz_part}"
            )
        lines.append(
            f"  {'TOTAL precache':<22} {_human_size(total):>10} ({total:>12,} bytes)"
            + (f" / gz {_human_size(total_gz)}" if total_gz else "")
        )
        return lines


def _human_size(n: int) -> str:
    units = ["B", "KiB", "MiB", "GiB"]
    size = float(n)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{n} B"


def measure_asset_sizes(paths: dict[str, Path]) -> dict[str, int]:
    sizes: dict[str, int] = {}
    for name, path in paths.items():
        sizes[name] = path.stat().st_size if path.exists() else 0
    return sizes


def measure_asset_sizes_gzipped(paths: dict[str, Path]) -> dict[str, int]:
    """Gzipped-on-disk size of each asset (report-only, spec §6 step 6).

    Reads each file once and re-compresses in memory; the raw asset on
    disk is NOT touched. Used to inform the eventual service-worker
    payload budget without actually shipping a compressed artifact.
    """
    import gzip
    import io

    sizes: dict[str, int] = {}
    for name, path in paths.items():
        if not path.exists():
            sizes[name] = 0
            continue
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
            with path.open("rb") as fh:
                while True:
                    chunk = fh.read(1 << 20)
                    if not chunk:
                        break
                    gz.write(chunk)
        sizes[name] = len(buf.getvalue())
    return sizes
