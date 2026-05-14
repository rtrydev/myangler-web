"""Generate the Python myWord word-segmenter reference fixture.

Runs the **vendored, corrected** Python myWord segmenter (at
``tools/data-pipeline/reference/myword/word_segment.py``) against a
curated input corpus and writes the resulting token sequences to
``app/lib/segmenter/__fixtures__/reference-corpus.json``. The TypeScript
port asserts identical token sequences against this fixture.

The vendored reference fixes the bigram key-shape bug in the upstream
``myWord/word_segment.py``; see
``tools/data-pipeline/reference/README.md`` for what changed and why.
The corpus *inputs* below are identical to the prior fixture — only
the *outputs* change as a result of bigrams now being live.

How to regenerate
-----------------

From the repo root, with the venv active and the myWord pickles in place
(``data/myword/{unigram,bigram}-word.bin`` — see
``tools/data-pipeline/README.md``)::

    python app/lib/segmenter/scripts/generate-reference.py

The script writes the fixture in-place and prints a one-line summary
that includes the proportion of bigram tuple-key hits observed during
the run, as a sanity readout that bigrams are actually being consulted.

Corpus assembly
---------------

The corpus combines:

1. ``myWord/test1.txt`` — myWord's own bundled raw (space-stripped) test
   inputs. These are the most authoritative reference inputs because they
   ship with the upstream segmenter.
2. ``myWord/test2.txt`` (space-stripped to look like raw user input) —
   adds longer / more diverse sentences with punctuation, digits,
   parentheses, and rare vocabulary that exercise the unknown-word
   smoothing path.
3. ``myWord/one_line.txt`` — a minimal short input.
4. A small in-script ``EXTRA_INPUTS`` list — explicit edge cases that
   are not in myWord's bundled data: empty input, whitespace-only,
   pure ASCII, ASCII+Burmese mixing, Burmese with ASCII punctuation
   and digits, and a couple of known-ambiguous segmentations
   ("ဆရာက" — "teacher" vs "teacher and").

The Python preprocessing step is reproduced exactly: each input has
``" "`` removed and is then ``.strip()``ped before being passed to
``viterbi`` (mirrors ``myWord/myword.py`` line 161).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
MYWORD_DIR = REPO_ROOT / "myWord"
REFERENCE_DIR = REPO_ROOT / "tools" / "data-pipeline" / "reference"
NGRAM_DIR = REPO_ROOT / "data" / "myword"
OUTPUT_PATH = (
    REPO_ROOT / "app" / "lib" / "segmenter" / "__fixtures__" / "reference-corpus.json"
)

# Inject the vendored reference directory onto sys.path so the corrected
# ``word_segment`` module is the one we import here (not the buggy
# upstream copy under ``myWord/``).
sys.path.insert(0, str(REFERENCE_DIR))

from myword import word_segment as wseg  # noqa: E402

# Edge-case inputs that exercise behavior the bundled myWord test data
# does not cover.
EXTRA_INPUTS: list[str] = [
    "",
    "   ",
    "ဆရာက",
    "ဆရာ",
    "မင်္ဂလာပါ",
    "abc",
    "abc123",
    "ကabခ",
    "မြန်မာ123",
    "မြန်မာ.",
    "(မြန်မာ)",
    "မြန်မာ၁၂၃။",
]


def _gather_inputs() -> list[str]:
    """Read myWord bundled inputs, dedupe while preserving order, then
    append the explicit edge cases. Empty results from preprocessing are
    kept so we lock down empty-input behavior too."""
    inputs: list[str] = []
    seen: set[str] = set()

    def add(raw: str) -> None:
        # Mirror myword.py: line.replace(" ", "").strip().
        prepared = raw.replace(" ", "").strip()
        # Use the *raw* line as the fixture input (the test will apply the
        # same preprocessing); but dedupe on the prepared form so corpora
        # with formatting differences don't double-count.
        key = prepared
        if key in seen:
            return
        seen.add(key)
        inputs.append(raw)

    for filename in ("test1.txt", "test2.txt", "one_line.txt"):
        path = MYWORD_DIR / filename
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            add(line)

    for raw in EXTRA_INPUTS:
        add(raw)

    return inputs


def _instrument_for_hit_counting() -> tuple[list[int], callable]:
    """Wrap ``conditionalProb`` so we can report a bigrams-are-live
    summary alongside the fixture. Returns ``([hits, misses], restore)``;
    the restore callable is the original ``conditionalProb`` (passed
    back so we can put it back if needed)."""
    counters = [0, 0]  # [hits, misses]
    original = wseg.conditionalProb

    def instrumented(word_curr: str, word_prev: str) -> float:
        try:
            value = wseg.P_bigram[(word_prev, word_curr)] / wseg.P_unigram[word_prev]
            counters[0] += 1
            return value
        except KeyError:
            counters[1] += 1
            return wseg.P_unigram(word_curr)

    wseg.conditionalProb = instrumented
    return counters, original


def main() -> int:
    if not (NGRAM_DIR / "unigram-word.bin").exists():
        print(
            f"ERROR: missing {NGRAM_DIR / 'unigram-word.bin'} — see "
            "tools/data-pipeline/README.md for setup.",
            file=sys.stderr,
        )
        return 1
    if not (NGRAM_DIR / "bigram-word.bin").exists():
        print(
            f"ERROR: missing {NGRAM_DIR / 'bigram-word.bin'} — see "
            "tools/data-pipeline/README.md for setup.",
            file=sys.stderr,
        )
        return 1

    wseg.P_unigram = wseg.ProbDist(str(NGRAM_DIR / "unigram-word.bin"), True)
    wseg.P_bigram = wseg.ProbDist(str(NGRAM_DIR / "bigram-word.bin"), False)

    counters, original_conditional_prob = _instrument_for_hit_counting()

    cases = []
    try:
        for raw in _gather_inputs():
            prepared = raw.replace(" ", "").strip()
            # Clear the function-level lru_cache so a per-input bigram-hit
            # tally is observable in the summary; the cache is purely a
            # performance concern and the result is independent of it.
            wseg.viterbi.cache_clear()
            score, tokens = wseg.viterbi(prepared)
            cases.append({"input": raw, "prepared": prepared, "tokens": list(tokens)})
    finally:
        wseg.conditionalProb = original_conditional_prob

    payload = {
        "format": "myword-reference/v1",
        "description": (
            "Word-segmentation reference fixture generated by running the "
            "VENDORED, CORRECTED myWord word segmenter "
            "(tools/data-pipeline/reference/myword/word_segment.py) against "
            "curated Burmese inputs. The fix restores the bigram lookup to "
            "the tuple-key shape that actually exists in bigram-word.bin "
            "so the Viterbi scorer is now a true unigram+bigram model. The "
            "TypeScript port asserts identical token sequences. Regenerate "
            "via `python app/lib/segmenter/scripts/generate-reference.py`."
        ),
        "source": {
            "unigram": "data/myword/unigram-word.bin",
            "bigram": "data/myword/bigram-word.bin",
            "reference": "tools/data-pipeline/reference/myword/word_segment.py",
            "preprocessing": 'line.replace(" ", "").strip()  # mirrors myWord/myword.py line 161',
            "viterbi_kwargs": {"prev": "<S>", "maxlen": 20},
        },
        "cases": cases,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    hits, misses = counters
    total = hits + misses
    hit_rate = (hits / total) if total else 0.0
    print(
        f"wrote {len(cases)} cases to {OUTPUT_PATH.relative_to(REPO_ROOT)}; "
        f"bigram tuple-key hits: {hits}/{total} ({hit_rate:.1%})"
    )
    if hits == 0:
        print(
            "ERROR: zero bigram tuple-key hits during the run — the fix "
            "is not engaging. Refusing to commit a fixture generated "
            "without bigrams.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
