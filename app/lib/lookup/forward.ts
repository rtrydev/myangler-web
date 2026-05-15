// Forward lookup: Burmese headword → entry.
//
// The plain forward path returns at most one merged result (with
// `mergedPeers` filled in when other entries share a normalized gloss).
// The fuzzy-fallback path is meant for the search box / per-token
// segmenter use: exact first, otherwise near-syllable BK-tree matches.

import type { DictionaryModel } from "./loader";
import { segmentSyllables } from "@/app/lib/segmenter";
import type { Entry, ForwardResult, ResultRow } from "./types";
import { Tier } from "./types";

/** Forward lookup by headword. Returns `null` on a miss. When the headword
 *  resolves to multiple raw entries (same headword, different POS, etc.)
 *  the first is the primary `entry` and the others — plus any peers
 *  sharing a normalized gloss with the primary — land in `mergedPeers`.
 */
export function lookupForward(
  model: DictionaryModel,
  headword: string,
): ForwardResult | null {
  const direct = model.db.entriesByHeadword(headword);
  if (direct.length === 0) return null;

  const primary = direct[0];
  const peers: Entry[] = direct.slice(1);
  const seen = new Set<number>([primary.entryId, ...peers.map((e) => e.entryId)]);

  // Spec §2.4.3 — peers sharing an identical normalized gloss are
  // surfaced together. Collect entry IDs across every normalized gloss
  // of the primary, then fetch them in one batch.
  const peerIds: number[] = [];
  for (const norm of primary.normalizedGlosses) {
    if (!norm) continue;
    for (const id of model.db.entryIdsForNormalizedGloss(norm)) {
      if (seen.has(id)) continue;
      seen.add(id);
      peerIds.push(id);
    }
  }
  if (peerIds.length > 0) {
    peers.push(...model.db.entriesByIds(peerIds));
  }

  return { entry: primary, mergedPeers: peers };
}

/** Forward lookup with a fuzzy fallback. On an exact hit, returns a single
 *  exact-tier row containing the entry and any merged peers. On a miss,
 *  queries the Burmese BK-tree at the configured syllable threshold and
 *  returns one row per matched headword (deduplicated, each row carrying
 *  every entry that shares that headword).
 *
 *  Rows are capped at `config.resultLimit`. Fuzzy rows are sorted by
 *  syllable distance ascending, then by headword for determinism. */
export function lookupForwardWithFuzzy(
  model: DictionaryModel,
  headword: string,
): ResultRow[] {
  const exact = lookupForward(model, headword);
  const rows: ResultRow[] = [];
  if (exact) {
    rows.push({
      tier: Tier.EXACT,
      fuzzy: false,
      distance: 0,
      key: exact.entry.headword,
      entries: [exact.entry, ...exact.mergedPeers],
    });
  }

  if (rows.length >= model.config.resultLimit) {
    return rows.slice(0, model.config.resultLimit);
  }

  // Tokenize the query with the SAME syllable segmenter the BK-tree was
  // built with — Burmese fuzzy is silently broken otherwise.
  const probe = segmentSyllables(headword);
  if (probe.length === 0) return rows;

  const matches = model.bktreeMy.query(probe, model.config.fuzzyThresholdMy);
  for (const m of matches) {
    if (rows.length >= model.config.resultLimit) break;
    const matchedHeadword = m.value.join("");
    // Skip the exact-headword row we already added.
    if (exact && matchedHeadword === exact.entry.headword) continue;
    const entries = model.db.entriesByHeadword(matchedHeadword);
    if (entries.length === 0) continue;
    rows.push({
      tier: Tier.FUZZY,
      fuzzy: true,
      distance: m.distance,
      key: matchedHeadword,
      entries,
    });
  }

  return rows;
}
