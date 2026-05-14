"""End-to-end test for the `all` command over a tiny fixture."""

from __future__ import annotations

import json
import pickle
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


def _write_fixture(path: Path) -> None:
    entries = [
        {
            "word": "က",
            "pos": "noun",
            "senses": [{"glosses": ["letter ka"]}],
            "sounds": [{"ipa": "/ka/"}],
        },
        {
            "word": "သွား",
            "pos": "verb",
            "senses": [{"glosses": ["to go"]}, {"glosses": ["to depart"]}],
        },
        {
            "word": "မြန်မာ",
            "pos": "name",
            "senses": [{"glosses": ["Myanmar (a country in Southeast Asia)"]}],
        },
        {
            "word": "ထ",
            "pos": "noun",
            "senses": [],  # empty-gloss case
        },
    ]
    with path.open("w", encoding="utf-8") as fh:
        for e in entries:
            fh.write(json.dumps(e, ensure_ascii=False) + "\n")


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
    fixture = tmp_path / "tiny.jsonl"
    _write_fixture(fixture)
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
