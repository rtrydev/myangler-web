// "Word of the day" picker for the desktop detail rail's idle state.
//
// Pure + deterministic: given a `seed` (a day number) it returns the same
// entry all day, with no `Date` access inside (so it's trivially
// testable and SSR-stable — the caller supplies the day). The candidate
// list is a hand-picked set of common, everyday headwords; each is
// verified against the live dictionary at call time and the first one
// that resolves for the given day wins, so a candidate missing from a
// particular data build is silently skipped rather than rendering a
// blank card.

import { lookupForward, type DictionaryModel, type Entry } from "@/app/lib/lookup";

/** Common, well-formed single-word headwords. Rotated by day; any that
 *  the active dictionary build doesn't contain are skipped at runtime. */
const CANDIDATES: readonly string[] = [
  "ရေ", // water
  "စား", // eat
  "သွား", // go
  "အိမ်", // house
  "ချစ်", // love
  "စာ", // letter / writing
  "နေ", // sun / stay
  "လာ", // come
  "ကြီး", // big
  "ကောင်း", // good
  "မြို့", // town
  "ကလေး", // child
  "စိတ်", // mind
  "နာမည်", // name
  "ကျောင်း", // school
  "လမ်း", // road
  "ပန်း", // flower
  "မိုး", // rain
  "ဆရာ", // teacher
  "မိတ်ဆွေ", // friend
];

/** The day number for a timestamp — whole days since the Unix epoch, in
 *  the host's local time. Kept separate from `pickWordOfTheDay` so the
 *  pure picker takes a plain seed (and `Date` stays at the edge). */
export function dayNumber(now: Date): number {
  const ms = now.getTime() - now.getTimezoneOffset() * 60_000;
  return Math.floor(ms / 86_400_000);
}

/** Deterministically pick the day's word. Walks the candidate list from
 *  the day's offset and returns the first headword that resolves in the
 *  dictionary; `null` only if none of them do. */
export function pickWordOfTheDay(
  model: DictionaryModel,
  seed: number,
): Entry | null {
  const n = CANDIDATES.length;
  // `% n` can be negative for negative seeds; normalize into [0, n).
  const start = ((seed % n) + n) % n;
  for (let i = 0; i < n; i++) {
    const headword = CANDIDATES[(start + i) % n];
    const result = lookupForward(model, headword);
    if (result) return result.entry;
  }
  return null;
}
