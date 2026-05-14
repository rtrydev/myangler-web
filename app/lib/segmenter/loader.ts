// Asset loader for the `myword-ngram/v1` JSON model.
//
// Loading is decoupled from segmentation: callers fetch (or `import`) the
// asset bytes once, hand them to `parseNgramModel`/`loadNgramModel`, and
// then call `segmentWords` synchronously many times against the returned
// model.

import type { NgramAsset, NgramModel } from "./types";

export const NGRAM_FORMAT_TAG = "myword-ngram/v1";

/** Hardcoded denominator from `myWord/word_segment.py`'s `ProbDist`
 *  (`def __init__(self, datafile=None, unigram=True, N=102490)`). The
 *  port preserves it verbatim — the data pipeline ships raw counts so a
 *  future task can swap normalization without re-shipping the asset. */
export const MYWORD_N = 102490;

/** Thrown when the loaded asset's shape does not match the
 *  `myword-ngram/v1` contract. Callers should treat this as fatal —
 *  segmentation cannot proceed against a mismatched asset. */
export class NgramFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NgramFormatError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate-and-parse a value previously parsed from JSON into the
 *  in-memory `NgramModel`. Throws `NgramFormatError` if the shape is
 *  wrong — including a missing/mismatched `format` field. */
export function parseNgramModel(payload: unknown): NgramModel {
  if (!isObject(payload)) {
    throw new NgramFormatError(
      `expected ngram asset to be a JSON object, got ${typeof payload}`,
    );
  }
  if (payload.format !== NGRAM_FORMAT_TAG) {
    throw new NgramFormatError(
      `expected ngram asset format ${JSON.stringify(NGRAM_FORMAT_TAG)}, ` +
        `got ${JSON.stringify(payload.format)}`,
    );
  }
  if (!isObject(payload.unigram)) {
    throw new NgramFormatError("ngram asset is missing the `unigram` map");
  }
  if (!isObject(payload.bigram)) {
    throw new NgramFormatError("ngram asset is missing the `bigram` map");
  }

  const asset = payload as unknown as NgramAsset;

  const unigram = new Map<string, number>();
  for (const [k, v] of Object.entries(asset.unigram)) {
    if (typeof v !== "number") {
      throw new NgramFormatError(
        `unigram entry ${JSON.stringify(k)} is not a number`,
      );
    }
    unigram.set(k, v);
  }

  const bigram = new Map<string, Map<string, number>>();
  for (const [prev, inner] of Object.entries(asset.bigram)) {
    if (!isObject(inner)) {
      throw new NgramFormatError(
        `bigram entry ${JSON.stringify(prev)} is not an object`,
      );
    }
    const innerMap = new Map<string, number>();
    for (const [curr, count] of Object.entries(inner)) {
      if (typeof count !== "number") {
        throw new NgramFormatError(
          `bigram entry ${JSON.stringify(prev)}/${JSON.stringify(curr)} ` +
            "is not a number",
        );
      }
      innerMap.set(curr, count);
    }
    bigram.set(prev, innerMap);
  }

  return {
    N: MYWORD_N,
    unigram,
    bigram,
    unigramCount: asset.unigram_count,
    unigramTotal: asset.unigram_total,
    bigramCount: asset.bigram_count,
    bigramTotal: asset.bigram_total,
  };
}

/** Browser-friendly loader: fetch + parse + validate. Use this once on
 *  app startup; pass the returned model into `segmentWords` for every
 *  subsequent call. */
export async function loadNgramModel(url: string): Promise<NgramModel> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `failed to fetch ngram asset from ${url}: ${response.status} ${response.statusText}`,
    );
  }
  const payload = (await response.json()) as unknown;
  return parseNgramModel(payload);
}
