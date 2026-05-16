"""End-to-end test for the `all` command over a tiny fixture.

After the data-source migration (docs/burmese-dictionary-spec.md §3.1),
``all`` runs ``engmyan`` instead of the legacy kaikki ``strip``. This
test feeds an EngMyanDictionary-shaped fixture (English headword,
HTML/raw-text definition with Burmese glosses) and asserts the pipeline
still produces every expected asset with the same schemas/format tags.
"""

from __future__ import annotations

import json
import pickle
import sqlite3
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

from data_pipeline.config import (
    BKTREE_EN_FILENAME,
    BKTREE_MY_FILENAME,
    DB_FILENAME,
    NGRAM_BIGRAM_FILENAME,
    NGRAM_FILENAME,
    NGRAM_UNIGRAM_FILENAME,
    VERSION_FILENAME,
)


def _write_engmyan_fixture(path: Path) -> None:
    """Tiny EngMyanDictionary-shaped JSONL fixture.

    The pipeline inverts these into Burmese-headword entries whose
    glosses are the English ``word``s. Picked to exercise:
      * a noun with a single Burmese gloss → "က"
      * a verb with multiple senses (၁။/၂။) → "သွား"
      * a proper noun with English-like parenthetical → "မြန်မာ"
      * an abbreviation that should not produce a non-Burmese headword
    """
    rows = [
        {
            "word": "letter ka",
            "stripword": "letter ka",
            "title": "letter ka / 'letter/ kə / n",
            "definition": "<i>n.</i> <b>က</b>",
            "raw_definition": "က",
            "keywords": "",
            "synonym": "",
        },
        {
            "word": "go",
            "stripword": "go",
            "title": "go / gou / v",
            "definition": "<i>v.</i> ၁။ <b>သွား</b>; example sentence (English).",
            "raw_definition": "v. ၁။ သွား; example sentence (English).",
            "keywords": "",
            "synonym": "depart",
        },
        {
            "word": "depart",
            "stripword": "depart",
            "title": "depart / dɪ'pɑːt / v",
            "definition": "<i>v.</i> <b>သွား</b>; leave abruptly.",
            "raw_definition": "v. သွား; leave abruptly.",
            "keywords": "",
            "synonym": "",
        },
        {
            "word": "Myanmar",
            "stripword": "myanmar",
            "title": "Myanmar / mjɑːn'mɑː / n",
            "definition": "<i>n.</i> <b>မြန်မာ</b>",
            "raw_definition": "n. မြန်မာ",
            "keywords": "",
            "synonym": "",
        },
        # Abbreviation row: Myanmar side empty, must NOT emit an
        # English-headword entry.
        {
            "word": "abbr",
            "stripword": "abbr",
            "title": "abbr / ǝ'briː / abbr",
            "definition": "<i>abbr.</i> abbreviation",
            "raw_definition": "abbr. abbreviation",
            "keywords": "",
            "synonym": "",
        },
    ]
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def _write_ngram_fixture(ngram_dir: Path) -> None:
    """Tiny synthetic stand-in for the real myWord pickles."""
    ngram_dir.mkdir(parents=True, exist_ok=True)
    uni: defaultdict = defaultdict(int)
    uni.update({"က": 5, "သွား": 7, "မြန်မာ": 2})
    bi: defaultdict = defaultdict(int)
    bi.update({("က", "သွား"): 1, ("သွား", "မြန်မာ"): 4})
    with (ngram_dir / NGRAM_UNIGRAM_FILENAME).open("wb") as fh:
        pickle.dump(uni, fh)
    with (ngram_dir / NGRAM_BIGRAM_FILENAME).open("wb") as fh:
        pickle.dump(bi, fh)


def test_all_produces_every_expected_asset(tmp_path: Path) -> None:
    fixture = tmp_path / "engmyan.jsonl"
    _write_engmyan_fixture(fixture)
    ngram_dir = tmp_path / "myword"
    _write_ngram_fixture(ngram_dir)
    out_dir = tmp_path / "build"

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "data_pipeline",
            "--input",
            str(fixture),
            "--output-dir",
            str(out_dir),
            "--ngram-dir",
            str(ngram_dir),
            # Disable the kaikki overlay so this test exercises the
            # engmyan-only path in isolation from real ``data/`` files.
            "--kaikki-input",
            str(tmp_path / "no-kaikki-here.jsonl"),
            "all",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    # Every shippable asset exists.
    for name in (
        DB_FILENAME,
        NGRAM_FILENAME,
        BKTREE_EN_FILENAME,
        BKTREE_MY_FILENAME,
        VERSION_FILENAME,
    ):
        assert (out_dir / name).is_file(), f"missing {name}; stdout:\n{result.stdout}"

    # merge-g2p remains a stub and is skipped.
    assert "merge-g2p" in result.stdout

    # The report block prints, including the n-gram section + total payload.
    assert "Build report" in result.stdout
    assert "stripped entries" in result.stdout
    assert "n-gram dictionary" in result.stdout
    assert "TOTAL precache" in result.stdout

    # Version JSON is well-formed.
    version_payload = json.loads((out_dir / VERSION_FILENAME).read_text())
    assert "version" in version_payload
    assert "scheme" in version_payload

    # BK-trees are well-formed.
    en_tree = json.loads((out_dir / BKTREE_EN_FILENAME).read_text())
    my_tree = json.loads((out_dir / BKTREE_MY_FILENAME).read_text())
    assert en_tree["format"] == "bktree/v1"
    assert my_tree["format"] == "bktree/v1"

    # N-gram asset shape matches the documented contract.
    ngram_payload = json.loads((out_dir / NGRAM_FILENAME).read_text())
    assert ngram_payload["format"] == "myword-ngram/v1"
    assert ngram_payload["unigram"] == {"က": 5, "သွား": 7, "မြန်မာ": 2}
    assert ngram_payload["bigram"]["သွား"]["မြန်မာ"] == 4

    # The shipped SQLite must be Burmese-keyed: every headword in the
    # `entries` table is a Burmese run, never an English string. This is
    # the migration's headline invariant.
    conn = sqlite3.connect(out_dir / DB_FILENAME)
    try:
        headwords = [
            row[0] for row in conn.execute("SELECT headword FROM entries")
        ]
    finally:
        conn.close()
    assert headwords, "entries table is empty"
    # Every headword contains at least one Myanmar codepoint.
    for hw in headwords:
        assert any(0x1000 <= ord(ch) <= 0x109F for ch in hw), (
            f"non-Burmese headword leaked into entries: {hw!r}"
        )
    # The "abbr" row must NOT have produced an English-keyed entry.
    assert "abbr" not in headwords
    assert "abbreviation" not in headwords
