// Reverse lookup (English → Burmese) with the tiered ranking from spec
// §2.4.
//
// Pipeline:
//   1. Normalize the query the same way the build pipeline normalized
//      glosses (lowercase, trim, strip leading "to ").
//   2. Pull every posting for the normalized query word, ordered by tier.
//      The (tier, entry_id, gloss_index) primary key on `postings` makes
//      this a single index range scan.
//   3. Bucket postings by their normalized gloss — entries sharing the
//      same normalized gloss collapse into one merged result row, and
//      the row's tier is the *highest* (numerically lowest) tier among
//      its contributors (spec §2.4.3).
//   4. Fuzzy: query the English BK-tree at the configured threshold.
//      For each near-match gloss-word, repeat the posting lookup → merge
//      step, but tag the resulting rows with FUZZY so they are sorted
//      after exact / head / incidental and never preempt them
//      (spec §2.4.2).
//   5. Cap at `config.resultLimit` (10 by default; spec §2.4.4).
//
// Stopwords: the inverted index already excluded them at build time. If
// the user queries a stopword, the exact/head/incidental tiers return
// nothing; the fuzzy tier may still fire and turn up near-misses.

import type { DictionaryModel } from "./loader";
import { normalizeGloss } from "./normalize";
import type { Entry, ResultRow, TierValue } from "./types";
import { Tier } from "./types";

interface Bucket {
  /** Best (lowest int) tier seen among contributors. */
  tier: TierValue;
  /** Whether every contribution was fuzzy. Cleared when a real-tier row
   *  hits the same key — that key is then a real row, not a fuzzy row. */
  fuzzy: boolean;
  /** Min edit distance among fuzzy contributors; 0 for any real-tier
   *  contributor. */
  distance: number;
  entryIds: number[];
  /** Set of `entryIds` for O(1) dedupe within a bucket. */
  seen: Set<number>;
}

function ensureBucket(buckets: Map<string, Bucket>, key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = {
      tier: Tier.FUZZY,
      fuzzy: true,
      distance: Number.POSITIVE_INFINITY,
      entryIds: [],
      seen: new Set<number>(),
    };
    buckets.set(key, b);
  }
  return b;
}

function addEntry(b: Bucket, entryId: number): void {
  if (b.seen.has(entryId)) return;
  b.seen.add(entryId);
  b.entryIds.push(entryId);
}

/** Reverse-lookup: produce up to `config.resultLimit` ranked result rows
 *  for the English query. */
