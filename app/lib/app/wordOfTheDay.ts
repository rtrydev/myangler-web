// "Word of the day" picker for the desktop detail rail's idle state.
//
// Pure + deterministic: given a `seed` (the day of the year) it returns
// the same entry all day, with no `Date` access inside (so it's trivially
// testable and SSR-stable — the caller supplies the day). The candidate
// pool is the dictionary's most *popular* headwords: words are ranked by
// their myWord corpus frequency (the same unigram counts the segmenter
// uses) and the top `POPULAR_POOL_SIZE` that actually own a dictionary
// entry form the pool. The day's seed then deterministically picks one of
// them, so the choice rotates daily but only ever lands on a common,
// well-attested word.
//
// Raw corpus frequency alone is a poor pool: the most frequent tokens in
// Burmese are grammatical particles, sentence/case markers, and
// punctuation (the full stop ။ is the single most frequent token), and
// because Wiktionary lists those as headwords they'd dominate the pool —
// the "word of the day" would usually be the object marker ကို or a full
// stop. `FUNCTION_WORDS` excludes that high-frequency function-word
// cluster so the pool is the most popular *content* words (verbs, nouns,
// adjectives) — actual vocabulary worth surfacing.

import { type DictionaryModel, type Entry } from "@/app/lib/lookup";

/** Size of the "most popular words" pool the day's word is drawn from. */
export const POPULAR_POOL_SIZE = 500;

/** High-frequency Burmese function words excluded from the popularity
 *  pool: punctuation, sentence-final and tense/aspect markers, case and
 *  postpositional markers, plural/number markers, classifiers, emphasis
 *  and politeness particles, interrogative particles, and pronouns. These
 *  sit at the very top of the corpus-frequency table (because they're the
 *  connective tissue of every sentence) but make poor vocabulary picks.
 *  Curated from the ~150 most frequent headwords in the shipped build;
 *  anything not present in a given build is simply never matched. */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  // Punctuation.
  "။", "၊", "၏", "၍", "၌",
  // Sentence-final / tense / aspect / nominalizing markers.
  "တယ်", "သည်", "မယ်", "မည်", "ပြီ", "ဘူး", "တာ", "တဲ့", "သော", "သည့်",
  "တတ်", "စွာ", "ခဲ့", "ထား", "ပြီး", "တော့", "မှု", "ခြင်း", "စရာ", "ချက်",
  "ကြောင်း", "ပါစေ", "စေ", "ချင်", "ရေး",
  // Case / postpositional markers.
  "ကို", "က", "မှာ", "မှ", "တွင်", "သို့", "အတွက်", "ထဲ", "အား", "ပေါ်",
  "ထက်", "ရဲ့", "နဲ့", "လို့", "လို", "အတွင်း", "ဖို့", "ရန်", "အောင်", "လောက်",
  // Plural / number / collective markers.
  "တွေ", "များ", "တို့", "တစ်",
  // Emphasis / politeness / softening particles.
  "ပါ", "မ", "ပဲ", "လည်း", "လေ", "နော်", "ပေါ့", "ပင်", "ကြီး", "သေး",
  "လေး", "ရယ်", "သာ", "ရာ", "ကာ", "လျက်", "လုံး", "ကြ", "ပေ", "ကျ", "ခံ",
  // Interrogatives / demonstratives.
  "လား", "လဲ", "ဘာ", "ဘယ်", "ဘယ်လို", "ဒီ", "ဒါ", "ထို", "တောင်", "တိုင်း",
  "ဟာ", "ဟုတ်", "ရင်", "ခု", "ယောက်", "ဦး", "မင်း",
  // Pronouns.
  "သူ", "သူ့", "ငါ", "ကျွန်တော်", "ကျွန်မ", "ကိုယ်", "ဒို့", "နင်", "၎င်း",
]);

/** The day of the year for a timestamp — 1 on Jan 1, up to 365/366 on
 *  Dec 31 — in the host's local time. Kept separate from
 *  `pickWordOfTheDay` so the pure picker takes a plain seed (and `Date`
 *  stays at the edge).
 *
 *  Both endpoints are reduced to local midnight before differencing so a
 *  daylight-saving transition earlier in the year (a 23- or 25-hour day)
 *  cannot push the count off by one. */
export function dayOfYear(now: Date): number {
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - startOfYear.getTime()) / 86_400_000) + 1;
}

/** The dictionary's most popular *content* headwords, most-popular first.
 *
 *  "Popularity" is myWord corpus frequency (`unigram` count). The list is
 *  the intersection of the frequency table with the set of real dictionary
 *  headwords — a high-frequency token that has no entry (an inflected
 *  form, say) can't be shown, so it's excluded — minus the `FUNCTION_WORDS`
 *  blocklist, then ranked by count descending and capped at `limit`. Ties
 *  break on the headword so the ordering is fully deterministic across
 *  runs. */
export function popularHeadwords(
  model: DictionaryModel,
  unigram: ReadonlyMap<string, number>,
  limit: number,
): string[] {
  const headwords = new Set(model.db.distinctHeadwords());
  const scored: Array<{ word: string; count: number }> = [];
  for (const [word, count] of unigram) {
    if (headwords.has(word) && !FUNCTION_WORDS.has(word)) {
      scored.push({ word, count });
    }
  }
  scored.sort((a, b) =>
    b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0),
  );
  return scored.slice(0, limit).map((s) => s.word);
}

/** Spread a small, monotonic seed (a day-of-year in [1, 366]) across the
 *  pool with a splitmix32-style avalanche, so consecutive days don't map
 *  to adjacent pool positions (which would surface near-identical words on
 *  consecutive days, the frequency order being smooth). */
function seededIndex(seed: number, size: number): number {
  let h = (seed | 0) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % size;
}

/** Deterministically pick the day's word. Builds the popularity pool, then
 *  uses `seed` to select one entry from it; returns `null` only when the
 *  pool is empty (no headword carries a frequency, e.g. an empty build). */
export function pickWordOfTheDay(
  model: DictionaryModel,
  unigram: ReadonlyMap<string, number>,
  seed: number,
): Entry | null {
  const pool = popularHeadwords(model, unigram, POPULAR_POOL_SIZE);
  if (pool.length === 0) return null;
  const headword = pool[seededIndex(seed, pool.length)];
  // Pool words are drawn from `distinctHeadwords`, so this resolves; `[0]`
  // mirrors `lookupForward`'s "first row is primary" rule for homographs.
  return model.db.entriesByHeadword(headword)[0] ?? null;
}
