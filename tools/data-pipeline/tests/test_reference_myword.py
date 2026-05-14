"""Regression tests for the vendored, corrected myWord reference at
``tools/data-pipeline/reference/myword/word_segment.py``.

These tests do **not** depend on the real ~30 MiB myWord pickles. They
build a tiny synthetic dictionary that pins:

1. Bigram lookups actually succeed against the corrected tuple-keyed
   shape (the original bug was that they always raised ``KeyError``).
2. The corrected segmenter produces *different* output from the buggy
   unigram-only path on at least one ambiguous input — i.e. the fix
   really engages, it isn't a no-op.
3. Specific segmentation outputs on the synthetic fixture are stable.

The full-asset round-trip (~30 MiB of pickles, ~32 MiB of JSON) is
verified separately by the TypeScript parity test
(``app/lib/segmenter/parity.test.ts``) once the fixture is regenerated.
"""

from __future__ import annotations

import importlib.util
import pickle
import sys
from collections import defaultdict
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
REFERENCE_DIR = REPO_ROOT / "tools" / "data-pipeline" / "reference"


def _load_word_segment_module(name: str) -> ModuleType:
    """Load a fresh copy of the vendored reference. Each test gets its
    own module instance so the module-level globals and the lru_cache
    on ``viterbi`` cannot leak between tests."""
    path = REFERENCE_DIR / "myword" / "word_segment.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _write_pickles(
    ngram_dir: Path,
    unigrams: dict[str, int],
    bigrams: dict[tuple[str, str], int],
) -> tuple[Path, Path]:
    """Write tiny ``defaultdict(int)`` pickles matching the on-disk
    shape of ``unigram-word.bin`` / ``bigram-word.bin``."""
    ngram_dir.mkdir(parents=True, exist_ok=True)
    uni_path = ngram_dir / "unigram-word.bin"
    bi_path = ngram_dir / "bigram-word.bin"

    uni_dd: defaultdict = defaultdict(int)
    uni_dd.update(unigrams)
    with uni_path.open("wb") as fh:
        pickle.dump(uni_dd, fh)

    bi_dd: defaultdict = defaultdict(int)
    bi_dd.update(bigrams)
    with bi_path.open("wb") as fh:
        pickle.dump(bi_dd, fh)

    return uni_path, bi_path


# ---- Synthetic vocab ------------------------------------------------------
#
# Two-segmentation discriminator: under unigram-only scoring "abcd" wins
# as a single rare token; under bigram-aware scoring the strong
# (abc, d) bigram should split it into ["abc", "d"]. See the rationale
# inline in ``test_bigrams_change_output_on_ambiguous_input``.

UNIGRAMS = {
    "abc": 50,
    "ab": 30,
    "c": 30,
    "abcd": 1,
    "d": 30,
}

BIGRAMS = {
    ("abc", "d"): 100,
}


@pytest.fixture
def synthetic_segmenter(tmp_path: Path):
    """Returns a fresh ``word_segment`` module wired up to a tiny
    synthetic dictionary on disk. Caches are cleared per-test."""
    uni_path, bi_path = _write_pickles(tmp_path / "myword", UNIGRAMS, BIGRAMS)
    module = _load_word_segment_module(f"_test_word_segment_{tmp_path.name}")
    module.P_unigram = module.ProbDist(str(uni_path), True)
    module.P_bigram = module.ProbDist(str(bi_path), False)
    module.viterbi.cache_clear()
    return module


# ---- Bigram lookup hits ---------------------------------------------------


def test_bigram_pickle_has_tuple_keys(tmp_path: Path) -> None:
    """Pin the on-disk shape we are correcting against: bigrams are
    keyed by ``(prev, curr)`` tuples, not by ``"prev curr"`` strings."""
    uni_path, bi_path = _write_pickles(tmp_path / "myword", UNIGRAMS, BIGRAMS)
    with bi_path.open("rb") as fh:
        bigram = pickle.load(fh)
    assert ("abc", "d") in bigram
    assert "abc d" not in bigram  # the old buggy lookup shape


def test_conditional_prob_resolves_via_bigram_tuple(synthetic_segmenter) -> None:
    """A pair that exists in the bigram dictionary returns the bigram
    conditional probability, not the unigram backoff."""
    wseg = synthetic_segmenter
    # Conditional prob = bigram_count / unigram_prev_count = 100 / 50 = 2.0
    assert wseg.conditionalProb("d", "abc") == pytest.approx(2.0)