export function lookupReverse(
  model: DictionaryModel,
  query: string,
): ResultRow[] {
  const normalized = normalizeGloss(query);
  if (!normalized) return [];

  // The inverted index (`postings`) keys on single gloss-words. For a
  // single-word query that path captures every real tier (exact / head /
  // incidental). For a multi-word query like "go up" postings has no row
  // — the EXACT tier instead lives on `gloss_groups`, which records
  // every entry that owns the full normalized gloss.
  const queryToken = normalized;

  const buckets = new Map<string, Bucket>();
  const maxPos = model.config.maxGlossPosition;
  // The relevance gate is meaningful for single-word queries: the
  // postings table is keyed by individual gloss-words, so the
  // `gloss_index` filter implies "the matched word is among the
  // entry's top-N meanings". For a multi-word query like "go up",
  // postings carries no row (postings keys on single words); we fall
  // back to the gloss_groups path below, which has no per-entry
  // position information.
  const isMultiToken = /\s/.test(queryToken);

  // ---- Real tiers (exact / head / incidental) -------------------------
  for (const p of model.db.postingsForWord(queryToken, maxPos)) {
    const key = p.normalizedGloss;
    if (!key) continue;
    const b = ensureBucket(buckets, key);
    // Take the strongest tier (numerically lowest) any contributor saw.
    if (p.tier < b.tier) b.tier = p.tier;
    b.fuzzy = false;
    b.distance = 0;
    addEntry(b, p.entryId);
  }

  // Multi-word exact-gloss safety net. Only fires for multi-word
  // queries — for single-token queries every entry returned here is
  // already in the postings result above (postings tier=EXACT covers
  // the same set), and re-adding them would bypass the
  // `maxGlossPosition` relevance gate.
  if (isMultiToken) {
    const exactGlossEntries = model.db.entryIdsForNormalizedGloss(queryToken);
    if (exactGlossEntries.length > 0) {
      const b = ensureBucket(buckets, queryToken);
      if (Tier.EXACT < b.tier) b.tier = Tier.EXACT;
      b.fuzzy = false;
      b.distance = 0;
      for (const id of exactGlossEntries) addEntry(b, id);
    }
  }

  // ---- Fuzzy tier -----------------------------------------------------
  // Always run fuzzy when the query is long enough — the spec includes
  // fuzzy alongside real-tier matches (§2.4.2), but distance-1 on a
  // short query (rain → pain/brain/drain) lands on different words,
  // not typos of the same word, so a length floor is applied. Sort
  // discipline still enforces "never preempts": fuzzy buckets share
  // `tier === FUZZY` and sort after real rows.
  if (queryToken.length >= model.config.minQueryLengthForFuzzyEn) {
    const fuzzyMatches = model.bktreeEn.query(
      queryToken,
      model.config.fuzzyThresholdEn,
    );
    for (const fm of fuzzyMatches) {
      // The probe itself comes back at distance 0 — that contributes
      // nothing the real-tier pass didn't already capture.
      if (fm.value === queryToken) continue;
      for (const p of model.db.postingsForWord(fm.value, maxPos)) {
        const key = p.normalizedGloss;
        if (!key) continue;
        const b = ensureBucket(buckets, key);
        // If a real-tier posting already populated this bucket, leave
        // it alone — the bucket is a real row, not a fuzzy row.
        // Otherwise remember the smallest BK-tree distance we saw.
        if (b.fuzzy) {
          if (fm.distance < b.distance) b.distance = fm.distance;
        }
        addEntry(b, p.entryId);
      }
    }
  }

  return rankAndResolve(model, buckets, model.config.resultLimit);
}

/** Shared post-processing: turn the bucket map into ranked, resolved
 *  rows. Exposed at module level so Burmese search can reuse the same
 *  ordering shape. */
export function rankAndResolve(
  model: DictionaryModel,
  buckets: Map<string, Bucket>,
  limit: number,
): ResultRow[] {
  const items: Array<{ key: string; bucket: Bucket }> = [];
  for (const [key, bucket] of buckets) items.push({ key, bucket });

  // Real rows (any tier < FUZZY) come first. Within real rows: tier
  // ascending, then key ascending for determinism. Fuzzy rows then sort
  // by distance ascending, then key ascending.
  items.sort((a, b) => {
    const aReal = !a.bucket.fuzzy;
    const bReal = !b.bucket.fuzzy;
    if (aReal && !bReal) return -1;
    if (!aReal && bReal) return 1;
    if (aReal && bReal) {
      if (a.bucket.tier !== b.bucket.tier) return a.bucket.tier - b.bucket.tier;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    }
    if (a.bucket.distance !== b.bucket.distance) {
      return a.bucket.distance - b.bucket.distance;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const capped = items.slice(0, limit);
  // Batch-fetch the entries for every surviving bucket.
  const allIds = new Set<number>();
  for (const it of capped) for (const id of it.bucket.entryIds) allIds.add(id);
  const entries = model.db.entriesByIds([...allIds]);
  const byId = new Map<number, Entry>(entries.map((e) => [e.entryId, e]));

  return capped.map(({ key, bucket }) => ({
    tier: bucket.tier,
    fuzzy: bucket.fuzzy,
    distance: bucket.fuzzy ? bucket.distance : 0,
    key,
    entries: bucket.entryIds
      .map((id) => byId.get(id))
      .filter((e): e is Entry => e !== undefined),
  }));
}

/** Exposed so `searchBurmese` can build buckets the same shape. */
export type ReverseBucket = Bucket;
export function makeBucketMap(): Map<string, Bucket> {
  return new Map<string, Bucket>();
}
export function bucketEnsure(
  buckets: Map<string, Bucket>,
  key: string,
): Bucket {
  return ensureBucket(buckets, key);
}
export function bucketAddEntry(b: Bucket, entryId: number): void {
  addEntry(b, entryId);
}
