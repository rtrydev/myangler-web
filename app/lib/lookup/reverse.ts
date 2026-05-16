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
// nothing from `postings`; the empty-fallback passes below recover
// stopword-only entries via `gloss_groups`.
//
// Empty-fallback discipline: the default-config pass enforces every
// pruning gate (`maxGlossPosition`, `minQueryLengthForFuzzyEn`, and the
// "no single-token gloss_groups" rule) for tight, high-relevance results.
// When that pass returns nothing — typically because the query is a
// stopword, a buried-position meaning, or a short word that fuzzy is
// gated off for — wider passes progressively drop those gates so a valid
// query never silently produces zero results.

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

/** Knobs the single-pass body cares about. Carved out so the empty-
 *  fallback driver below can construct relaxed passes by overriding
 *  individual fields without re-deriving the full `LookupConfig`. */
interface ReversePassOptions {
  maxGlossPosition: number;
  minQueryLengthForFuzzyEn: number;
  fuzzyThresholdEn: number;
  /** When true, single-token queries also consult `gloss_groups`. The
   *  default pass leaves this off so the `maxGlossPosition` gate stays
   *  meaningful for the common single-token case; the empty-fallback
   *  driver flips it on so stopwords and buried-position exact glosses
   *  still surface. */
  includeSingleTokenGlossGroups: boolean;
}

/** One reverse-lookup pass at a given knob configuration. Pure function
 *  of `(model, queryToken, opts)`; the driver below composes multiple
 *  passes for empty-fallback behavior. */
function lookupReverseOnce(
  model: DictionaryModel,
  queryToken: string,
  opts: ReversePassOptions,
): ResultRow[] {
  const buckets = new Map<string, Bucket>();
  const isMultiToken = /\s/.test(queryToken);

  // ---- Real tiers (exact / head / incidental) -------------------------
  for (const p of model.db.postingsForWord(queryToken, opts.maxGlossPosition)) {
    const key = p.normalizedGloss;
    if (!key) continue;
    const b = ensureBucket(buckets, key);
    // Take the strongest tier (numerically lowest) any contributor saw.
    if (p.tier < b.tier) b.tier = p.tier;
    b.fuzzy = false;
    b.distance = 0;
    addEntry(b, p.entryId);
  }

  // Full-gloss exact match via `gloss_groups`. Always on for multi-word
  // queries (postings is keyed by single words and has no row for them).
  // For single-token queries the default pass keeps this off — the
  // postings tier=EXACT path covers the same set under the position gate
  // — but the empty-fallback driver flips it on so stopwords and
  // buried-position exact glosses still surface.
  if (isMultiToken || opts.includeSingleTokenGlossGroups) {
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
  // Run fuzzy when the query is long enough — the spec includes fuzzy
  // alongside real-tier matches (§2.4.2), but distance-1 on a short
  // query (rain → pain/brain/drain) lands on different words, not typos
  // of the same word, so a length floor is applied. The empty-fallback
  // driver may drop the floor to 0 to recover any signal at all. Sort
  // discipline still enforces "never preempts": fuzzy buckets share
  // `tier === FUZZY` and sort after real rows.
  if (queryToken.length >= opts.minQueryLengthForFuzzyEn) {
    const fuzzyMatches = model.bktreeEn.query(
      queryToken,
      opts.fuzzyThresholdEn,
    );
    for (const fm of fuzzyMatches) {
      // The probe itself comes back at distance 0 — that contributes
      // nothing the real-tier pass didn't already capture.
      if (fm.value === queryToken) continue;
      for (const p of model.db.postingsForWord(fm.value, opts.maxGlossPosition)) {
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

/** Reverse-lookup: produce up to `config.resultLimit` ranked result rows
 *  for the English query.
 *
 *  Runs a default-config pass first (every pruning gate active) and only
 *  falls back to wider passes when the previous one returned nothing.
 *  The fallback ladder exists because stopwords ("that", "this", …) are
 *  excluded from the `postings` table at build time and queries whose
 *  match lives past the `maxGlossPosition` cap would otherwise vanish.
 *  Each pass relaxes exactly one gate so the *first* widening that
 *  yields anything wins — short of the user typing a typo we still
 *  prefer narrow, high-relevance results. */
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

  // Pass ladder: tight → drop position gate + open single-token
  // gloss_groups → also drop fuzzy length gate. Stops at the first pass
  // that yields any rows.
  const passes: ReversePassOptions[] = [
    {
      maxGlossPosition: model.config.maxGlossPosition,
      minQueryLengthForFuzzyEn: model.config.minQueryLengthForFuzzyEn,
      fuzzyThresholdEn: model.config.fuzzyThresholdEn,
      includeSingleTokenGlossGroups: false,
    },
    {
      maxGlossPosition: Number.POSITIVE_INFINITY,
      minQueryLengthForFuzzyEn: model.config.minQueryLengthForFuzzyEn,
      fuzzyThresholdEn: model.config.fuzzyThresholdEn,
      includeSingleTokenGlossGroups: true,
    },
    {
      maxGlossPosition: Number.POSITIVE_INFINITY,
      minQueryLengthForFuzzyEn: 0,
      fuzzyThresholdEn: model.config.fuzzyThresholdEn,
      includeSingleTokenGlossGroups: true,
    },
  ];

  for (const opts of passes) {
    const rows = lookupReverseOnce(model, queryToken, opts);
    if (rows.length > 0) return rows;
  }
  return [];
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
