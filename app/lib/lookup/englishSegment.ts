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
// Article policy. Articles ("a", "an", "the") are the only English
// closed-class words with no separable meaning in a sentence — every
// other function word (pronouns "I" / "you", prepositions "in" / "on",
// copulas "is" / "are", conjunctions "and" / "or", demonstratives,
// negations) carries real lexical content and has at least one Burmese
// entry that legitimately glosses it. Articles are different: the only
// `gloss_groups` rows with the keys "a" / "an" / "the" are noise hits
// to alphabet-letter entries (ပထမအင်္ဂလိပ်အက္ခရာ "first English
// alphabet letter" owns the gloss "A") or fragmentary unit-of-measure
// entries — the user typing "a fish" never meant the noun sense of the
// letter "a".
//
// Two things follow from that policy:
//
//   1. **Single-atom suppression.** When the only thing left to look up
//      is a bare article, return no match — letting the alphabet-letter
//      entry surface as the tile preview is pure noise. (Note: this is
//      ONLY for the bare-article fallback. Multi-word phrases that
//      happen to contain an article — "a lot", "thank you", "in love"
//      — still group through the full-key path because the longest-
//      match attempt always runs before the single-atom fallback.)
//
//   2. **Article-noun absorption.** "a fish" / "the cat" / "an apple"
//      collapse into a single tile spanning the article + the post-
//      article phrase. The user typed two atoms but meant one concept;
//      the article is just grammatical scaffolding. The segment carries
//      both the absorbed forward-lookup (so the tile renders with a
//      preview when the breakdown view is active, e.g. "I see a fish"
//      → three tiles where the third is the absorbed "a fish") AND a
//      `reverseLookupKey` holding just the post-article portion — when
//      the entire input collapses to a single absorbed segment the
//      orchestrator routes that key (NOT the literal "a fish") through
//      reverse-lookup, so the user sees the same ranked single-word
//      view they would have seen typing just "fish".
//
// Function words that DO carry meaning are never filtered or absorbed:
// "I see a fish" yields three tiles — "I" (pronoun match), "see" (verb
// match), "a fish" (absorbed, fish's match). The contrast with articles
// is the whole point: articles get the special treatment exactly
// because they alone have no standalone meaning.
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

/** English articles. The only closed-class words handled specially by
 *  the segmenter — see the file-level comment for the rationale. Kept
 *  tiny on purpose: every other "function word" candidate (pronouns,
 *  prepositions, conjunctions, copulas, demonstratives, negations) has
 *  at least one Burmese entry that legitimately glosses it, so blocking
 *  any of them would suppress real matches the user expects to see
 *  ("I", "is", "in", "no" all have meaningful entries).
 *
 *  The build pipeline's `ENGLISH_STOPWORDS` set is intentionally broader
 *  because it serves a different goal — keeping the `postings` inverted
 *  index from being flooded by closed-class words that appear in
 *  thousands of long glosses. That's a per-token relevance concern, not
 *  a "does this word have meaning?" question, so the two lists are
 *  allowed to differ. */
const ARTICLES: ReadonlySet<string> = new Set(["a", "an", "the"]);

/** One segment emitted by `segmentEnglish`. Same display shape the
 *  Burmese `BreakdownToken` uses — the orchestrator stores these
 *  directly into `BreakdownResult.tokens`. */
