// The search orchestrator.
//
// Glue between `app/lib/segmenter` and `app/lib/lookup`. Given a single
// user input string, decide which engine(s) to invoke and return a
// structured `SearchResult` describing what the UI should display.
//
// The orchestrator owns the *routing* decisions (Burmese sentence
// breakdown vs. English reverse lookup vs. unrecognized vs. too-long),
// not the engines themselves — segmentation, lookup, normalization, and
// fuzzy all live in the sibling modules and are imported, never
// re-implemented.

import {
  type NgramModel,
  loadNgramModel,
  segmentWords,
} from "@/app/lib/segmenter";
import {
  type AssetSources,
  type DictionaryModel,
  loadDictionary,
  lookupForwardWithCompoundFallback,
  lookupReverse,
  searchBurmese,
  segmentEnglish,
} from "@/app/lib/lookup";

import { DEFAULT_CONFIG, type SearchConfig } from "./config";
import { detectScript } from "./scriptDetect";
import type {
  BreakdownToken,
  SearchResult,
  SingleWordResult,
} from "./types";

/** Loaded orchestrator bundle. `search` / `singleWordSearch` take this
 *  as their first argument; it carries the two underlying engines plus
 *  the active config. */
export interface SearchEngine {
  readonly segmenter: NgramModel;
  readonly dictionary: DictionaryModel;
  readonly config: SearchConfig;
}

/** Input to `load`. Either pre-loaded engines (dependency injection —
 *  the production app loads both engines once at startup and passes
 *  them in here) or asset sources for the orchestrator to load itself.
 *
 *  Dependency injection is the primary path. The source-based path
 *  exists so tests / one-shot scripts can ask the orchestrator to do
 *  the loading without wiring up the sibling modules' loaders
 *  themselves. */
export type LoadInput =
  | {
      kind: "preloaded";
      segmenter: NgramModel;
      dictionary: DictionaryModel;
    }
  | {
      kind: "sources";
      ngramUrl: string;
      dictionarySources: AssetSources;
    };

/** Idempotency cache keyed on the `LoadInput` identity. A second call
 *  with the *same* object returns the cached promise, matching the
 *  sibling modules' load-once-then-query-many discipline. */
const engineCache = new WeakMap<object, Promise<SearchEngine>>();

/** Load (or accept) the two underlying engines and return a queryable
 *  `SearchEngine`. Idempotent against the same `LoadInput` object —
 *  pre-loaded engines are not re-initialized, source-based loading is
 *  not repeated.
 *
 *  Returning a raw `Promise` (rather than declaring `async`) preserves
 *  promise identity for repeat calls — the cache test relies on that. */
export function load(
  input: LoadInput,
  config: Partial<SearchConfig> = {},
): Promise<SearchEngine> {
  const cached = engineCache.get(input);
  if (cached) return cached;

  const promise = (async (): Promise<SearchEngine> => {
    if (input.kind === "preloaded") {
      return {
        segmenter: input.segmenter,
        dictionary: input.dictionary,
        config: { ...DEFAULT_CONFIG, ...config },
      };
    }
    const [segmenter, dictionary] = await Promise.all([
      loadNgramModel(input.ngramUrl),
      loadDictionary(input.dictionarySources),
    ]);
    return {
      segmenter,
      dictionary,
      config: { ...DEFAULT_CONFIG, ...config },
    };
  })();

  engineCache.set(input, promise);
  return promise;
}

/** Synchronous search-as-you-type entry point. Routes the input by
 *  script:
 *
 *    - empty / whitespace-only → `empty`
 *    - over the length cap     → `too_long`
 *    - Burmese / mixed         → segment + eager exact forward-lookup;
 *                                ≥ 2 tokens → `breakdown`, single
 *                                token → `reverse` (via `searchBurmese`)
 *    - Latin                   → segment; ≥ 2 segments → `breakdown`,
 *                                single segment → `reverse` (via
 *                                `lookupReverse`)
 *    - other (digits, etc.)    → `unrecognized`
 *
 *  The single-block → `reverse` collapse is symmetric across scripts:
 *  whenever segmentation produces one block (a natural single word, a
 *  known multi-word phrase like "new year", an article-absorbed "a fish",
 *  a "to <verb>" infinitive) the view switches to the ranked single-word
 *  list. */
