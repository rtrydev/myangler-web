"""Tests for the hybrid kaikki + engmyan merge step."""

from __future__ import annotations

from data_pipeline.steps.merge import MergeStats, merge_dictionaries
from data_pipeline.steps.strip import StrippedEntry, normalize_gloss


def _entry(eid: int, headword: str, pos: str, glosses: tuple[str, ...]) -> StrippedEntry:
    return StrippedEntry(
        entry_id=eid,
        headword=headword,
        pos=pos,
        glosses=glosses,
        normalized_glosses=tuple(normalize_gloss(g) for g in glosses),
    )


def test_kaikki_takes_precedence_on_shared_headwords() -> None:
    """When both sources have an entry, kaikki's is kept and engmyan's
    is dropped — that's how the legacy particle glosses survive."""
    kaikki = [
        _entry(0, "ပါ", "particle", ("please", "polite particle")),
        _entry(1, "ပါ", "verb", ("to be with", "be present")),
    ]
    engmyan = [
        _entry(0, "ပါ", "v", ("stand", "accept", "bear")),
    ]
    stats = MergeStats()
    out = merge_dictionaries(kaikki, engmyan, stats=stats)
    headwords_pos = [(e.headword, e.pos) for e in out]
    assert ("ပါ", "particle") in headwords_pos
    assert ("ပါ", "verb") in headwords_pos
    # The engmyan ပါ entry (with "stand") must NOT appear.
    assert ("ပါ", "v") not in headwords_pos
    assert stats.kaikki_kept == 2
    assert stats.engmyan_kept == 0
    assert stats.engmyan_dropped == 1


def test_engmyan_fills_headwords_kaikki_does_not_cover() -> None:
    """Engmyan's wider lexical coverage rides through for headwords
    kaikki has nothing for."""
    kaikki = [
        _entry(0, "ပါ", "particle", ("please",)),
    ]
    engmyan = [
        _entry(0, "ပါ", "v", ("stand",)),       # dropped (in kaikki)
        _entry(1, "ဆုံ", "n", ("meet",)),       # kept (not in kaikki)
        _entry(2, "မြင်", "v", ("see",)),       # kept (not in kaikki)
    ]
    stats = MergeStats()
    out = merge_dictionaries(kaikki, engmyan, stats=stats)
    headwords = {e.headword for e in out}
    assert headwords == {"ပါ", "ဆုံ", "မြင်"}
    assert stats.engmyan_kept == 2  # ဆုံ + မြင်
    assert stats.engmyan_dropped == 1  # ပါ


def test_entry_ids_are_reassigned_sequentially() -> None:
    """SQLite primary-key contract: entry_ids stay in 0..N-1."""
    kaikki = [
        _entry(99, "ပါ", "particle", ("please",)),
        _entry(100, "ပါ", "verb", ("to be with",)),
    ]
    engmyan = [
        _entry(7, "ဆုံ", "n", ("meet",)),
    ]
    out = merge_dictionaries(kaikki, engmyan)
    assert [e.entry_id for e in out] == [0, 1, 2]


def test_empty_kaikki_input_yields_engmyan_only() -> None:
    """No kaikki overlay reduces to a pure engmyan build."""
    engmyan = [
        _entry(0, "ပါ", "v", ("stand",)),
        _entry(1, "ဆုံ", "n", ("meet",)),
    ]
    stats = MergeStats()
    out = merge_dictionaries([], engmyan, stats=stats)
    headwords = [e.headword for e in out]
    assert headwords == ["ပါ", "ဆုံ"]
    assert stats.kaikki_kept == 0
    assert stats.engmyan_kept == 2


def test_kaikki_entries_with_same_headword_sort_by_pos_priority() -> None:
    """Function-word POSes lead lexical ones so the breakdown preview
    shows the sense users actually mean. Mirrors the real-data fix for
    ပါ (particle 'please' over verb 'to be with')."""
    # Note: kaikki's natural row order here puts the verb sense first,
    # which is the bug this sort addresses.
    kaikki = [
        _entry(0, "ပါ", "verb", ("to be with", "be together with")),
        _entry(1, "ပါ", "particle", ("please", "polite particle")),
        _entry(2, "ပါ", "noun", ("cowrie throw",)),
    ]
    out = merge_dictionaries(kaikki, [])
    # Particle must come first.
    assert out[0].pos == "particle"
    assert out[0].glosses[0] == "please"
    # The verb and noun entries still ride through, just demoted.
    poses = [e.pos for e in out]
    assert poses == ["particle", "verb", "noun"]


def test_classifier_and_num_beat_verb_for_polysemous_headwords() -> None:
    """တစ်: num 'one' beats verb 'to cut'. ယောက်: classifier beats verb."""
    kaikki = [
        _entry(0, "တစ်", "verb", ("to cut, chop",)),
        _entry(1, "တစ်", "num", ("one",)),
    ]
    out = merge_dictionaries(kaikki, [])
    assert out[0].pos == "num"
    assert out[0].glosses[0] == "one"


def test_suffix_style_particle_is_demoted_below_lexical_sense() -> None:
    """နေ has both a verb sense ('to stay') and a particle sense that's
    *suffixed to a verb*. The verb sense should lead — the particle is
    only meaningful as a suffix on other verbs."""
    kaikki = [
        _entry(0, "နေ", "noun", ("sun",)),
        _entry(1, "နေ", "verb", ("to stay",)),
        _entry(
            2,
            "နေ",
            "particle",
            ("suffixed to a verb to denote a continuing process",),
        ),
    ]
    out = merge_dictionaries(kaikki, [])
    # Verb leads; suffix-particle gets demoted past noun (and past
    # verb/adj).
    assert out[0].pos == "verb"
    assert out[0].glosses[0] == "to stay"


def test_nfc_normalizes_kaikki_headwords() -> None:
    """Kaikki source isn't guaranteed to be NFC — engmyan always is.
    Both sides need to compare in the same form so a non-NFC kaikki
    headword still beats its engmyan counterpart."""
    import unicodedata
    # An NFD-encoded version of an NFC string. NFC reduces to the
    # canonical composed form.
    nfd_form = unicodedata.normalize("NFD", "ပါ")
    kaikki = [_entry(0, nfd_form, "particle", ("please",))]
    engmyan = [_entry(0, "ပါ", "v", ("stand",))]
    stats = MergeStats()
    out = merge_dictionaries(kaikki, engmyan, stats=stats)
    # Only one entry survives: the kaikki one, NFC-normalized.
    assert len(out) == 1
    assert out[0].headword == "ပါ"
    assert out[0].pos == "particle"
    assert stats.engmyan_dropped == 1
