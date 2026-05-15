// Build a small in-memory `SearchEngine` for the orchestrator tests.
//
// The segmenter side uses the tiny-ngram fixture from
// `app/lib/segmenter/__fixtures__/`. The dictionary side uses the
// lookup module's `buildFixtureModel`, which spins up a real sql.js DB
// and matching BK-trees.

import tinyNgram from "@/app/lib/segmenter/__fixtures__/tiny-ngram.json";
import { parseNgramModel } from "@/app/lib/segmenter";
import {
  buildFixtureModel,
  type FixtureEntry,
} from "@/app/lib/lookup/__fixtures__/buildFixture";
import { load, type SearchEngine } from "../orchestrator";
import type { SearchConfig } from "../config";

/** Fixture entries for the orchestrator's unit tests. Headwords align
 *  with the tiny-ngram fixture's unigrams so the segmenter's output
 *  tokens have predictable hits and misses against the dictionary. */
export const SEARCH_FIXTURE: FixtureEntry[] = [
  // မြန်မာ (Burma) — hit, will appear in segmented breakdown.
  { entryId: 0, headword: "မြန်မာ", pos: "noun", glosses: ["Burma"] },
  // စကား (speech / language) — hit.
  { entryId: 1, headword: "စကား", pos: "noun", glosses: ["speech"] },
  // ပြော (to speak) — hit; gloss is "speak" so reverse-lookup for
  // "speak" returns this entry.
  { entryId: 2, headword: "ပြော", pos: "verb", glosses: ["speak"] },
  // က is intentionally absent — its eager forward-lookup will MISS,
  // exercising the null-result branch of the breakdown.
  // A pure English-side entry so reverse lookup has more to chew on.
  { entryId: 3, headword: "ရေ", pos: "noun", glosses: ["water"] },
];

/** Construct a ready-to-query orchestrator engine using the shared
 *  fixtures. Tests can pass a partial config override. */
export async function buildSearchEngine(
  config: Partial<SearchConfig> = {},
): Promise<SearchEngine> {
  const segmenter = parseNgramModel(tinyNgram);
  const dictionary = await buildFixtureModel(SEARCH_FIXTURE);
  return load(
    { kind: "preloaded", segmenter, dictionary },
    config,
  );
}
