# `reference/` — corrected, vendored myWord reference

This directory holds a **vendored, corrected** copy of the
[myWord](https://github.com/ye-kyaw-thu/myWord) word segmenter. It is
the reference implementation that the TypeScript port in
`app/lib/segmenter/` is verified against.

## Contents

```
reference/
└── myword/
    ├── __init__.py
    └── word_segment.py   # corrected port of myWord/word_segment.py
```

Only the word-segmentation core is vendored — the upstream syllable
segmenter (`myWord/syl_segment.py`) and phrase segmenter
(`myWord/phrase_segment.py`) are not used by this repo. The Python
syllable segmenter we use lives at
`tools/data-pipeline/src/data_pipeline/syllable.py` and is unaffected
by this task.

## What changed from upstream

`myWord/word_segment.py` builds bigram lookup keys as `"prev curr"`
strings, but `bigram-word.bin` is keyed by `(prev, curr)` tuples
(verified against `myWord/word_dict.py::count_bigram` and against the
pickle itself). Every bigram lookup therefore raised `KeyError`, the
segmenter silently fell back to unigram-only scoring, and the bigram
dictionary was loaded but never consulted.

The corrected version switches the lookup to the tuple shape that
actually exists in the pickle:

```diff
-    return P_bigram[word_prev + ' ' + word_curr] / P_unigram[word_prev]
+    return P_bigram[(word_prev, word_curr)]      / P_unigram[word_prev]
```

Every other line of the algorithm is preserved verbatim: Viterbi
structure, `maxlen=20`, `N=102490`, codepoint-based slicing (Python
`str` indexing), lexicographic `max(candidates)` tiebreak, the
`10/(N*10**len(k))` unknown-word smoothing for unigrams, and the
`KeyError` fall-through to unigram backoff when a `(prev, curr)` pair
is not in the training data.

## Boundary with the build pipeline

The build pipeline (`strip`, `index-en`, `build-db`, the BK-trees,
`convert-ngram`, etc.) does **not** import anything from this
directory. It exists only to:

1. Be the corrected reference implementation against which the
   TypeScript port is verified, and
2. Regenerate
   `app/lib/segmenter/__fixtures__/reference-corpus.json` via
   `app/lib/segmenter/scripts/generate-reference.py`.

Because this code is intentionally outside `src/data_pipeline/`, the
data-pipeline package install (`pip install -e tools/data-pipeline`)
does **not** pick it up. Callers add this directory to `sys.path`
(the fixture generator and the regression test both do — see those
files).

## Why vendor instead of importing the upstream clone

Task 05 chose to fix the bug and ship the fix. Importing the original
buggy file from `myWord/` and monkey-patching it would have left the
fix invisible to anyone reading the code, and would have made the
repo's behaviour depend on the state of an external clone. Vendoring
the corrected file localises the fix and pins the reference shape.
