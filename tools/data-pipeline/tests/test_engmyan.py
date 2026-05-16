"""Tests for the EngMyanDictionary ingestion + inversion step (spec §3.1).

The critical invariant: every ``StrippedEntry`` produced by this step
has a **Burmese** headword (NFC-normalized) and a list of **short
English counterparts** as glosses — the same shape every downstream
pipeline stage and the entire frontend already expect. These tests
exercise representative dataset rows: multi-sense verb, single-sense
noun, an abbreviation-only row that must NOT leak an English headword,
synonym enrichment, example-sentence rejection, and NFC normalization.
"""

from __future__ import annotations

import unicodedata

from data_pipeline.steps.engmyan import (
    EngmyanStats,
    _extract_pos,
    _html_to_text,
    _split_burmese_candidates,
    invert_engmyan,
)


def _has_burmese(s: str) -> bool:
    return any(0x1000 <= ord(c) <= 0x109F for c in s)


# --- Helpers ---------------------------------------------------------------


def test_extract_pos_from_title_returns_coarse_marker() -> None:
    assert _extract_pos("abandon / ǝ'bændǝn / v") == "v"
    assert _extract_pos("abacus / 'æbǝkǝs / n") == "n"
    assert _extract_pos("abandoned / ǝ'bændǝnd / adj") == "adj"
    assert _extract_pos("abandon / ǝ'bændǝn / v.t.") == "v"
    assert _extract_pos("") == ""
    assert _extract_pos("no pos here") == ""


def test_html_to_text_inserts_separators_at_block_tags() -> None:
    text = _html_to_text("<b>ပထမ</b><br/><b>ဒုတိယ</b>")
    # The two bold runs must be separated so the splitter treats them
    # as distinct candidates.
    assert "ပထမ" in text and "ဒုတိယ" in text
    # And there must be at least one separator between them.
    pos1 = text.index("ပထမ")
    pos2 = text.index("ဒုတိယ")
    assert pos1 < pos2
    assert text[pos1 + len("ပထမ") : pos2].strip(" \t") != "" or "\x01" in text


def test_split_burmese_candidates_splits_on_enumeration_marks() -> None:
    text = "၁။ ပထမ ၂။ ဒုတိယ ၃။ တတိယ"
    candidates = _split_burmese_candidates(text)
    assert candidates == ["ပထမ", "ဒုတိယ", "တတိယ"]


def test_split_burmese_candidates_drops_latin_example_sentences() -> None:
    # A Burmese gloss followed by an English example sentence. The
    # English part lives after a semicolon; the splitter should drop it
    # because it has too many Latin letters and no Burmese.
    text = "သွား; please go to the store now"
    candidates = _split_burmese_candidates(text)
    assert candidates == ["သွား"]


def test_split_burmese_candidates_nfc_normalizes_burmese() -> None:
    # Construct an NFD-style string by sandwiching combining marks; NFC
    # round-trips them into the canonical composed form.
    raw = "က" + unicodedata.normalize("NFD", "ိ")
    candidates = _split_burmese_candidates(raw)
    assert candidates, "NFC normalization dropped the input"
    for c in candidates:
        assert unicodedata.normalize("NFC", c) == c


# --- End-to-end inversion --------------------------------------------------


def test_invert_emits_burmese_headwords_with_english_glosses() -> None:
    rows = [
        {
            "word": "go",
            "title": "go / gou / v",
            "definition": "<i>v.</i> ၁။ <b>သွား</b>; example sentence.",
            "raw_definition": "v. ၁။ သွား; example sentence.",
            "synonym": "depart",
            "keywords": "",
        },
        {
            "word": "Myanmar",
            "title": "Myanmar / mjɑːn'mɑː / n",
            "definition": "<i>n.</i> <b>မြန်မာ</b>",
            "raw_definition": "n. မြန်မာ",
            "synonym": "",
            "keywords": "",
        },
    ]
    stats = EngmyanStats()
    entries = list(invert_engmyan(rows, stats=stats))
    by_hw = {e.headword: e for e in entries}

    # Both Burmese headwords emit.
    assert "သွား" in by_hw
    assert "မြန်မာ" in by_hw
    # English headwords are NEVER emitted.
    for hw in by_hw:
        assert _has_burmese(hw)

    # The "go" row carries an English counterpart + its synonym.
    go = by_hw["သွား"]
    assert "go" in go.glosses
    assert "depart" in go.glosses
    # POS recovered from `title`.
    assert go.pos == "v"
    # IPA is never set under a Burmese headword (the dataset's IPA is for
    # the English word).
    assert go.ipa is None

    # `normalized_glosses` is parallel to `glosses` and goes through
    # `normalize_gloss`.
    assert len(go.normalized_glosses) == len(go.glosses)