export function search(engine: SearchEngine, input: string): SearchResult {
  // Length cap is enforced on the raw input, before trim. The intent is
  // to refuse over-long inputs outright; an over-long input that *would*
  // be empty after trim is still an "over-long" event for the UI.
  if (input.length > engine.config.maxInputLength) {
    return {
      kind: "too_long",
      limit: engine.config.maxInputLength,
      length: input.length,
    };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { kind: "empty" };
  }

  const script = detectScript(trimmed);
  switch (script) {
    case "burmese":
      return burmesePath(engine, trimmed, false);
    case "mixed":
      return burmesePath(engine, trimmed, true);
    case "latin":
      return latinPath(engine, trimmed);
    case "unknown":
      return { kind: "unrecognized" };
  }
}

/** Synchronous single-word / search-box entry point. Detects script
 *  and routes Burmese → `searchBurmese` (exact headword + syllable
 *  fuzzy), Latin → `lookupReverse`. Same edge-case handling as `search`
 *  (empty / too-long / unrecognized). */
export function singleWordSearch(
  engine: SearchEngine,
  input: string,
): SingleWordResult {
  if (input.length > engine.config.maxInputLength) {
    return {
      kind: "too_long",
      limit: engine.config.maxInputLength,
      length: input.length,
    };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { kind: "empty" };
  }

  const script = detectScript(trimmed);
  switch (script) {
    case "burmese":
    case "mixed":
      // Mixed treated as Burmese for the search-box too — consistent
      // with the spec's "treat as Burmese for segmentation" rule.
      return {
        kind: "single_word",
        script: "burmese",
        rows: searchBurmese(engine.dictionary, trimmed),
      };
    case "latin":
      return {
        kind: "single_word",
        script: "latin",
        rows: lookupReverse(engine.dictionary, trimmed),
      };
    case "unknown":
      return { kind: "unrecognized" };
  }
}

/** Upper bound, in segmenter tokens, on how long a run
 *  {@link mergeMaxMatch} tries to recombine. Dictionary headwords are
 *  short compounds; a handful of tokens covers every real multi-syllable
 *  entry while keeping the per-keystroke scan negligible. */
const MAX_MERGE_TOKENS = 8;

/** Maximum-matching pass over the word segmenter's output.
 *
 *  The statistical segmenter is dictionary-blind: it occasionally splits a
 *  compound the dictionary lists as a *single* entry into two higher-
 *  scoring n-gram pieces (e.g. ``မြန်မာစကား`` "the Burmese language" →
 *  ``မြန်မာ`` + ``စကား``). This pass walks the tokens left to right and,
 *  at each position, greedily keeps the LONGEST run of adjacent tokens
 *  that is itself a known headword — so a span that "could have been
 *  matched directly into an entry" stays whole instead of fragmenting
 *  into smaller tiles.
 *
 *  Only runs that are real headwords merge; a token with no longer
 *  dictionary match is emitted unchanged, leaving genuinely-separate
 *  words (and dictionary-absent particles) exactly as the segmenter
 *  produced them. */
function mergeMaxMatch(
  model: DictionaryModel,
  tokens: readonly string[],
): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const limit = Math.min(tokens.length, i + MAX_MERGE_TOKENS);
    let span = "";
    let matchEnd = i; // exclusive end of the longest headword run from i
    for (let j = i; j < limit; j++) {
      span += tokens[j];
      if (model.db.hasHeadword(span)) matchEnd = j + 1;
    }
    if (matchEnd > i + 1) {
      out.push(tokens.slice(i, matchEnd).join(""));
      i = matchEnd;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  return out;
}

