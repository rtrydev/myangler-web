"""Tests for the convert-ngram step.

These tests build a synthetic pickle fixture mimicking the structure of the
real myWord ``dict_ver1/`` files (a unigram ``defaultdict(int)`` keyed by
``str``; a bigram ``defaultdict(int)`` keyed by ``tuple[str, str]``) so the
test suite never needs to touch the multi-MB upstream pickles.
"""

from __future__ import annotations

import json
import pickle
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import pytest

from data_pipeline.config import (
    NGRAM_BIGRAM_FILENAME,
    NGRAM_FILENAME,
    NGRAM_UNIGRAM_FILENAME,
)
from data_pipeline.steps.convert_ngram import (
    NGRAM_FORMAT_TAG,
    CorruptNgramInputError,
    MissingNgramInputError,
    convert_ngram,
    convert_ngram_to_default,
)

# --- Fixture helpers --------------------------------------------------------


SYNTHETIC_UNIGRAMS: dict[str, int] = {
    "က": 5,
    "ခ": 3,
    "သွား": 7,
    "မြန်မာ": 2,
    "ပြည်": 1,
}

SYNTHETIC_BIGRAMS: dict[tuple[str, str], int] = {
    ("က", "ခ"): 2,
    ("ခ", "သွား"): 1,
    ("သွား", "မြန်မာ"): 4,
    ("မြန်မာ", "ပြည်"): 6,
    ("က", "သွား"): 1,
}


def _write_pickle(path: Path, data: dict) -> None:
    # myWord uses ``defaultdict(int)`` for the on-disk pickles. Match that
    # exactly so the fixture exercises the unpickler whitelist.
    dd: defaultdict = defaultdict(int)
    dd.update(data)
    with path.open("wb") as fh:
        pickle.dump(dd, fh)


def _write_synthetic_inputs(ngram_dir: Path) -> None:
    ngram_dir.mkdir(parents=True, exist_ok=True)
    _write_pickle(ngram_dir / NGRAM_UNIGRAM_FILENAME, SYNTHETIC_UNIGRAMS)
    _write_pickle(ngram_dir / NGRAM_BIGRAM_FILENAME, SYNTHETIC_BIGRAMS)


# --- Conversion tests -------------------------------------------------------


def test_convert_ngram_emits_expected_payload(tmp_path: Path) -> None:
    ngram_dir = tmp_path / "myword"
    _write_synthetic_inputs(ngram_dir)
    out = tmp_path / "ngram.json"

    stats = convert_ngram(ngram_dir, out)

    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["format"] == NGRAM_FORMAT_TAG
    assert payload["source"] == {
        "unigram": NGRAM_UNIGRAM_FILENAME,
        "bigram": NGRAM_BIGRAM_FILENAME,
    }
    assert payload["unigram_count"] == len(SYNTHETIC_UNIGRAMS)
    assert payload["unigram_total"] == sum(SYNTHETIC_UNIGRAMS.values())
    assert payload["bigram_count"] == len(SYNTHETIC_BIGRAMS)
    assert payload["bigram_total"] == sum(SYNTHETIC_BIGRAMS.values())

    assert stats.unigram_count == len(SYNTHETIC_UNIGRAMS)
    assert stats.bigram_count == len(SYNTHETIC_BIGRAMS)
    assert stats.output_size == out.stat().st_size
    assert stats.output_size_gzipped > 0
    assert stats.raw_unigram_size > 0
    assert stats.raw_bigram_size > 0


def test_conversion_is_faithful(tmp_path: Path) -> None:
    """Every n-gram and its count round-trips."""
    ngram_dir = tmp_path / "myword"
    _write_synthetic_inputs(ngram_dir)
    out = tmp_path / "ngram.json"

    convert_ngram(ngram_dir, out)
    payload = json.loads(out.read_text(encoding="utf-8"))

    # Unigrams: every (word, count) is present.
    assert payload["unigram"] == SYNTHETIC_UNIGRAMS

    # Bigrams: the nested dict reconstructs the original tuple-keyed dict.
    reconstructed: dict[tuple[str, str], int] = {}
    for prev, inner in payload["bigram"].items():
        for curr, count in inner.items():
            reconstructed[(prev, curr)] = count
    assert reconstructed == SYNTHETIC_BIGRAMS


