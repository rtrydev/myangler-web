// User-typed Burmese search box. Distinct from `lookupForwardWithFuzzy`,
// which is for the segmenter's per-token use: this function carries the
// same merging + top-10 + fuzzy-inclusion discipline as reverse lookup
// (spec §2.4) but keys on headwords, not glosses.

import type { DictionaryModel } from "./loader";
import { segmentSyllables } from "@/app/lib/segmenter";
import {
  bucketAddEntry,
  bucketEnsure,
  makeBucketMap,
  rankAndResolve,
} from "./reverse";
import type { Entry, ResultRow } from "./types";
import { Tier } from "./types";

/** Search the dictionary with a Burmese query: exact headword first, then
 *  syllable-fuzzy near matches. Same merging rules and top-10 cap as
 *  reverse lookup. Fuzzy is always included at low priority and never
 *  preempts a real headword match. */
export function searchBurmese(
  model: DictionaryModel,
  query: string,
): ResultRow[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const buckets = makeBucketMap();

  // ---- Exact headword tier --------------------------------------------
  const exact: Entry[] = model.db.entriesByHeadword(trimmed);
  if (exact.length > 0) {
    const b = bucketEnsure(buckets, trimmed);
    b.tier = Tier.EXACT;
    b.fuzzy = false;
    b.distance = 0;
    for (const e of exact) bucketAddEntry(b, e.entryId);
  }

  // ---- Fuzzy tier (syllable-level) ------------------------------------
  // Tokenize with the segmenter's syllable splitter — same module the
  // BK-tree was built with at build time.
  const probe = segmentSyllables(trimmed);
  if (probe.length > 0) {
    const matches = model.bktreeMy.query(
      probe,
      model.config.fuzzyThresholdMy,
    );
    for (const fm of matches) {
      const headword = fm.value.join("");
      // The probe coming back at distance 0 — the exact-tier pass
      // already handled it (or no entries exist for it).
      const entries = model.db.entriesByHeadword(headword);
      if (entries.length === 0) continue;
      const b = bucketEnsure(buckets, headword);
      if (b.fuzzy) {
        if (fm.distance < b.distance) b.distance = fm.distance;
      }
      for (const e of entries) bucketAddEntry(b, e.entryId);
    }
  }

  return rankAndResolve(model, buckets, model.config.resultLimit);
}
