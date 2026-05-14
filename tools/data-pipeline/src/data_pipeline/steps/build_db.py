"""SQLite build step (spec §6.5).

Writes the shippable dictionary database. The schema is deliberately
plain so ``sql.js`` (the WASM SQLite the frontend uses) handles it
without trouble:

  * ``entries``     — one row per stripped Burmese entry. The
                      ``glosses`` and ``normalized_glosses`` columns are
                      JSON-encoded arrays preserving sense order; the
                      frontend parses them once at load time.
  * ``postings``    — the English inverted index. ``(word, tier,
                      entry_id, gloss_index)`` ordered by ``(word, tier)``
                      so reverse lookup can return tier-sorted matches by
                      a simple range scan.
  * ``gloss_groups``— maps every distinct normalized gloss to the list of
                      entry_ids that share it. Drives the §2.4.3
                      "identical gloss → single merged row" rule without
                      forcing the frontend to recompute it.

Indexes are kept to the minimum: the headword for forward lookup, the
gloss-word for reverse lookup, and the normalized gloss for merging.
After all writes the database is ``VACUUM``ed.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from collections.abc import Iterable
from pathlib import Path

from data_pipeline.steps.index_en import InvertedIndex
from data_pipeline.steps.strip import StrippedEntry

logger = logging.getLogger(__name__)


SCHEMA = """
CREATE TABLE entries (
    entry_id INTEGER PRIMARY KEY,
    headword TEXT NOT NULL,
    pos TEXT NOT NULL,
    glosses TEXT NOT NULL,            -- JSON array of display glosses
    normalized_glosses TEXT NOT NULL, -- JSON array, parallel to glosses
    ipa TEXT
);

CREATE TABLE postings (
    word TEXT NOT NULL,
    tier INTEGER NOT NULL,
    entry_id INTEGER NOT NULL,
    gloss_index INTEGER NOT NULL,
    PRIMARY KEY (word, tier, entry_id, gloss_index)
) WITHOUT ROWID;

CREATE TABLE gloss_groups (
    normalized_gloss TEXT NOT NULL,
    entry_id INTEGER NOT NULL,
    PRIMARY KEY (normalized_gloss, entry_id)
) WITHOUT ROWID;

CREATE INDEX idx_entries_headword ON entries (headword);
"""


def build_database(
    db_path: Path,
    entries: Iterable[StrippedEntry],
    index: InvertedIndex,
) -> int:
    """Build the SQLite DB at ``db_path``; return its file size in bytes."""
    if db_path.exists():
        db_path.unlink()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(SCHEMA)

        # Entries.
        rows = (
            (
                e.entry_id,
                e.headword,
                e.pos,
                json.dumps(list(e.glosses), ensure_ascii=False),
                json.dumps(list(e.normalized_glosses), ensure_ascii=False),
                e.ipa,
            )
            for e in entries
        )
        conn.executemany(
            "INSERT INTO entries "
            "(entry_id, headword, pos, glosses, normalized_glosses, ipa) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )

        # Inverted index postings.
        posting_rows = (
            (word, int(p.tier), p.entry_id, p.gloss_index)
            for word, postings in index.postings_by_word.items()
            for p in postings
        )
        conn.executemany(
            "INSERT INTO postings (word, tier, entry_id, gloss_index) "
            "VALUES (?, ?, ?, ?)",
            posting_rows,
        )

        # Merging groups.
        group_rows = (
            (norm, eid)
            for norm, ids in index.normalized_to_entries.items()
            for eid in ids
        )
        conn.executemany(
            "INSERT INTO gloss_groups (normalized_gloss, entry_id) VALUES (?, ?)",
            group_rows,
        )

        conn.commit()
        # Reclaim free pages so the shipped file is as small as it can be.
        conn.execute("VACUUM")
    finally:
        conn.close()

    return db_path.stat().st_size
