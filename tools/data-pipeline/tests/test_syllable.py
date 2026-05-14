"""Tests for the Burmese syllable segmenter (spec §4.1)."""

from __future__ import annotations

import pytest

from data_pipeline.syllable import segment_syllables


@pytest.mark.parametrize(
    "text, expected",
    [
        ("", []),
        ("က", ["က"]),
        # "Myanmar": မြန် + မာ. The န+asat closes the previous syllable.
        ("မြန်မာ", ["မြန်", "မာ"]),
        # "ne kaung lar?" (how are you) — three syllables, the second is a
        # closed syllable with a tone mark.
        ("နေကောင်းလား", ["နေ", "ကောင်း", "လား"]),
        # Stacked consonant via U+1039 virama: stays a single cluster.
        ("အင်္ဂါ", ["အင်္ဂါ"]),
        # Wikipedia: 5 syllables.
        ("ဝီကီပိဒိယ", ["ဝီ", "ကီ", "ပိ", "ဒိ", "ယ"]),
        # Digits are emitted one per syllable so the segmenter is total.
        ("၁၂၃", ["၁", "၂", "၃"]),
    ],
)
def test_segment_known_words(text: str, expected: list[str]) -> None:
    assert segment_syllables(text) == expected


def test_segment_mixed_script_keeps_foreign_chars_singleton() -> None:
    # ASCII / punctuation each get their own "syllable" so mixed input
    # still tokenizes; the BK-tree just sees the foreign chars as a
    # different cluster.
    assert segment_syllables("က x ခ") == ["က", " ", "x", " ", "ခ"]


def test_round_trip_is_lossless() -> None:
    text = "နေကောင်းလားအင်္ဂါမြန်မာ"
    assert "".join(segment_syllables(text)) == text