/** Burmese (or mixed) path: segment the full input via the word
 *  segmenter, recombine over-split compounds via {@link mergeMaxMatch},
 *  then dispatch by `segmented.length`.
 *
 *    - **1 segment** — a single Burmese block (a one-word input, a
 *      sentence the segmenter collapsed to a single token, or a compound
 *      the maximum-match pass merged back into one dictionary headword).
 *      Route the *original* input through `searchBurmese` so the user
 *      sees the ranked single-word view (exact headword + syllable
 *      fuzzy), matching the Latin single-segment behavior.
 *
 *    - **≥ 2 segments** — sentence breakdown. Eagerly look up each
 *      token. Per-token *fuzzy* fallback (BK-tree near-matches) is
 *      still forbidden by the task spec — it would generate noisy
 *      previews for particles, punctuation, and non-Burmese runs. The
 *      **compound** fallback (`…WithCompoundFallback`) is allowed and
 *      useful: it only kicks in for a strict exact-miss and only
 *      matches a contiguous syllable sub-sequence of the token, so a
 *      segmenter-emitted compound like ``ညီမလေး`` resolves to its head
 *      ``ညီမ`` rather than an empty preview card. No spurious BK-tree
 *      near-misses are introduced. */
function burmesePath(
  engine: SearchEngine,
  input: string,
  mixedInput: boolean,
): SearchResult {
  const segmented = mergeMaxMatch(
    engine.dictionary,
    segmentWords(engine.segmenter, input),
  );
  if (segmented.length <= 1) {
    return {
      kind: "reverse",
      script: "burmese",
      rows: searchBurmese(engine.dictionary, input),
    };
  }
  const tokens: BreakdownToken[] = segmented.map((token) => ({
    token,
    result: lookupForwardWithCompoundFallback(engine.dictionary, token),
  }));
  return {
    kind: "breakdown",
    script: "burmese",
    mixedInput,
    tokens,
  };
}

/** Latin path. View selection follows the *result shape*, not the
 *  surface shape of the input: every English input is run through the
 *  segmenter, then dispatched by `segments.length` — symmetric with the
 *  Burmese path above.
 *
 *    - **1 segment** — a single logical query, whether the input was
 *      one word ("water"), a known multi-word phrase ("thank you"),
 *      a "to <verb>" infinitive that collapses to its stripped head
 *      ("to protect" → "protect"), or an article-absorbed "a <noun>"
 *      that collapses to one tile carrying the noun's match
 *      ("a fish"). Render as the ranked reverse-lookup so the user
 *      sees every Burmese entry that owns the gloss, not a one-tile
 *      breakdown. Passing the *original* input to `lookupReverse`
 *      lets the lookup module's own `normalizeGloss` (lowercase,
 *      collapse-ws, strip leading ``"to "``) reshape the query into
 *      the canonical key — *except* for an article-absorbed segment,
 *      where we route the segment's `reverseLookupKey` (the post-
 *      article portion, "fish" for "a fish") because `normalizeGloss`
 *      does not strip leading articles and the literal "a fish" key
 *      finds nothing in `gloss_groups`.
 *
 *    - **≥ 2 segments** — genuine sentence structure (parse-it-into-
 *      tiles UX). Render the breakdown with one tappable tile per
 *      segment. Article-absorbed segments inside a sentence (e.g. the
 *      third tile of "I see a fish") render in the breakdown via the
 *      forward-lookup result the segmenter already attached — only the
 *      *whole-input collapses to one absorbed segment* case takes the
 *      reverseLookupKey re-route above.
 *
 *  Driving the choice off `segments.length` instead of an input-
 *  surface heuristic also stabilizes the view across keystrokes: a
 *  half-typed "to protec" registers as two unmatched atoms (breakdown,
 *  2 unknown tiles), and the moment the typo resolves to "to protect"
 *  the result collapses to one segment and the view smoothly returns
 *  to the single-query rendering. Without this rule the view would
 *  remain stuck in breakdown mode on a fully-resolved one-segment
 *  input.
 *
 *  Per-segment fuzzy rescue is intentionally NOT performed inside the
 *  segmenter — same rationale as the Burmese eager-exact path: it
 *  would surface noisy near-matches for common short connecting words
 *  like "is" or "the". */
function latinPath(engine: SearchEngine, input: string): SearchResult {
  const segments = segmentEnglish(engine.dictionary, input);
  if (segments.length <= 1) {
    const segment = segments[0];
    const query =
      segment?.mergedWithArticle && segment.reverseLookupKey
        ? segment.reverseLookupKey
        : input;
    return {
      kind: "reverse",
      script: "latin",
      rows: lookupReverse(engine.dictionary, query),
    };
  }
  return {
    kind: "breakdown",
    script: "english",
    mixedInput: false,
    tokens: segments,
  };
}
