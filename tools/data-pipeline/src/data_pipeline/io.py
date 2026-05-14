"""Input loading and output path helpers.

The JSONL reader is the only piece of real functionality at the scaffold
stage: every later pipeline step consumes its output. It streams the file
line by line, tolerates malformed lines, and yields parsed entries.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ReadStats:
    """Summary of a JSONL stream pass."""

    parsed: int = 0
    skipped: int = 0


def iter_jsonl(
    path: Path,
    *,
    stats: ReadStats | None = None,
) -> Iterator[dict[str, Any]]:
    """Yield parsed JSON objects from ``path`` one line at a time.

    Malformed lines are logged at warning level and skipped — a single
    bad line must not abort the entire pipeline. Blank lines are silently
    ignored (treated as neither parsed nor skipped).

    Pass a ``ReadStats`` instance to collect counts; the same object is
    mutated as the iterator is consumed.
    """
    local_stats = stats if stats is not None else ReadStats()

    with path.open("r", encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError as exc:
                local_stats.skipped += 1
                logger.warning(
                    "skipping malformed JSONL line %d in %s: %s",
                    lineno,
                    path,
                    exc.msg,
                )
                continue
            local_stats.parsed += 1
            yield entry


def ensure_output_dir(path: Path) -> Path:
    """Create ``path`` (and parents) if missing; return it for chaining."""
    path.mkdir(parents=True, exist_ok=True)
    return path


def output_path(base: Path, name: str) -> Path:
    """Resolve a built asset's destination under ``base``."""
    return base / name
