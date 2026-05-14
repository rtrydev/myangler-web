// Shared types for the myWord segmenter port.

/** Raw shape of the `myword-ngram/v1` JSON asset emitted by the data
 *  pipeline (`tools/data-pipeline/src/data_pipeline/steps/convert_ngram.py`).
 *  See `tools/data-pipeline/README.md` → "Output: ngram.json" for the
 *  authoritative contract. */
export interface NgramAsset {
  format: "myword-ngram/v1";
  source: { unigram: string; bigram: string };
  unigram_count: number;
  unigram_total: number;
  bigram_count: number;
  bigram_total: number;
  unigram: Record<string, number>;
  bigram: Record<string, Record<string, number>>;
}

/** In-memory model the Viterbi segmenter consumes.
 *
 *  Construct via `loadNgramModel`; do not build directly. The `bigram`
 *  map is consulted on every Viterbi step via
 *  `bigram.get(prev)?.get(curr)` — see `wordSegmenter.ts::conditionalProb`,
 *  which mirrors the corrected Python reference at
 *  `tools/data-pipeline/reference/myword/word_segment.py`. */
export interface NgramModel {
  /** Hardcoded denominator from the upstream `ProbDist`. */
  readonly N: number;
  readonly unigram: ReadonlyMap<string, number>;
  readonly bigram: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly unigramCount: number;
  readonly unigramTotal: number;
  readonly bigramCount: number;
  readonly bigramTotal: number;
}