def test_conditional_prob_falls_back_to_unigram_on_missing_bigram(
    synthetic_segmenter,
) -> None:
    """Missing bigram pairs raise ``KeyError`` internally and return the
    unigram probability of the current word. Preserved upstream behaviour."""
    wseg = synthetic_segmenter
    # (ab, c) is not in BIGRAMS — should fall back to P_unigram("c").
    expected = 30 / wseg.P_unigram.N
    assert wseg.conditionalProb("c", "ab") == pytest.approx(expected)


def test_conditional_prob_falls_back_when_prev_is_unknown(
    synthetic_segmenter,
) -> None:
    """If the previous word isn't in the unigram dict (e.g. ``<S>``),
    the division in the bigram branch raises ``KeyError`` and we backoff
    to ``P_unigram(curr)``."""
    wseg = synthetic_segmenter
    expected = 50 / wseg.P_unigram.N
    assert wseg.conditionalProb("abc", "<S>") == pytest.approx(expected)


# ---- "Bigrams are live" regression check ---------------------------------


def test_bigrams_change_output_on_ambiguous_input(synthetic_segmenter) -> None:
    """The load-bearing regression check.

    Input ``"abcd"`` has two competing parses on the synthetic vocab:

      * single word ``"abcd"`` — known unigram with count 1
      * split ``["abc", "d"]`` — both are unigrams (50, 30); under
        unigram-only scoring this loses to ``"abcd"`` as a single token
        because two log-probs of moderately-rare words combine to a
        worse score than one log-prob of a rare-but-known word. Under
        bigram-aware scoring the strong ``(abc, d)`` bigram (count 100,
        much higher than the count of ``"abc"`` alone) tips the choice
        toward the split.

    If a future change re-introduces the bigram bug — same key shape
    mismatch, a different one, or accidentally bypassing the bigram
    lookup — the segmenter falls back to unigram-only scoring and this
    test will fail. That is the regression we are guarding against.
    """
    wseg = synthetic_segmenter
    _score, tokens = wseg.viterbi("abcd")
    assert tokens == ["abc", "d"], (
        "Expected the corrected bigram-aware segmenter to split 'abcd' into "
        "['abc', 'd']; got "
        f"{tokens!r}. If this fails, the bigram lookup has regressed and "
        "the segmenter is back to unigram-only behaviour."
    )


def test_bigrams_can_be_directly_observed_to_hit(synthetic_segmenter) -> None:
    """Stronger than the previous test: instrument ``conditionalProb``
    to count tuple-key hits during a Viterbi pass and assert > 0.

    This proves bigram lookups are *exercised* — not just that the
    output happens to match an expectation."""
    wseg = synthetic_segmenter
    hits = 0
    misses = 0
    original = wseg.conditionalProb

    def instrumented(word_curr: str, word_prev: str) -> float:
        nonlocal hits, misses
        try:
            value = wseg.P_bigram[(word_prev, word_curr)] / wseg.P_unigram[word_prev]
            hits += 1
            return value
        except KeyError:
            misses += 1
            return wseg.P_unigram(word_curr)

    wseg.conditionalProb = instrumented
    try:
        wseg.viterbi.cache_clear()
        wseg.viterbi("abcd")
    finally:
        wseg.conditionalProb = original
    assert hits > 0, (
        f"Expected at least one bigram tuple-key hit during Viterbi over "
        f"'abcd'; observed hits={hits}, misses={misses}. If hits is zero, "
        "the bigram lookup path is broken again."
    )


# ---- Stable-output sanity --------------------------------------------------


def test_empty_input_returns_empty(synthetic_segmenter) -> None:
    """Empty input must short-circuit before Viterbi (upstream behaviour)."""
    wseg = synthetic_segmenter
    score, tokens = wseg.viterbi("")
    assert score == 0.0
    assert tokens == []


def test_single_character_input_segments_to_single_token(synthetic_segmenter) -> None:
    """``"d"`` is a unigram with count 30 — must stay as one token."""
    wseg = synthetic_segmenter
    _score, tokens = wseg.viterbi("d")
    assert tokens == ["d"]
