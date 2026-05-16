// English sentence segmenter — multi-word phrase grouping against the
// build-time `gloss_groups` index, single-word fallback to exact gloss
// match.
//
// Mirrors the Burmese eager-forward-lookup discipline used by the
// breakdown path: only contiguous segments that resolve to an exact
// match in the dictionary become groups. There is no fuzzy or contains
// rescue here — those would produce noisy per-tile previews on common
// short words inside a longer sentence ("a", "the", "is"). Users can
// still tap a tile to drill into the full ranked entry list via the
// detail panel.
//
// Algorithm:
//
//   1. Tokenize the input into ASCII word *atoms* (the same regex the
//      build pipeline uses, so the atoms we segment over match the
//      atoms the inverted index keys on).
//   2. For each position, try contiguous atom runs from longest to
//      shortest (capped at MAX_PHRASE_LEN). The first run that resolves
//      to a `gloss_groups` key — via the candidate-key generator below —
//      wins.
//   3. If no multi-word run matches, emit the single atom looked up
//      against `gloss_groups` for an exact single-word gloss match.
//
// Candidate-key generator. The build pipeline runs `normalize_gloss`
// over every gloss before insertion into `gloss_groups`: lowercase,
// collapse whitespace, strip a leading ``"to "``. Hyphens inside a
// gloss are preserved verbatim. To recover the same set of matches
// from user input, this module synthesizes multiple candidate keys
// from a single atom run:
//
//   1. The plain space-joined form (the canonical lookup).
//   2. Leading ``"to "`` stripped — recovers verb glosses whose
//      normalized form drops the infinitive marker (``"to protect"``
//      stored as ``"protect"``). Only accepted when the resolved
//      entry's POS is a verb; this gate prevents over-grouping for
//      non-infinitive ``"to <pronoun>"`` / ``"to <article>"`` runs
//      that would otherwise collapse spuriously when the second word
//      happens to be a known gloss.
//   3. Hyphen-joined — recovers hyphenated glosses like ``"brother-
//      in-law"`` whose normalized key keeps the hyphens but whose
//      atoms our regex splits around.
//
// Variant order = specificity of the rule. Variant 2 fires under a
// strict condition (run starts with ``"to"`` AND the stripped form
// resolves to a verb), so when its condition matches it represents a
// precise interpretation of the user's input. Variant 3 is a softer
// guess (hyphenation can apply anywhere) and only earns the slot when
// no more-specific interpretation fired. Without this ordering, a
// well-formed infinitive like ``"to do"`` would be hijacked by an
// unrelated hyphenated noun entry like ``"to-do"`` (the fuss/
// commotion sense).
//
// The emitted segments carry the same `ForwardResult | null` shape the
// Burmese breakdown uses, so the UI can render either side with the
// same component.

import type { DictionaryModel } from "./loader";
import type { ForwardResult } from "./types";

/** Hard cap on multi-word phrase length. Five words is well past every
 *  natural gloss in the production dictionary; the cap keeps the
 *  per-position lookup bounded for very long inputs. */
const MAX_PHRASE_LEN = 5;

/** One segment emitted by `segmentEnglish`. Same display shape the
 *  Burmese `BreakdownToken` uses — the orchestrator stores these
 *  directly into `BreakdownResult.tokens`. */
export interface EnglishSegment {
  /** Segment as displayed: original casing, atoms joined by single space. */
  token: string;
  /** Exact-gloss-match forward lookup, or `null` on miss. */
  result: ForwardResult | null;
}

interface Atom {
  text: string;
  normalized: string;
}

/** Word-atom regex — the same shape as the build pipeline's
 *  `tokenize_gloss_words` (and mirrored in `normalize.ts`). Case-
 *  insensitive so the original casing survives for display. */
