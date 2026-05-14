# `app/lib/segmenter` — Burmese segmenter (TS port of myWord)

Framework-agnostic TypeScript module that ports the
[myWord](https://github.com/ye-kyaw-thu/myWord) Burmese **word segmenter**
to JavaScript so it can run in the PWA, fully client-side. No React /
Next imports — this is a plain library the app consumes.

The reference implementation this port is verified against is the
**vendored, corrected** myWord segmenter at
[`tools/data-pipeline/reference/myword/word_segment.py`](../../../tools/data-pipeline/reference/myword/word_segment.py),
which fixes a long-standing bigram-key-shape bug in upstream myWord
that left bigrams loaded-but-unused (see "The bug we fixed" below).
This module is a **true unigram+bigram Viterbi** segmenter — every
Viterbi step consults `bigram[prev][curr]`.

The implementation lives in three files plus an asset loader:

| File | Responsibility |
|---|---|
| `syllable.ts` | TS port of `tools/data-pipeline/src/data_pipeline/syllable.py`; produces identical syllable clusters to the Python reference. |
| `wordSegmenter.ts` | TS port of `myWord/word_segment.py`; Viterbi over the unigram/bigram model. |
| `loader.ts` | Loads + validates the `myword-ngram/v1` JSON asset emitted by the data pipeline. |
| `types.ts` | `NgramAsset` / `NgramModel` types. |
| `index.ts` | Re-exports the public surface. |

## Public API

```ts
import {
  // Asset loading
  loadNgramModel,    // (url) => Promise<NgramModel> — fetch + parse + validate
  parseNgramModel,   // (jsonValue) => NgramModel — parse + validate (no I/O)
  NgramFormatError,  // thrown on shape / format-tag mismatch

  // Word segmentation
  segmentWords,      // (model, line) => string[] — preprocesses then segments
  segmentPrepared,   // (model, prepared) => string[] — caller-managed preprocess
  preprocess,        // (line) => string — line.replace(" ", "").trim()

  // Syllable segmentation (used by Burmese fuzzy search; spec §2.5)
  segmentSyllables,  // (text) => string[]
} from "@/app/lib/segmenter";

const model = await loadNgramModel("/data/ngram.json");
segmentWords(model, "မြန်မာစာပြောတယ်");
// → ["မြန်မာ", "စာ", "ပြော", "တယ်"]  (or similar — depends on the model)
```

The intended consumption pattern is **load once, segment many times**.
`loadNgramModel` is async (it fetches the asset); `segmentWords` is
synchronous and pure — safe to call repeatedly without re-fetching or
re-parsing the model.

For tests / Node contexts where `fetch` is awkward, parse the asset
yourself and call `parseNgramModel`:

```ts
import { readFileSync } from "node:fs";
const payload = JSON.parse(readFileSync("./ngram.json", "utf8"));
const model = parseNgramModel(payload);
```

## The ported algorithm (mirrors the corrected reference)

```
viterbi(text, prev='<S>', maxlen=20):
  if not text: return (0.0, [])
  for i in 0 .. min(len(text), maxlen) - 1:
    first = text[:i+1]; remain = text[i+1:]
    first_prob = log10(conditionalProb(first, prev))
    (remain_prob, remain_tokens) = viterbi(remain, first)
    candidates.append((first_prob + remain_prob, [first, ...remain_tokens]))
  return max(candidates)

conditionalProb(curr, prev):
  try:    return P_bigram[(prev, curr)] / P_unigram[prev]     # tuple key
  except KeyError: return P_unigram(curr)                     # backoff

P_unigram(curr) = unigram[curr] / N         if known
                = 10 / (N * 10**len(curr))   otherwise   # `len` = codepoints
```

Constants taken verbatim from upstream:

- `N = 102490` (the hardcoded `ProbDist` denominator).
- `maxlen = 20` codepoints — the longest word the segmenter will consider.
- Tie-breaking: Python's `max()` on `(score, tokens)` tuples
  (lexicographic on the token list when scores tie). The port replicates
  this with an explicit `compareCandidates`.

The pre-Viterbi tokenization is **codepoint-level**, not syllable-level —
upstream slices the raw Python string with `text[:i+1]`. The port slices
a `Array.from(text)` codepoint array so the indexing matches Python's
string indexing (and surrogate pairs in any stray non-BMP characters
stay paired).

### The bug we fixed

Upstream `myWord/word_segment.py` looked up bigrams by `f"{prev} {curr}"`
*strings*, but the bigram pickle is keyed by `(prev, curr)` *tuples*
(verified in `tools/data-pipeline/README.md` and the conversion step).
Every bigram lookup raised `KeyError` and fell through to the unigram
path, making the Viterbi scorer effectively unigram-only and leaving the
~24 MiB bigram dictionary loaded but never consulted.

The corrected vendored reference at
`tools/data-pipeline/reference/myword/word_segment.py` switches the
lookup to the tuple shape that actually exists in the pickle:

```diff
-    return P_bigram[word_prev + ' ' + word_curr] / P_unigram[word_prev]
+    return P_bigram[(word_prev, word_curr)]      / P_unigram[word_prev]
```

Every other line of the algorithm is preserved verbatim (Viterbi
structure, `maxlen=20`, `N=102490`, codepoint slicing, lex tiebreak,
the `10/(N*10**len(k))` unigram unknown smoothing, and the `KeyError`
fall-through to unigram backoff). This port mirrors the corrected
reference and the `bigram` field of `NgramModel` is consulted on every
step via `bigram.get(prev)?.get(curr)`.

Two regression checks guard against accidentally regressing back to the
buggy unigram-only behaviour:

* **Python side** —
  `tools/data-pipeline/tests/test_reference_myword.py` runs the vendored
  reference against a synthetic dictionary where unigram-only and
  bigram-aware Viterbi pick different segmentations, and also
  instruments `conditionalProb` to count tuple-key hits.
* **TS side** — `wordSegmenter.test.ts` reproduces the same
  discriminator case and additionally wraps `model.bigram.get` to count
  hits, ensuring the bigram map is *observed to be read* during
  segmentation.

### Edge cases (mirrored from upstream, not invented here)

| Input | Behavior | Source of behavior |
|---|---|---|
| `""` (empty) | `[]` | `viterbi(...)` returns `(0.0, [])` for empty input |
| Whitespace-only | `[]` after `line.replace(" ", "").strip()` | `myword.py` line 161 |
| ASCII letters / digits / punctuation | Each codepoint considered as an unknown unigram, scored via `unknownprob` | `ProbDist.__call__` |
| Burmese with embedded ASCII spaces | Spaces are stripped before Viterbi | `myword.py` line 161 |

## The n-gram asset (`myword-ngram/v1`)

Produced by `tools/data-pipeline/src/data_pipeline/steps/convert_ngram.py`
from the upstream myWord pickles. The full schema lives in
[`tools/data-pipeline/README.md`](../../../tools/data-pipeline/README.md#output-ngramjson-frontend-contract);
the loader treats the `format: "myword-ngram/v1"` field as a hard
contract and refuses to load anything else.

### Asset provenance / sync

The asset is **not** committed under `public/data/`. The data-pipeline
output (`tools/data-pipeline/build/ngram.json`, ~32 MB) is the single
source of truth, and `public/data/` is git-ignored to avoid drifting
duplicates. To refresh what the frontend ships:

```bash
# 1. Rebuild the pipeline output (only when the n-gram inputs change).
data-pipeline convert-ngram

# 2. Copy it into the PWA's public/ directory.
npm run sync:segmenter-asset
```

The sync script (`scripts/sync-asset.mjs`) is a thin file copy — the
`npm run` target is the documented entry point.

## Tests

Run with `npm test` (vitest, jsdom). Four test files live next to the
implementation:

- `syllable.test.ts` — asserts the shared cross-language syllable corpus
  (`__fixtures__/syllable-corpus.json`). The same JSON is consumed by
  `tools/data-pipeline/tests/test_syllable_corpus.py`, so both
  languages are pinned to one source of truth.
- `loader.test.ts` — happy-path parse, fetch wiring, and shape /
  `format`-tag rejection.
- `wordSegmenter.test.ts` — synchronous load-once-segment-many API,
  preprocessing semantics, edge cases (empty, whitespace, mixed
  script).
- `parity.test.ts` — runs the port against **every** input in the
  Python reference fixture (`__fixtures__/reference-corpus.json`) using
  the **full** `ngram.json` asset and asserts identical token sequences.
  This is the load-bearing parity test — it covers `myWord/test1.txt`,
  a stripped `test2.txt`, and explicit edge cases. Skipped (with a
  visible placeholder) when the full asset has not been synced.

The Python side keeps the syllable corpus pinned via
`tools/data-pipeline/tests/test_syllable_corpus.py` (run with
`pytest tools/data-pipeline`).

## Reference fixture (corrected Python ground truth)

The parity test asserts against
[`__fixtures__/reference-corpus.json`](__fixtures__/reference-corpus.json),
generated by running the **vendored, corrected** Python segmenter
(`tools/data-pipeline/reference/myword/word_segment.py`) over a curated
corpus. The corpus *inputs* are the same as before the bigram fix; the
*outputs* are the corrected baseline (bigrams now engaged).

### How the corpus was assembled

1. `myWord/test1.txt` — myWord's own bundled raw (space-stripped) test
   sentences. Most authoritative because they ship with upstream.
2. `myWord/test2.txt` (each line space-stripped to look like raw user
   input) — adds longer sentences with punctuation, digits, parentheses,
   parenthetical years, and rare vocabulary that exercise the
   unknown-word smoothing path.
3. `myWord/one_line.txt` — minimal short input.
4. A small in-script `EXTRA_INPUTS` list — explicit edge cases:
   empty input, whitespace-only, pure ASCII (`"abc"`), ASCII+Burmese
   mixing, Burmese with ASCII punctuation and digits, and
   known-ambiguous segmentations.

Inputs are deduplicated on their preprocessed form (`replace(" ", "").strip()`)
so files containing the same sentence in two formattings don't
double-count.

### How to regenerate

Requires the myWord pickles in `data/myword/` (see
`tools/data-pipeline/README.md` for setup):

```bash
python app/lib/segmenter/scripts/generate-reference.py
```

Re-run this after touching `myWord/`, the corpus selection, or the
preprocessing. Commit the regenerated fixture.

## Documented divergences from the corrected Python reference

**None.** The latest run of `parity.test.ts` against the full
`ngram.json` agrees with the corrected Python reference on every case in
`reference-corpus.json`. If a future change introduces a divergence, the
parity test surfaces it (input, expected tokens, observed tokens) and a
divergence entry must be added here with the root cause before merging.
