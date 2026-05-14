"""Tests for the English inverted index (spec §6.3 / §2.4)."""

from __future__ import annotations

from data_pipeline.steps.index_en import (
    IndexStats,
    Tier,
    build_index,
    tokenize_gloss_words,
)
from data_pipeline.steps.strip import StrippedEntry


def _entry(eid: int, headword: str, glosses: tuple[str, ...]) -> StrippedEntry:
    from data_pipeline.steps.strip import normalize_gloss

    norm = tuple(normalize_gloss(g) for g in glosses)
    return StrippedEntry(
        entry_id=eid,
        headword=headword,
        pos="noun",
        glosses=glosses,
        normalized_glosses=norm,
    )


def test_tokenize_gloss_words() -> None:
    assert tokenize_gloss_words("go up") == ["go", "up"]
    # Punctuation splits.
    assert tokenize_gloss_words("part of body, body part") == [
        "part",
        "of",
        "body",
        "body",
        "part",
    ]
    # Inner apostrophes survive, but boundary apostrophes don't.
    assert tokenize_gloss_words("don't 'go'") == ["don't", "go"]
    # Hyphens split.
    assert tokenize_gloss_words("brother-in-law") == ["brother", "in", "law"]


def test_index_assigns_exact_head_incidental_tiers() -> None:
    entries = [
        _entry(0, "က", ("go",)),          # single-word gloss → EXACT
        _entry(1, "ခ", ("go up",)),       # head "go", incidental "up"
        _entry(2, "ဂ", ("walk away go",)),  # incidental "go" at position 2
    ]
    index = build_index(entries, stopwords=frozenset())
    postings = {p.entry_id: p.tier for p in index.postings_by_word["go"]}
    assert postings == {
        0: Tier.EXACT,
        1: Tier.HEAD,
        2: Tier.INCIDENTAL,
    }


def test_index_excludes_stopwords() -> None:
    entries = [
        _entry(0, "က", ("to go up",)),  # normalized: "go up"
        _entry(1, "ခ", ("a thing of beauty",)),
    ]
    index = build_index(
        entries,
        stopwords=frozenset({"a", "the", "of"}),
    )
    # Stopwords absent from the postings keys.
    assert "a" not in index.postings_by_word
    assert "of" not in index.postings_by_word
    # Real content words are present.
    assert "go" in index.postings_by_word
    assert "thing" in index.postings_by_word
    assert "beauty" in index.postings_by_word


def test_normalize_strips_leading_to_so_go_and_to_go_collide() -> None:
    entries = [
        _entry(0, "က", ("to go",)),  # normalized "go" — exact tier
        _entry(1, "ခ", ("go",)),     # normalized "go" — exact tier
    ]
    index = build_index(entries, stopwords=frozenset())
    postings = index.postings_by_word["go"]
    # Both entries land as exact-tier postings under the same gloss-word.
    assert sorted(p.entry_id for p in postings) == [0, 1]
    assert all(p.tier == Tier.EXACT for p in postings)
    # And the merge group for normalized "go" lists both.
    assert sorted(index.normalized_to_entries["go"]) == [0, 1]


def test_index_stats_are_populated() -> None:
    entries = [
        _entry(0, "က", ("go", "to walk")),
    ]
    stats = IndexStats()
    build_index(entries, stopwords=frozenset({"a"}), stats=stats)
    assert stats.glosses_indexed == 2
    assert stats.tokens_seen == 2  # "go", "walk" (the leading "to" was stripped)
    assert stats.distinct_words == 2  # "go", "walk"
