"""Tests for the strip step (spec §6.2)."""

from __future__ import annotations

from data_pipeline.steps.strip import (
    StripStats,
    normalize_gloss,
    strip_entries,
)


def test_normalize_gloss_strips_to_prefix_and_lowercases() -> None:
    assert normalize_gloss("To Go") == "go"
    assert normalize_gloss("  To eat ") == "eat"
    # Leading "to" without trailing space is NOT stripped.
    assert normalize_gloss("tomato") == "tomato"
    # Strips internal whitespace runs.
    assert normalize_gloss("Brother  in   law") == "brother in law"


def test_normalize_gloss_handles_empty() -> None:
    assert normalize_gloss("") == ""
    assert normalize_gloss("   ") == ""


def test_strip_entries_extracts_required_fields() -> None:
    raw = [
        {
            "word": "က",
            "pos": "noun",
            "senses": [{"glosses": ["letter"]}],
            "sounds": [{"ipa": "/ka/"}],
        },
        {
            "word": "သွား",
            "pos": "verb",
            "senses": [
                {"glosses": ["to go"]},
                {"glosses": ["to depart"]},
            ],
        },
    ]
    stats = StripStats()
    out = list(strip_entries(raw, stats=stats))

    assert [e.headword for e in out] == ["က", "သွား"]
    assert out[0].pos == "noun"
    assert out[0].glosses == ("letter",)
    assert out[0].normalized_glosses == ("letter",)
    assert out[0].ipa == "/ka/"

    assert out[1].glosses == ("to go", "to depart")
    assert out[1].normalized_glosses == ("go", "depart")
    assert out[1].ipa is None

    assert stats.raw_entries == 2
    assert stats.stripped == 2
    assert stats.distinct_headwords == 2
    assert stats.empty_glosses == 0


def test_strip_entries_keeps_headword_with_empty_glosses() -> None:
    raw = [
        {"word": "ထ", "pos": "noun", "senses": []},
        {"word": "ပ", "pos": "noun", "senses": [{"glosses": []}]},
    ]
    stats = StripStats()
    out = list(strip_entries(raw, stats=stats))

    # Both kept (BK-tree still needs the headwords).
    assert [e.headword for e in out] == ["ထ", "ပ"]
    assert all(e.glosses == () for e in out)
    assert stats.empty_glosses == 2


def test_strip_entries_drops_missing_headword() -> None:
    raw = [
        {"pos": "noun", "senses": [{"glosses": ["x"]}]},          # no word
        {"word": "  ", "pos": "noun", "senses": [{"glosses": ["x"]}]},  # blank
        {"word": "ဂ", "pos": "noun", "senses": [{"glosses": ["x"]}]},
    ]
    stats = StripStats()
    out = list(strip_entries(raw, stats=stats))
    assert [e.headword for e in out] == ["ဂ"]
    assert stats.missing_headword == 2


def test_strip_entries_assigns_sequential_ids() -> None:
    raw = [
        {"word": "က", "pos": "n", "senses": [{"glosses": ["a"]}]},
        {"word": "ခ", "pos": "n", "senses": [{"glosses": ["b"]}]},
        {"word": "ဂ", "pos": "n", "senses": [{"glosses": ["c"]}]},
    ]
    out = list(strip_entries(raw))
    assert [e.entry_id for e in out] == [0, 1, 2]
