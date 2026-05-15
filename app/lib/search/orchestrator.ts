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
  lookupForward,
  lookupReverse,
  searchBurmese,
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
 *    - Burmese / mixed         → segment + eager exact forward-lookup
 *                                per token → `breakdown`
 *    - Latin                   → `reverse` (top-N via `lookupReverse`)
 *    - other (digits, etc.)    → `unrecognized`
 *
 *  Burmese single-word input deliberately stays a `breakdown` of length
 *  one — single-word search-box semantics live in `singleWordSearch`. */
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
      return {
        kind: "reverse",
        rows: lookupReverse(engine.dictionary, trimmed),
      };
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

/** Burmese (or mixed) path: segment the full input via the word
 *  segmenter, then eagerly look up each token with exact forward lookup
 *  ONLY — per-token fuzzy fallback is forbidden by the task spec
 *  (fuzzy at segmentation time would generate noisy previews for
 *  particles, punctuation, and non-Burmese runs). */
function burmesePath(
  engine: SearchEngine,
  input: string,
  mixedInput: boolean,
): SearchResult {
  const segmented = segmentWords(engine.segmenter, input);
  const tokens: BreakdownToken[] = segmented.map((token) => ({
    token,
    result: lookupForward(engine.dictionary, token),
  }));
  return {
    kind: "breakdown",
    mixedInput,
    tokens,
  };
}
