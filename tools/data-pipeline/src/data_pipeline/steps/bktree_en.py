"""English BK-tree build step (spec §6.7).

Builds a character-level BK-tree over every distinct gloss-word that
made it past stopword removal — the same gloss-words the inverted index
keys on. The frontend uses it for the fuzzy tier of reverse lookup,
querying at the configurable threshold from
:data:`~data_pipeline.config.FUZZY_THRESHOLD_EN`.

Serialized form is the ``bktree/v1`` JSON document described on
:class:`~data_pipeline.bktree.BKTree`.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from data_pipeline.bktree import BKTree, edit_distance
from data_pipeline.steps.index_en import InvertedIndex

logger = logging.getLogger(__name__)


def build_english_bktree(index: InvertedIndex) -> BKTree[str]:
    tree: BKTree[str] = BKTree(edit_distance)
    # Sorted insertion produces long chains (similar prefixes → similar
    # distances), which over thousands of words degenerates the tree.
    # Shuffle with a fixed seed for a more balanced *and* deterministic
    # build.
    import random

    words = sorted(index.postings_by_word.keys())
    random.Random(0xBEEF).shuffle(words)
    for word in words:
        tree.insert(word)
    return tree


def write_english_bktree(path: Path, tree: BKTree[str]) -> int:
    """Serialize ``tree`` to ``path`` as JSON; return file size in bytes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = tree.to_json_obj()
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    return path.stat().st_size
