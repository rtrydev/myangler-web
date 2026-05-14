"""Tests for the generic BK-tree."""

from __future__ import annotations

from data_pipeline.bktree import BKTree, edit_distance
from data_pipeline.syllable import segment_syllables


def test_edit_distance_on_strings() -> None:
    assert edit_distance("kitten", "sitting") == 3
    assert edit_distance("go", "go") == 0
    assert edit_distance("", "abc") == 3
    assert edit_distance("abc", "") == 3


def test_edit_distance_on_sequences() -> None:
    # Tuples (used for syllable-level distance) work the same.
    a = ("မြန်", "မာ")
    b = ("မြန်", "မာ", "နိုင်ငံ")
    assert edit_distance(a, b) == 1
    assert edit_distance(a, a) == 0


def test_bktree_char_level_returns_near_matches() -> None:
    tree: BKTree[str] = BKTree(edit_distance)
    tree.insert_many(["go", "do", "to", "got", "gone", "house", "mouse"])
    # threshold 1 around "go" → exact + within 1 edit.
    result = sorted(w for w, _d in tree.query("go", threshold=1))
    assert result == ["do", "go", "got", "to"]


def test_bktree_dedupes_duplicates() -> None:
    tree: BKTree[str] = BKTree(edit_distance)
    tree.insert("go")
    tree.insert("go")
    assert len(tree) == 1


def test_bktree_syllable_level() -> None:
    tree: BKTree[tuple[str, ...]] = BKTree(edit_distance)
    # 2-syllable headwords differing by exactly one syllable.
    tree.insert_many(
        tuple(segment_syllables(w))
        for w in ["မြန်မာ", "ထိုင်းမာ", "ဝီကီပိဒိယ"]
    )
    probe = tuple(segment_syllables("မြန်မာ"))
    result = tree.query(probe, threshold=1)
    found = {syls for syls, _ in result}
    # Exact match present, the 1-syllable-different sibling present.
    assert tuple(segment_syllables("မြန်မာ")) in found
    assert tuple(segment_syllables("ထိုင်းမာ")) in found
    # The completely unrelated 5-syllable headword is far.
    assert tuple(segment_syllables("ဝီကီပိဒိယ")) not in found


def test_bktree_json_round_trip() -> None:
    tree: BKTree[str] = BKTree(edit_distance)
    tree.insert_many(["go", "do", "got"])
    payload = tree.to_json_obj()
    assert payload["format"] == "bktree/v1"
    assert payload["size"] == 3

    rebuilt = BKTree.from_json_obj(payload, edit_distance)
    assert len(rebuilt) == 3
    result = sorted(w for w, _ in rebuilt.query("go", threshold=1))
    assert result == ["do", "go", "got"]
