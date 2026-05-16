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

/** Compute the "Forms" peer list anchored to a *specific* entry: every
 *  same-headword homograph plus every other entry sharing one of that
 *  entry's top-K normalized glosses (bidirectional `maxGlossPosition`
 *  gate). The anchor entry itself is excluded.
 *
 *  Anchoring to an explicit entry — instead of "the first row for this
 *  headword" — is what keeps Forms correct on polysemous headwords. A
 *  headword like ကြိုက် carries two unrelated senses (verb "to like";
 *  conjunction "while"); each sense's Forms must be derived from *its
 *  own* glosses, otherwise the verb's panel lists every particle glossed
 *  "while" and the conjunction's panel lists every verb glossed "like".
 */
export function relatedFor(
  model: DictionaryModel,
  entry: Entry,
): Entry[] {
  const homographs = model.db
    .entriesByHeadword(entry.headword)
    .filter((e) => e.entryId !== entry.entryId);
  const peers: Entry[] = [...homographs];
  const seen = new Set<number>([entry.entryId, ...homographs.map((e) => e.entryId)]);

  const maxPos = model.config.maxGlossPosition;
  // Spec §2.4.3 — peers sharing an identical normalized gloss are
  // surfaced together. Only consider the anchor's *top-K* glosses so a
  // tangential gloss far down the list cannot generate spurious peers.
  const anchorTopGlosses = entry.normalizedGlosses.slice(0, maxPos);
  const candidateIds = new Set<number>();
  // norm → (position-in-anchor, [candidate entry IDs])
  const candidatesByGloss: Array<{ norm: string; anchorPos: number; ids: number[] }> = [];
  anchorTopGlosses.forEach((norm, anchorPos) => {
    if (!norm) return;
    const ids = model.db.entryIdsForNormalizedGloss(norm);
    if (ids.length === 0) return;
    candidatesByGloss.push({ norm, anchorPos, ids });
    for (const id of ids) if (!seen.has(id)) candidateIds.add(id);
  });

  if (candidateIds.size === 0) return peers;

  const fetched = model.db.entriesByIds([...candidateIds]);
  const byId = new Map<number, Entry>(fetched.map((e) => [e.entryId, e]));

  // Score each peer by (anchorPos + peerPos): lower = stronger
  // relationship. A peer that shares the anchor's first gloss as its
  // own first gloss scores 0 and tops the list.
  type Scored = { entry: Entry; score: number };
  const scored: Scored[] = [];
  const scoreById = new Map<number, number>();
  for (const { norm, anchorPos, ids } of candidatesByGloss) {
    for (const id of ids) {
      if (seen.has(id)) continue;
      const peer = byId.get(id);
      if (!peer) continue;
      const peerPos = peer.normalizedGlosses.indexOf(norm);
      if (peerPos < 0 || peerPos >= maxPos) continue;
      const thisScore = anchorPos + peerPos;
      const prev = scoreById.get(id);
      if (prev === undefined) {
        scoreById.set(id, thisScore);
        scored.push({ entry: peer, score: thisScore });
      } else if (thisScore < prev) {
        scoreById.set(id, thisScore);
        const item = scored.find((s) => s.entry.entryId === id);
        if (item) item.score = thisScore;
      }
    }
  }
  scored.sort((a, b) => a.score - b.score);
  const cap = model.config.maxFormsPerEntry;
  const capped = Number.isFinite(cap) ? scored.slice(0, cap) : scored;
  for (const { entry: peer } of capped) peers.push(peer);
  return peers;
}

/** Forward lookup by headword. Returns `null` on a miss. When the headword
 *  resolves to multiple raw entries (same headword, different POS, etc.)
 *  the first is the primary `entry` and the others — plus any peers
 *  sharing a normalized gloss with the primary — land in `mergedPeers`.
 *
 *  Peers are filtered by a bidirectional relevance gate
 *  (`config.maxGlossPosition`): a candidate entry only qualifies as a
 *  "form" when the shared normalized gloss is one of the primary's
 *  top-K glosses **and** one of the candidate's top-K glosses. Without
 *  this filter an entry like သစ်တော (forest/wood/jungle/rain forest)
 *  drags in every Burmese entry that happens to mention any of those
 *  words anywhere in their gloss list — even at position 20 — and the
 *  "Forms" section on the detail panel becomes unreadable.
 *
 *  Callers that already know which specific entry they want peers for
 *  (e.g. the detail view's "Forms" section, which has a user-selected
 *  entry in hand) should use {@link relatedFor} directly: this function
 *  anchors peers to whichever row SQLite returns first for `headword`,
 *  which can be a different sense than the caller intends on polysemous
 *  headwords.
 */
export function lookupForward(
  model: DictionaryModel,
  headword: string,
): ForwardResult | null {
  const direct = model.db.entriesByHeadword(headword);
  if (direct.length === 0) return null;
  const primary = direct[0];
  return { entry: primary, mergedPeers: relatedFor(model, primary) };
}

/** Forward lookup with a compound-fallback. Tries an exact match first;
 *  on a miss, walks contiguous syllable sub-sequences from longest to
 *  shortest and returns the first match. The Burmese segmenter
 *  occasionally emits a compound token the dictionary doesn't list as a
 *  unit (``ညီမလေး`` = ညီမ "younger sister" + လေး diminutive;
 *  ``တွေနဲ့`` = တွေ plural + နဲ့ "with"); the sub-sequence walk
 *  surfaces the longest known constituent so the segmenter preview shows
 *  *something* meaningful rather than an empty card.
 *
 *  The minimum sub-sequence length is ``ceil(totalSyllables / 2)``.
 *  Allowing length 1 unconditionally would produce noisy 1-syllable
 *  matches on long compounds (``အစစအရာရာ`` would resolve to ``အ`` —
 *  a particle prefix — which is worse than no match); the floor keeps
 *  the fallback meaningful while still handling 2-syllable compounds
 *  like ``တွေနဲ့``. Returns ``null`` only when no sub-sequence at all
 *  resolves. */
export function lookupForwardWithCompoundFallback(
  model: DictionaryModel,
  headword: string,
): ForwardResult | null {
  const exact = lookupForward(model, headword);
  if (exact) return exact;

  const syllables = segmentSyllables(headword);
  if (syllables.length <= 1) return null;

  const minLen = Math.max(1, Math.ceil(syllables.length / 2));
  // Longest match wins; among ties at the same length the leftmost
  // (most "head-like") wins. The segmenter's syllable boundaries match
  // the build-time segmenter, so candidate.join("") is the exact form
  // the entries table would have indexed.
  for (let len = syllables.length - 1; len >= minLen; len--) {
    for (let start = 0; start + len <= syllables.length; start++) {
      const candidate = syllables.slice(start, start + len).join("");
      if (candidate === headword) continue; // already-tried whole token
      const result = lookupForward(model, candidate);
      if (result) return result;
    }
  }
  return null;
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