const ATOM_RE = /[A-Za-z0-9](?:[A-Za-z0-9']*[A-Za-z0-9])?/g;

function atomize(input: string): Atom[] {
  const matches = input.match(ATOM_RE);
  if (!matches) return [];
  return matches.map((text) => ({ text, normalized: text.toLowerCase() }));
}

/** Exact forward-lookup for a normalized English gloss. Returns every
 *  entry whose normalized gloss list contains `normalized` as one of
 *  its keys (first entry → `entry`, the rest → `mergedPeers`). `null`
 *  when nothing matches. */
export function lookupEnglishForward(
  model: DictionaryModel,
  normalized: string,
): ForwardResult | null {
  if (!normalized) return null;
  const ids = model.db.entryIdsForNormalizedGloss(normalized);
  if (ids.length === 0) return null;
  const entries = model.db.entriesByIds(ids);
  if (entries.length === 0) return null;
  return { entry: entries[0], mergedPeers: entries.slice(1) };
}

/** The dictionary uses both ``"v"`` and ``"verb"`` (and the unrelated
 *  ``"phrase"`` / ``"proverb"``) as POS values. Match the prefix
 *  conservatively so we accept the genuine verb forms without sweeping
 *  in anything that just starts with ``"v"``. */
function isVerbPos(pos: string): boolean {
  const p = pos.toLowerCase();
  return p === "v" || p === "verb";
}

/** Look up a candidate atom run, trying every normalized-key shape the
 *  build pipeline could have stored. The first non-null variant wins;
 *  the ``"to "`` strip variant is gated by POS so non-infinitive runs
 *  don't collapse spuriously. */
function lookupAtomRun(
  model: DictionaryModel,
  atoms: readonly Atom[],
): ForwardResult | null {
  if (atoms.length === 0) return null;
  const lowers = atoms.map((a) => a.normalized);

  // 1. Plain space-joined — canonical key for most glosses.
  const spaceKey = lowers.join(" ");
  const direct = lookupEnglishForward(model, spaceKey);
  if (direct) return direct;

  // Variants 2 and 3 only apply when there are at least two atoms.
  if (atoms.length < 2) return null;

  // 2. Leading ``"to "`` strip — recovers verb glosses whose normalized
  //    form drops the infinitive marker. POS-gated to verb only.
  //
  //    Tried before variant 3 because its condition (phrase starts with
  //    ``"to"`` AND the stripped form resolves to a verb) is highly
  //    specific. If it fires, the user almost certainly meant the
  //    infinitive — never an unrelated hyphenated noun that happens to
  //    spell out the same atoms.
  //
  //    The verb gate filters *every* resolved entry, not just the
  //    primary — `entry_ids_for_normalized_gloss` returns matches
  //    sorted by entry_id, and for a common gloss like ``"protect"``
  //    or ``"do"`` (owned by nouns, verbs, and POS-less entries) the
  //    primary is rarely the verb. Filtering keeps only the entries
  //    the ``"to "`` strip actually applies to, with the first
  //    surviving verb becoming the tile's primary.
  if (lowers[0] === "to") {
    const stripped = lowers.slice(1).join(" ");
    if (stripped) {
      const ids = model.db.entryIdsForNormalizedGloss(stripped);
      if (ids.length > 0) {
        const verbs = model.db
          .entriesByIds(ids)
          .filter((e) => isVerbPos(e.pos));
        if (verbs.length > 0) {
          return { entry: verbs[0], mergedPeers: verbs.slice(1) };
        }
      }
    }
  }

  // 3. Hyphen-joined — recovers glosses like ``"brother-in-law"`` whose
  //    normalized key keeps the hyphens. Softer signal than variant 2:
  //    it can plausibly fire on any multi-atom run, so it's tried last
  //    as a last-resort recovery for genuinely hyphenated phrases.
  const hyphenKey = lowers.join("-");
  if (hyphenKey !== spaceKey) {
    const hit = lookupEnglishForward(model, hyphenKey);
    if (hit) return hit;
  }

  return null;
}

/** Segment an English input into display tiles. Greedy longest-match
 *  against the dictionary's known gloss phrases; single-atom fallback
 *  with exact-gloss lookup when no multi-word run hits.
 *
 *  Pure function of `(model, input)`. Cheap enough to run on every
 *  keystroke — at most O(atoms · MAX_PHRASE_LEN) indexed lookups. */
export function segmentEnglish(
  model: DictionaryModel,
  input: string,
): EnglishSegment[] {
  const atoms = atomize(input);
  if (atoms.length === 0) return [];

  const out: EnglishSegment[] = [];
  let i = 0;
  while (i < atoms.length) {
    const maxLen = Math.min(MAX_PHRASE_LEN, atoms.length - i);
    let matchedLen = 0;
    let matchedResult: ForwardResult | null = null;
    // Try longest phrases first; first multi-word hit wins.
    for (let len = maxLen; len >= 2; len--) {
      const slice = atoms.slice(i, i + len);
      const hit = lookupAtomRun(model, slice);
      if (hit) {
        matchedLen = len;
        matchedResult = hit;
        break;
      }
    }
    if (matchedResult !== null && matchedLen >= 2) {
      const slice = atoms.slice(i, i + matchedLen);
      out.push({
        token: slice.map((a) => a.text).join(" "),
        result: matchedResult,
      });
      i += matchedLen;
    } else {
      const atom = atoms[i];
      out.push({
        token: atom.text,
        result: lookupAtomRun(model, [atom]),
      });
      i += 1;
    }
  }
  return out;
}

/** Whether the input contains more than one whitespace-separated ASCII
 *  word atom. Used by the search orchestrator to route a single-word
 *  English query to the ranked reverse-lookup path and a multi-word
 *  query to the sentence-breakdown path. */
export function isEnglishSentence(input: string): boolean {
  const matches = input.match(ATOM_RE);
  return matches !== null && matches.length > 1;
}
