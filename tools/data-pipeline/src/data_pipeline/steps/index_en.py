"""English inverted index (spec §6.3).

Builds the posting list that powers reverse (English → Burmese) lookup.
For every meaningful gloss-word found in a normalized gloss we record:

  - the ``entry_id`` it points back to,
  - which gloss within the entry it came from,
  - and a **tier flag** (spec §2.4.1) describing how the word relates to
    that gloss:

      * ``EXACT`` — the gloss is exactly one word and that word is the
        query (`"go"` matched against the gloss `"go"`).
      * ``HEAD``  — first gloss-word of a multi-word gloss
        (`"go"` is the head of `"go up"`).
      * ``INCIDENTAL`` — appears somewhere later in the gloss.

The frontend sorts postings exact > head > incidental at query time without
re-parsing glosses, since these flags travel with the postings.

The gloss-word tokenizer is exposed as :func:`tokenize_gloss_words` and is
reused by the English BK-tree (spec §6.7).
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import IntEnum

from data_pipeline.config import ENGLISH_STOPWORDS
from data_pipeline.steps.strip import StrippedEntry

logger = logging.getLogger(__name__)


# Tier values are integers so the SQLite schema can store them compactly
# and the frontend can sort on them directly (lower = better tier).
class Tier(IntEnum):
    EXACT = 0
    HEAD = 1
    INCIDENTAL = 2


# A gloss-word is a run of ASCII letters / digits / inner-apostrophes. We
# strip everything else (parenthetical clarifications, semicolons, etc.).
# Hyphens split — "brother-in-law" yields three words, which matches how
# the user is likely to type.
_WORD_RE = re.compile(r"[a-z0-9](?:[a-z0-9']*[a-z0-9])?")


def tokenize_gloss_words(normalized_gloss: str) -> list[str]:
    """Split a *normalized* gloss into gloss-words.

    Input must already be the normalized form (lowercase, leading ``"to "``
    stripped) so that this function does not duplicate normalization logic
    and stays cheap.
    """
    if not normalized_gloss:
        return []
    return _WORD_RE.findall(normalized_gloss)


@dataclass(frozen=True)
class Posting:
    """One posting in the inverted index.

    A posting always lives under a ``gloss_word`` key in the inverted
    index. ``entry_id`` is the :class:`~data_pipeline.steps.strip.StrippedEntry`
    id. ``gloss_index`` is the index into that entry's ``glosses`` /
    ``normalized_glosses`` tuple so the frontend (or merge logic) can
    point at the specific gloss the match came from.
    """

    entry_id: int
    gloss_index: int
    tier: Tier


@dataclass
class IndexStats:
    """Summary of an index build pass."""

    glosses_indexed: int = 0
    glosses_skipped_empty: int = 0
    tokens_seen: int = 0
    tokens_excluded_stopword: int = 0
    postings: int = 0
    distinct_words: int = 0


@dataclass
class InvertedIndex:
    """In-memory inverted index keyed by gloss-word.

    ``postings_by_word`` maps a gloss-word to its posting list, deduplicated
    so the same (entry, gloss, tier) combination is not stored twice.

    ``normalized_to_entries`` lets reverse lookup resolve the exact-match
    tier (and the result-merging rule in spec §2.4.3) without scanning the
    full posting list: identical normalized glosses point to one entry-id
    group that the frontend renders as a single merged row.
    """

    postings_by_word: dict[str, list[Posting]] = field(default_factory=dict)
    normalized_to_entries: dict[str, list[int]] = field(default_factory=dict)

    def total_postings(self) -> int:
        return sum(len(p) for p in self.postings_by_word.values())


def build_index(
    entries: Iterable[StrippedEntry],
    *,
    stopwords: frozenset[str] = ENGLISH_STOPWORDS,
    stats: IndexStats | None = None,
) -> InvertedIndex:
    """Build the inverted index from a stream of stripped entries."""
    local = stats if stats is not None else IndexStats()
    index = InvertedIndex()
    # Track seen (word, entry_id, gloss_index, tier) so each posting is unique.
    seen: dict[str, set[tuple[int, int, int]]] = {}

    for entry in entries:
        for gloss_index, norm in enumerate(entry.normalized_glosses):
            words = tokenize_gloss_words(norm)
            if not words:
                local.glosses_skipped_empty += 1
                continue
            local.glosses_indexed += 1
            # Result merging anchor: record this entry under its normalized
            # gloss exactly once per entry.
            bucket = index.normalized_to_entries.setdefault(norm, [])
            if not bucket or bucket[-1] != entry.entry_id:
                bucket.append(entry.entry_id)

            is_single_word_gloss = len(words) == 1
            for position, word in enumerate(words):
                local.tokens_seen += 1
                if word in stopwords:
                    local.tokens_excluded_stopword += 1
                    continue
                if is_single_word_gloss:
                    tier = Tier.EXACT
                elif position == 0:
                    tier = Tier.HEAD
                else:
                    tier = Tier.INCIDENTAL

                key = (entry.entry_id, gloss_index, int(tier))
                word_seen = seen.setdefault(word, set())
                if key in word_seen:
                    continue
                word_seen.add(key)
                index.postings_by_word.setdefault(word, []).append(
                    Posting(entry_id=entry.entry_id, gloss_index=gloss_index, tier=tier)
                )

    # Sort each posting list by (tier, entry_id, gloss_index) so the SQLite
    # rows have a predictable order and frontend tier sorting is cheap.
    for postings in index.postings_by_word.values():
        postings.sort(key=lambda p: (int(p.tier), p.entry_id, p.gloss_index))

    local.postings = index.total_postings()
    local.distinct_words = len(index.postings_by_word)
    return index
