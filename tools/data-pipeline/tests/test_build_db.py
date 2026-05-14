"""Tests for the SQLite build step (spec §6.5)."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from data_pipeline.steps.build_db import build_database
from data_pipeline.steps.index_en import Tier, build_index
from data_pipeline.steps.strip import StrippedEntry, normalize_gloss


def _entry(eid: int, headword: str, glosses: tuple[str, ...]) -> StrippedEntry:
    return StrippedEntry(
        entry_id=eid,
        headword=headword,
        pos="noun",
        glosses=glosses,
        normalized_glosses=tuple(normalize_gloss(g) for g in glosses),
    )


def _build(tmp_path: Path):
    entries = [
        _entry(0, "က", ("go",)),
        _entry(1, "ခ", ("to go",)),         # normalized "go" → merges with entry 0
        _entry(2, "ဂ", ("go up", "ascend")),
    ]
    index = build_index(entries, stopwords=frozenset({"a", "the"}))
    db_path = tmp_path / "dict.sqlite"
    build_database(db_path, entries, index)
    return db_path


def test_db_has_expected_tables_and_indexes(tmp_path: Path) -> None:
    db_path = _build(tmp_path)
    conn = sqlite3.connect(db_path)
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        assert {"entries", "postings", "gloss_groups"} <= tables

        # Headword index on entries.
        indexes = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            )
        }
        assert "idx_entries_headword" in indexes
    finally:
        conn.close()


def test_forward_lookup_returns_correct_glosses(tmp_path: Path) -> None:
    db_path = _build(tmp_path)
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            "SELECT pos, glosses, normalized_glosses, ipa "
            "FROM entries WHERE headword = ?",
            ("ဂ",),
        ).fetchone()
    finally:
        conn.close()

    assert row is not None
    pos, glosses_json, normalized_json, ipa = row
    assert pos == "noun"
    assert json.loads(glosses_json) == ["go up", "ascend"]
    assert json.loads(normalized_json) == ["go up", "ascend"]
    assert ipa is None


def test_reverse_lookup_returns_postings_in_tier_order(tmp_path: Path) -> None:
    db_path = _build(tmp_path)
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT entry_id, tier FROM postings "
            "WHERE word = ? ORDER BY tier, entry_id",
            ("go",),
        ).fetchall()
    finally:
        conn.close()

    # entry 0: "go" → EXACT
    # entry 1: normalized "go" → EXACT (same merging)
    # entry 2: "go up" → HEAD on "go"
    assert (0, int(Tier.EXACT)) in rows
    assert (1, int(Tier.EXACT)) in rows
    assert (2, int(Tier.HEAD)) in rows


def test_merged_gloss_group_resolves_to_multiple_entries(tmp_path: Path) -> None:
    db_path = _build(tmp_path)
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT entry_id FROM gloss_groups WHERE normalized_gloss = ? "
            "ORDER BY entry_id",
            ("go",),
        ).fetchall()
    finally:
        conn.close()
    # Entries 0 ("go") and 1 ("to go") share the normalized gloss.
    assert [r[0] for r in rows] == [0, 1]