export interface EnglishSegment {
  /** Segment as displayed: original casing, atoms joined by single space. */
  token: string;
  /** Exact-gloss-match forward lookup, or `null` on miss. */
  result: ForwardResult | null;
  /** True when this segment spans an article-noun run absorbed into one
   *  tile (e.g. "a fish" → one tile carrying fish's match). Always
   *  undefined (rather than `false`) on segments produced by the normal
   *  multi-word or single-atom paths, so the flag's presence is a strict
   *  signal. Paired with `reverseLookupKey`. */
  mergedWithArticle?: boolean;
  /** For article-absorbed segments only: the post-article portion of
   *  the input in its original casing ("a fish" → "fish",
   *  "the happy new year" → "happy new year"). When an absorbed segment
   *  is the entire input the orchestrator routes this key through
   *  `lookupReverse` instead of the literal absorbed string so the user
   *  sees the same ranked single-word view they would have seen typing
   *  just the noun. Undefined on non-absorbed segments. */
  reverseLookupKey?: string;
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
 *  don't collapse spuriously.
 *
 *  Single-atom runs whose normalized form is a bare article
 *  short-circuit to null — see the file-level comment. The check fires
 *  before variant 1 because all three variants (plain, ``"to "``-strip,
 *  hyphen-join) on a 1-atom run reduce to the same spurious gloss-groups
 *  hit, and variants 2/3 don't apply to length-1 runs anyway. */
function lookupAtomRun(
  model: DictionaryModel,
  atoms: readonly Atom[],
): ForwardResult | null {
  if (atoms.length === 0) return null;
  const lowers = atoms.map((a) => a.normalized);

  if (atoms.length === 1 && ARTICLES.has(lowers[0])) {
    return null;
  }

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

/** Find the longest multi-atom phrase starting at `start` (length ≥ 2)
 *  that resolves through `lookupAtomRun`, capped at `MAX_PHRASE_LEN`.
 *  Returns the match plus the consumed length, or `null` when no
 *  multi-word run at this position resolves. */
function longestPhraseAt(
  model: DictionaryModel,
  atoms: readonly Atom[],
  start: number,
): { result: ForwardResult; length: number } | null {
  const maxLen = Math.min(MAX_PHRASE_LEN, atoms.length - start);
  for (let len = maxLen; len >= 2; len--) {
    const slice = atoms.slice(start, start + len);
    const hit = lookupAtomRun(model, slice);
    if (hit) return { result: hit, length: len };
  }
  return null;
}

/** Segment an English input into display tiles. Greedy longest-match
 *  against the dictionary's known gloss phrases; article-noun
 *  absorption when a bare article would otherwise produce a noise tile;
 *  single-atom fallback with exact-gloss lookup elsewhere.
 *
 *  Pure function of `(model, input)`. Cheap enough to run on every
 *  keystroke — at most O(atoms · MAX_PHRASE_LEN) indexed lookups.
 *  Article absorption doubles that bound in the worst case (one extra
 *  longest-phrase scan rooted at the post-article position), still
 *  linear in `atoms`. */
export function segmentEnglish(
  model: DictionaryModel,
  input: string,
): EnglishSegment[] {
  const atoms = atomize(input);
  if (atoms.length === 0) return [];

  const out: EnglishSegment[] = [];
  let i = 0;
  while (i < atoms.length) {
    // Path 1: longest known phrase starting at i. Tried first so that a
    // phrase whose first atom is an article ("a lot", "the same") still
    // groups through its canonical key instead of falling into article
    // absorption.
    const phrase = longestPhraseAt(model, atoms, i);
    if (phrase) {
      const slice = atoms.slice(i, i + phrase.length);
      out.push({
        token: slice.map((a) => a.text).join(" "),
        result: phrase.result,
      });
      i += phrase.length;
      continue;
    }

    const atomI = atoms[i];

    // Path 2: article-noun absorption. When the head atom is a bare
    // article and there is at least one more atom to absorb, emit ONE
    // tile spanning the article plus the longest post-article phrase
    // (or the single post-article atom). The tile carries the
    // post-article lookup as its result — the article itself is just
    // grammatical scaffolding, so what the user wants to see is the
    // noun's match.
    //
    // The fallback to a single post-article atom always runs; we never
    // leave a bare article as its own tile unless it's the trailing
    // atom of the input. That keeps "a fish" / "the cat" / "an apple"
    // looking like one concept in the breakdown UI even when the noun
    // is a dictionary miss ("a fis" → one tile "a fis" with null
    // result), instead of splitting into an article tile plus a noun
    // tile.
    if (ARTICLES.has(atomI.normalized) && i + 1 < atoms.length) {
      const tail = longestPhraseAt(model, atoms, i + 1);
      let consumed: number;
      let result: ForwardResult | null;
      if (tail) {
        consumed = 1 + tail.length;
        result = tail.result;
      } else {
        consumed = 2;
        result = lookupAtomRun(model, [atoms[i + 1]]);
      }
      const slice = atoms.slice(i, i + consumed);
      const tailSlice = atoms.slice(i + 1, i + consumed);
      out.push({
        token: slice.map((a) => a.text).join(" "),
        result,
        mergedWithArticle: true,
        reverseLookupKey: tailSlice.map((a) => a.text).join(" "),
      });
      i += consumed;
      continue;
    }

    // Path 3: default single-atom tile. `lookupAtomRun` self-suppresses
    // a trailing bare article here so a sentence ending with one (e.g.
    // "fish a") renders the article tile with a null result rather
    // than the alphabet-letter noise hit.
    out.push({
      token: atomI.text,
      result: lookupAtomRun(model, [atomI]),
    });
    i += 1;
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
