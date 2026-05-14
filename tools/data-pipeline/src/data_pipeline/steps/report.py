"""Final reporting step (spec §6.10).

Prints a human-readable summary of the build: entry counts, distinct
headwords, empty-gloss count, inverted-index size, and on-disk sizes of
every produced asset. Intended for the maintainer's terminal — not a
machine-readable format.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


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
            "assets:",
        ]
        for name, size in self.asset_sizes.items():
            lines.append(f"  {name:<22} {_human_size(size)} ({size} bytes)")
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
