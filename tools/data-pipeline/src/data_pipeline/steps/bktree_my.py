"""Burmese BK-tree build step (spec §6.8).

Builds a **syllable-level** BK-tree over every distinct Burmese headword.
Each headword is segmented into a tuple of syllables (so the BK-tree key
type is ``tuple[str, ...]``); edit distance is then computed over the
syllable sequences rather than raw codepoints — the spec §2.5 requirement
that one-syllable typos register as distance 1.

Serialized form: ``bktree/v1``. Headwords land in the tree as JSON
arrays-of-syllables; the frontend joins them back to the headword string
for display and uses the same syllable segmenter (a JS port of
:mod:`data_pipeline.syllable`) on the query.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable
from pathlib import Path

from data_pipeline.bktree import BKTree, edit_distance
from data_pipeline.steps.strip import StrippedEntry
from data_pipeline.syllable import segment_syllables

logger = logging.getLogger(__name__)


def _syllable_distance(a: tuple[str, ...], b: tuple[str, ...]) -> int:
    # edit_distance works on any indexable sequence with __eq__; tuples
    # of syllable strings satisfy that.
    return edit_distance(a, b)


def build_burmese_bktree(entries: Iterable[StrippedEntry]) -> BKTree[tuple[str, ...]]:
    tree: BKTree[tuple[str, ...]] = BKTree(_syllable_distance)
    seen: set[tuple[str, ...]] = set()
    keys: list[tuple[str, ...]] = []
    for hw in sorted({e.headword for e in entries}):
        syls = tuple(segment_syllables(hw))
        if not syls or syls in seen:
            continue
        seen.add(syls)
        keys.append(syls)
    # Shuffle with a fixed seed so the BK-tree is balanced enough not to
    # degenerate into a deep chain, while remaining deterministic.
    import random

    random.Random(0xBEEF).shuffle(keys)
    for k in keys:
        tree.insert(k)
    return tree


def write_burmese_bktree(path: Path, tree: BKTree[tuple[str, ...]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = tree.to_json_obj()
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    return path.stat().st_size