def test_invert_merges_duplicate_burmese_terms_across_rows() -> None:
    # Two distinct English headwords ("go", "depart") both point at the
    # same Burmese gloss သွား. Merging must yield ONE entry whose gloss
    # list contains both English counterparts.
    rows = [
        {
            "word": "go",
            "title": "go / gou / v",
            "definition": "<b>သွား</b>",
            "raw_definition": "သွား",
            "synonym": "",
            "keywords": "",
        },
        {
            "word": "depart",
            "title": "depart / dɪ'pɑːt / v",
            "definition": "<b>သွား</b>",
            "raw_definition": "သွား",
            "synonym": "",
            "keywords": "",
        },
    ]
    entries = list(invert_engmyan(rows))
    assert len(entries) == 1
    assert entries[0].headword == "သွား"
    # First-seen order preserved; both English counterparts present.
    assert entries[0].glosses == ("go", "depart")


def test_invert_drops_abbreviation_only_row_with_no_burmese() -> None:
    # An "abbr → abbreviation" row has no Burmese content. It must NOT
    # leak an entry whose headword is "abbr" or "abbreviation".
    rows = [
        {
            "word": "abbr",
            "title": "abbr / ǝ'briː / abbr",
            "definition": "<i>abbr.</i> abbreviation",
            "raw_definition": "abbr. abbreviation",
            "synonym": "",
            "keywords": "",
        },
    ]
    stats = EngmyanStats()
    entries = list(invert_engmyan(rows, stats=stats))
    assert entries == []
    assert stats.dropped_no_burmese == 1


def test_invert_excludes_burmese_runs_polluted_by_long_latin_sentences() -> None:
    # The Burmese gloss is correct, but the segment also contains a
    # long English example sentence. The splitter separates the two and
    # only the clean Burmese gloss is kept.
    rows = [
        {
            "word": "go",
            "title": "go / gou / v",
            "definition": "<b>သွား</b> ❍ Please go to the store right now.",
            "raw_definition": "သွား ❍ Please go to the store right now.",
            "synonym": "",
            "keywords": "",
        }
    ]
    entries = list(invert_engmyan(rows))
    assert len(entries) == 1
    assert entries[0].headword == "သွား"
    # The English example sentence was discarded — only "go" is the gloss.
    assert "go" in entries[0].glosses
    # No Latin trash like "please" or "store" leaked in as a "gloss".
    for g in entries[0].glosses:
        assert " " not in g or all(_has_burmese(part) or part.isalpha() for part in g.split())


def test_invert_recovers_pos_majority_when_rows_disagree() -> None:
    # Three rows all point at the same Burmese gloss but the English
    # words have different POS markers (v, v, n). Majority wins.
    rows = [
        {
            "word": "run",
            "title": "run / rʌn / v",
            "definition": "<b>ပြေး</b>",
            "raw_definition": "ပြေး",
            "synonym": "",
            "keywords": "",
        },
        {
            "word": "sprint",
            "title": "sprint / sprɪnt / v",
            "definition": "<b>ပြေး</b>",
            "raw_definition": "ပြေး",
            "synonym": "",
            "keywords": "",
        },
        {
            "word": "race",
            "title": "race / reɪs / n",
            "definition": "<b>ပြေး</b>",
            "raw_definition": "ပြေး",
            "synonym": "",
            "keywords": "",
        },
    ]
    entries = list(invert_engmyan(rows))
    assert len(entries) == 1
    assert entries[0].pos == "v"


def test_invert_assigns_sequential_entry_ids_starting_at_zero() -> None:
    rows = [
        {
            "word": "go",
            "title": "go / gou / v",
            "definition": "<b>သွား</b>",
            "raw_definition": "သွား",
            "synonym": "",
            "keywords": "",
        },
        {
            "word": "Myanmar",
            "title": "Myanmar / mjɑːn'mɑː / n",
            "definition": "<b>မြန်မာ</b>",
            "raw_definition": "မြန်မာ",
            "synonym": "",
            "keywords": "",
        },
    ]
    entries = list(invert_engmyan(rows))
    assert [e.entry_id for e in entries] == [0, 1]


def test_invert_stats_count_correctly() -> None:
    rows = [
        {
            "word": "go",
            "title": "go / gou / v",
            "definition": "<b>သွား</b>",
            "raw_definition": "သွား",
            "synonym": "",
            "keywords": "",
        },
        {
            "word": "abbr",
            "title": "abbr / ǝ'briː / abbr",
            "definition": "<i>abbr.</i> abbreviation",
            "raw_definition": "abbr. abbreviation",
            "synonym": "",
            "keywords": "",
        },
    ]
    stats = EngmyanStats()
    list(invert_engmyan(rows, stats=stats))
    assert stats.raw_entries == 2
    assert stats.dropped_no_burmese == 1  # the abbr row
    assert stats.stripped == 1            # only the "go" row produced an entry
    assert stats.distinct_headwords == 1


