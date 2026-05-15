// Public types for the search orchestrator.
//
// The result type is a discriminated union so the UI can branch
// exhaustively on `kind` without runtime guessing. The shape is stable
// and serializable (no functions, no class instances, no `Date` / `Map`)
// — every payload is plain JSON.

import type { Entry, ForwardResult, ResultRow } from "@/app/lib/lookup";

/** Script class detected by `detectScript`. Burmese / Latin tracks come
 *  with neutral-character handling: digits, whitespace, ASCII punctuation
 *  and common symbols never on their own classify a string. */
export type Script = "burmese" | "latin" | "mixed" | "unknown";

/** One block in a Burmese (or mixed) breakdown: the segmented token paired
 *  with its eager forward-lookup result. `result` is `null` when the token
 *  is not a known headword (a "miss"). Per-token fuzzy fallback is
 *  intentionally NOT performed here — see the README for rationale. */
export interface BreakdownToken {
  /** The segmented token, exactly as produced by `segmentWords`. */
  token: string;
  /** Exact forward-lookup result for the token, or `null` on a miss. */
  result: ForwardResult | null;
}

/** Discriminated union of every result the orchestrator can produce. */
export type SearchResult =
  | EmptyResult
  | TooLongResult
  | UnrecognizedResult
  | BreakdownResult
  | ReverseResult;

/** Input was empty after trimming outer whitespace. */
export interface EmptyResult {
  kind: "empty";
}

/** Input exceeded the configured length cap. The cap is reported so the
 *  UI can render an accurate message; the original input is not echoed
 *  back. */
export interface TooLongResult {
  kind: "too_long";
  /** The configured cap, in codepoints. */
  limit: number;
  /** The length the orchestrator measured, in codepoints. */
  length: number;
}

/** Input contained no Burmese or Latin letters — digits-only,
 *  punctuation-only, other-script, etc. No engine was invoked. */
export interface UnrecognizedResult {
  kind: "unrecognized";
}

/** Burmese (or mixed) input: an ordered breakdown of segmented tokens,
 *  each carrying its eager exact-forward-lookup result. */
export interface BreakdownResult {
  kind: "breakdown";
  /** `true` when the input contained both Burmese and Latin letters. The
   *  Burmese segmenter still drives token extraction; non-Burmese runs
   *  segment but generally do not yield dictionary hits. */
  mixedInput: boolean;
  tokens: BreakdownToken[];
}

/** Latin-only input: ranked top-N reverse-lookup result. */
export interface ReverseResult {
  kind: "reverse";
  /** Top-N rows produced by the lookup module's `lookupReverse`. */
  rows: ResultRow[];
}

/** Discriminated union of every result `singleWordSearch` can produce. */
export type SingleWordResult =
  | EmptyResult
  | TooLongResult
  | UnrecognizedResult
  | SingleWordBurmeseResult
  | SingleWordEnglishResult;

/** Single-word Burmese query routed through `searchBurmese` — exact
 *  headword + syllable fuzzy, top-N. */
export interface SingleWordBurmeseResult {
  kind: "single_word";
  script: "burmese";
  rows: ResultRow[];
}

/** Single-word English query routed through `lookupReverse`. */
export interface SingleWordEnglishResult {
  kind: "single_word";
  script: "latin";
  rows: ResultRow[];
}

/** Re-exported for callers that want to consume `BreakdownToken.result`
 *  or `ReverseResult.rows` without a second import. */
export type { Entry, ForwardResult, ResultRow };