def test_round_trip_through_disk(tmp_path: Path) -> None:
    """Write → read JSON → identical to the in-memory expectation."""
    ngram_dir = tmp_path / "myword"
    _write_synthetic_inputs(ngram_dir)
    out = tmp_path / "ngram.json"
    convert_ngram(ngram_dir, out)
    first = out.read_bytes()
    # Re-running with the same inputs reproduces the file byte-for-byte
    # (deterministic key order from the input pickle's iteration order).
    convert_ngram(ngram_dir, out)
    assert out.read_bytes() == first


def test_missing_unigram_raises_actionable_error(tmp_path: Path) -> None:
    ngram_dir = tmp_path / "myword"
    ngram_dir.mkdir()
    # Only the bigram is present.
    _write_pickle(ngram_dir / NGRAM_BIGRAM_FILENAME, SYNTHETIC_BIGRAMS)

    with pytest.raises(MissingNgramInputError) as excinfo:
        convert_ngram_to_default(ngram_dir, tmp_path / "build")
    msg = str(excinfo.value)
    assert NGRAM_UNIGRAM_FILENAME in msg
    assert "README" in msg


def test_missing_bigram_raises_actionable_error(tmp_path: Path) -> None:
    ngram_dir = tmp_path / "myword"
    ngram_dir.mkdir()
    _write_pickle(ngram_dir / NGRAM_UNIGRAM_FILENAME, SYNTHETIC_UNIGRAMS)

    with pytest.raises(MissingNgramInputError) as excinfo:
        convert_ngram_to_default(ngram_dir, tmp_path / "build")
    assert NGRAM_BIGRAM_FILENAME in str(excinfo.value)


def test_corrupt_pickle_raises_clear_error(tmp_path: Path) -> None:
    """A pickle that loads but has the wrong shape fails loudly."""
    ngram_dir = tmp_path / "myword"
    ngram_dir.mkdir()
    # Unigram with an int key (wrong type).
    bad_uni = {123: 1}
    with (ngram_dir / NGRAM_UNIGRAM_FILENAME).open("wb") as fh:
        pickle.dump(bad_uni, fh)
    _write_pickle(ngram_dir / NGRAM_BIGRAM_FILENAME, SYNTHETIC_BIGRAMS)

    with pytest.raises(CorruptNgramInputError):
        convert_ngram_to_default(ngram_dir, tmp_path / "build")


def test_unsafe_pickle_globals_are_rejected(tmp_path: Path) -> None:
    """The whitelist unpickler refuses unexpected classes."""
    ngram_dir = tmp_path / "myword"
    ngram_dir.mkdir()
    # ``os.system`` is the canonical "this would be bad to unpickle" target.
    # We don't need to construct a real exploit — pickling ``object()`` (an
    # instance of ``builtins.object`` which is NOT in the whitelist) is
    # enough to trip the guard.
    with (ngram_dir / NGRAM_UNIGRAM_FILENAME).open("wb") as fh:
        pickle.dump(object(), fh)
    _write_pickle(ngram_dir / NGRAM_BIGRAM_FILENAME, SYNTHETIC_BIGRAMS)

    with pytest.raises(pickle.UnpicklingError):
        convert_ngram_to_default(ngram_dir, tmp_path / "build")


# --- CLI integration --------------------------------------------------------


def test_cli_convert_ngram_writes_asset(tmp_path: Path) -> None:
    ngram_dir = tmp_path / "myword"
    _write_synthetic_inputs(ngram_dir)
    out_dir = tmp_path / "build"

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "data_pipeline",
            "--input",
            str(tmp_path / "ignored.jsonl"),
            "--output-dir",
            str(out_dir),
            "--ngram-dir",
            str(ngram_dir),
            "convert-ngram",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert (out_dir / NGRAM_FILENAME).is_file()
    assert "unigrams" in result.stdout
    assert "bigrams" in result.stdout


def test_cli_convert_ngram_missing_input_clean_error(tmp_path: Path) -> None:
    out_dir = tmp_path / "build"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "data_pipeline",
            "--input",
            str(tmp_path / "ignored.jsonl"),
            "--output-dir",
            str(out_dir),
            "--ngram-dir",
            str(tmp_path / "no-such-dir"),
            "convert-ngram",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    # Error message goes to stderr, not a stack trace.
    assert "Traceback" not in result.stderr
    assert "error:" in result.stderr
    assert NGRAM_UNIGRAM_FILENAME in result.stderr
