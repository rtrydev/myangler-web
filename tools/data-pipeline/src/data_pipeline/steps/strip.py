"""Strip step (spec §6.2).

Reduces raw kaikki entries to the minimal in-memory shape the rest of the
pipeline consumes: headword, part of speech, the list of glosses across all
senses, a parallel list of normalized glosses, and optional IPA.

Glosses are kept as a list so the app can render multiple meanings; the
normalized form (spec §2.4.1: lowercase, trim, strip leading ``"to "``) is
computed alongside the original so indexing and merging stages do not have
to re-derive it.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from data_pipeline.io import ReadStats, iter_jsonl

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StrippedEntry:
    """One Burmese entry, reduced to the fields the app needs.

    ``glosses`` is the display-form list (one element per gloss, preserving
    sense order). ``normalized_glosses`` is the same list run through
    :func:`normalize_gloss` and is parallel-indexed with ``glosses``.

    ``entry_id`` is a stable 0-based index assigned during stripping. The
    SQLite ``entries`` table uses it as its primary key and the inverted
    index references it.
    """

    entry_id: int
    headword: str
    pos: str
    glosses: tuple[str, ...]
    normalized_glosses: tuple[str, ...]
    ipa: str | None = None


@dataclass
class StripStats:
    """Summary of a strip pass."""

    raw_entries: int = 0
    stripped: int = 0
    distinct_headwords: int = 0
    empty_glosses: int = 0
    missing_headword: int = 0
    headwords: set[str] = field(default_factory=set)


def normalize_gloss(gloss: str) -> str:
    """Normalize a gloss for matching/merging (spec §2.4.1).

    Lowercase, collapse internal whitespace, strip a leading ``"to "``.
    """
    text = gloss.strip().lower()
    text = " ".join(text.split())
    if text.startswith("to "):
        text = text[3:].lstrip()
    return text


def _extract_glosses(entry: dict[str, Any]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Pull glosses across every sense; return (display, normalized).

    A sense may carry multiple glosses; each is treated as its own gloss
    entry so merging by identical normalized gloss works the same way
    regardless of how kaikki packed the senses.
    """
    display: list[str] = []
    normalized: list[str] = []
    for sense in entry.get("senses") or []:
        for raw in sense.get("glosses") or []:
            if not isinstance(raw, str):
                continue
            stripped = raw.strip()
            if not stripped:
                continue
            norm = normalize_gloss(stripped)
            if not norm:
                continue
            display.append(stripped)
            normalized.append(norm)
    return tuple(display), tuple(normalized)


def _extract_ipa(entry: dict[str, Any]) -> str | None:
    """Take the first IPA value from ``sounds`` if cheaply available."""
    for sound in entry.get("sounds") or []:
        ipa = sound.get("ipa") if isinstance(sound, dict) else None
        if isinstance(ipa, str) and ipa.strip():
            return ipa.strip()
    return None


def strip_entries(
    raw_entries: Iterable[dict[str, Any]],
    *,
    stats: StripStats | None = None,
) -> Iterator[StrippedEntry]:
    """Reduce raw kaikki entries to :class:`StrippedEntry` instances.

    Entries that lack a usable headword are logged and dropped — they
    cannot be looked up by anything. Entries with no usable glosses are
    *kept* (the headword is still a valid Burmese fuzzy-search target);
    they appear with empty gloss tuples and are counted.
    """
    local = stats if stats is not None else StripStats()
    next_id = 0
    for raw in raw_entries:
        local.raw_entries += 1
        headword = raw.get("word")
        if not isinstance(headword, str) or not headword.strip():
            local.missing_headword += 1
            logger.warning("dropping entry without headword: %r", raw.get("pos"))
            continue
        headword = headword.strip()
        pos = raw.get("pos") or ""
        if not isinstance(pos, str):
            pos = str(pos)
        display, normalized = _extract_glosses(raw)
        if not display:
            local.empty_glosses += 1
        entry = StrippedEntry(
            entry_id=next_id,
            headword=headword,
            pos=pos,
            glosses=display,
            normalized_glosses=normalized,
            ipa=_extract_ipa(raw),
        )
        next_id += 1
        local.stripped += 1
        local.headwords.add(headword)
        yield entry
    local.distinct_headwords = len(local.headwords)


def strip_file(path: Path) -> tuple[list[StrippedEntry], StripStats, ReadStats]:
    """Stream ``path`` and return the full list of stripped entries.

    Used by the CLI when ``strip`` runs standalone. ``all`` calls
    :func:`strip_entries` directly on a shared :func:`iter_jsonl` stream
    so the file is only read once.
    """
    read_stats = ReadStats()
    strip_stats = StripStats()
    entries = list(strip_entries(iter_jsonl(path, stats=read_stats), stats=strip_stats))
    return entries, strip_stats, read_stats
