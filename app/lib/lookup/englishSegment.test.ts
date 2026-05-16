// Tests for the English-sentence segmenter and its exact-gloss
// per-segment lookup. The segmenter is the eng→mm parallel of the
// Burmese word segmenter — its job is to group multi-word glosses
// ("new year", "thank you") that already live in the dictionary's
// `gloss_groups` index, so the user sees them as one tappable tile
// instead of two unrelated words.

import { beforeAll, describe, expect, test } from "vitest";
import {
  buildFixtureModel,
  type FixtureEntry,
} from "./__fixtures__/buildFixture";
import {
  isEnglishSentence,
  lookupEnglishForward,
  segmentEnglish,
} from "./englishSegment";
import type { DictionaryModel } from "./loader";

const FIXTURE: FixtureEntry[] = [
  // Single-word glosses — single-atom segments hit these via the
  // exact-gloss-match path.
  { entryId: 0, headword: "ရေ", pos: "noun", glosses: ["water"] },
  { entryId: 1, headword: "နှစ်", pos: "noun", glosses: ["year"] },
  // Multi-word glosses — these are the cases the segmenter exists for:
  // the contiguous run must collapse into a single tile.
  { entryId: 2, headword: "နှစ်သစ်", pos: "noun", glosses: ["new year"] },
  { entryId: 3, headword: "ကျေးဇူး", pos: "noun", glosses: ["thank you"] },
  // Longest-match disambiguation: "happy new year" is its own entry,
  // so it must beat the shorter "new year" hit at the same position.
  { entryId: 4, headword: "မင်္ဂလာပါ", pos: "noun", glosses: ["happy new year"] },
  // Disambiguates the merger path: two entries share "new year" as a
  // normalized gloss → both ride the segment's `ForwardResult` together.
  { entryId: 5, headword: "နှစ်သစ်ကူး", pos: "noun", glosses: ["new year"] },
  // Lone "happy" entry — verifies that the longest-match fallthrough
  // can still pick up the single word when only the longer phrase is
  // absent at that position.
  { entryId: 6, headword: "ပျော်", pos: "adj", glosses: ["happy"] },
  // Verb entry — its gloss "to protect" is stored as "protect" in
  // `gloss_groups` thanks to the build-time ``normalize_gloss``
  // leading-``"to "`` strip. Used to exercise the segmenter's variant
  // matching: typing "to protect" must collapse to one tile.
  { entryId: 7, headword: "ပိုးအိမ်", pos: "verb", glosses: ["to protect"] },
  // POS-gate negative: "you" is a pronoun, so even though "to you"
  // → "you" matches in `gloss_groups`, the segmenter must NOT collapse
  // — applying the "to " strip is only valid for verbs.
  { entryId: 8, headword: "မင်း", pos: "pron", glosses: ["you"] },
  // Hyphenated gloss — `normalize_gloss` keeps the hyphens verbatim,
  // but our atomizer splits around them. The hyphen-join candidate
  // recovers this kind of match when the user types the phrase with
  // spaces.
  { entryId: 9, headword: "ယောက်ဖ", pos: "noun", glosses: ["brother-in-law"] },
  // POS variant: the production dictionary uses both "v" and "verb"
  // for verbs — make sure the gate accepts the short form too.
  { entryId: 10, headword: "သွား", pos: "v", glosses: ["to go"] },
  // Production-shape regression: in real data the same normalized gloss
  // ("protect", "defend", etc.) is owned by entries of mixed POS —
  // nouns, verbs, and POS-less. `entry_ids_for_normalized_gloss`
  // returns them sorted ascending by entry_id, so the noun (lowest ID)
  // is the primary, NOT the verb. A POS check that only inspects the
  // primary entry would reject the match. These IDs deliberately put
  // the noun first so the filter-and-promote-the-verb path is what
  // makes "to defend" group.
  { entryId: 30, headword: "ကာကွယ်ပစ္စည်း", pos: "n", glosses: ["defend"] },
  { entryId: 31, headword: "ကာကွယ်", pos: "verb", glosses: ["to defend"] },
  // Second production-shape regression: a hyphenated noun gloss
  // happens to spell the same atoms as a "to <verb>" infinitive. In
  // production, ``"to-do"`` is a noun (the fuss/commotion sense) and
  // ``"do"`` is a verb owned by many entries. If the segmenter tried
  // the hyphen-join variant before the "to "-strip, it would hijack
  // "to do" to the noun and miss the verb interpretation. The fixture
  // mirrors this exactly: a noun entry for ``"to-do"`` plus a verb
  // entry for ``"to do"``.
  { entryId: 40, headword: "အရှုပ်အရှင်း", pos: "n", glosses: ["to-do"] },
  { entryId: 41, headword: "လုပ်", pos: "verb", glosses: ["to do"] },
  // Article-noise entries. In real data the Burmese term
  // ပထမအင်္ဂလိပ်အက္ခရာ ("first English alphabet letter") owns the
  // single-word gloss "a", and similar fragmentary entries own bare
  // "an" / "the". The fixture reproduces that shape so the segmenter's
  // article-suppression + article-absorption paths can both be
  // exercised against the real bug: typing "a fish" used to surface
  // entry 50 as the "a" tile's preview.
  { entryId: 50, headword: "ပထမအင်္ဂလိပ်အက္ခရာ", pos: "n", glosses: ["a"] },
  { entryId: 51, headword: "ပထမအင်္ဂလိပ်အက္ခရာအကြီး", pos: "n", glosses: ["the"] },
  // Multi-word gloss starting with an article: must still group
  // through the longest-match path before article absorption runs, so
  // a real "a <X>" gloss isn't pre-empted by the absorption rule.
  { entryId: 52, headword: "အများကြီး", pos: "noun", glosses: ["a lot"] },
  // Pronoun + other content-bearing function-word entries. The
  // user-stated invariant is that words like "I" / "in" / "no" DO have
  // meaning and must surface even as single-atom tiles. These fixture
  // entries make the assertion testable — a regression that mistakenly
  // added them to the article-suppression set would turn these tile
  // results to null. ("you" reuses the existing entry 8, the POS-gate
  // test entry — same word, no need to duplicate.)
  { entryId: 60, headword: "ငါ", pos: "pron", glosses: ["I"] },
  { entryId: 62, headword: "အထဲမှာ", pos: "prep", glosses: ["in"] },
  // A noun the article-absorption tests can lean on as the absorbed
  // noun. Kept distinct from the year/water/etc. entries so the
  // article-noun test data is self-contained.
  { entryId: 70, headword: "ငါး", pos: "noun", glosses: ["fish"] },
];

let model: DictionaryModel;

beforeAll(async () => {
  model = await buildFixtureModel(FIXTURE);
});

describe("isEnglishSentence", () => {
  test("true for two or more ASCII word atoms", () => {
    expect(isEnglishSentence("new year")).toBe(true);
    expect(isEnglishSentence("happy new year")).toBe(true);
    expect(isEnglishSentence("Happy New Year!")).toBe(true);
  });

  test("false for a single word, with or without trailing punctuation", () => {
    expect(isEnglishSentence("water")).toBe(false);
    expect(isEnglishSentence("water!")).toBe(false);
    expect(isEnglishSentence("  water  ")).toBe(false);
  });

  test("false for the empty / punctuation-only input", () => {
    expect(isEnglishSentence("")).toBe(false);
    expect(isEnglishSentence("...")).toBe(false);
  });
});

describe("lookupEnglishForward", () => {
  test("returns the matching entry on an exact normalized gloss hit", () => {
    const result = lookupEnglishForward(model, "water");
    expect(result).not.toBeNull();
    expect(result?.entry.entryId).toBe(0);
  });

  test("returns multiple matchers as primary + mergedPeers", () => {
    const result = lookupEnglishForward(model, "new year");
    expect(result).not.toBeNull();
    const ids = [result!.entry.entryId, ...result!.mergedPeers.map((e) => e.entryId)];
    // Both entries that own the gloss "new year" must surface.
    expect(ids).toContain(2);
    expect(ids).toContain(5);
  });

  test("returns null on a miss", () => {
    expect(lookupEnglishForward(model, "absent")).toBeNull();
    expect(lookupEnglishForward(model, "")).toBeNull();
  });
});

describe("segmentEnglish", () => {
  test("groups a known multi-word gloss into a single segment", () => {
    const segments = segmentEnglish(model, "new year");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("new year");
    expect(segments[0].result?.entry.entryId).toBe(2);
  });

  test("preserves the user's original casing in the displayed token", () => {
    const segments = segmentEnglish(model, "New Year");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("New Year");
    // Lookup still resolved via the normalized form.
    expect(segments[0].result).not.toBeNull();
  });

  test("greedy longest-match: a longer known phrase wins over a shorter one", () => {
    const segments = segmentEnglish(model, "happy new year");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("happy new year");
    expect(segments[0].result?.entry.entryId).toBe(4);
  });

  test("falls through to single-word segments when the multi-word phrase is absent", () => {
    // Fixture has no entry for "happy water"; the segmenter should
    // emit two single-atom segments.
    const segments = segmentEnglish(model, "happy water");
    expect(segments.map((s) => s.token)).toEqual(["happy", "water"]);
    expect(segments[0].result?.entry.entryId).toBe(6);
    expect(segments[1].result?.entry.entryId).toBe(0);
  });

  test("marks single-atom segments with no exact gloss match as null", () => {
    const segments = segmentEnglish(model, "water absent");
    expect(segments.map((s) => s.token)).toEqual(["water", "absent"]);
    expect(segments[0].result).not.toBeNull();
    expect(segments[1].result).toBeNull();
  });

  test("mixes grouped phrases and single words inside one input", () => {
    // "happy new year water" → ["happy new year", "water"] (longest
    // match consumes the first three atoms; the trailing atom is a
    // single-word segment).
    const segments = segmentEnglish(model, "happy new year water");
    expect(segments).toHaveLength(2);
    expect(segments[0].token).toBe("happy new year");
    expect(segments[0].result?.entry.entryId).toBe(4);
    expect(segments[1].token).toBe("water");
    expect(segments[1].result?.entry.entryId).toBe(0);
  });

  test("ignores ASCII punctuation between atoms — punctuation does not break a phrase match", () => {
    // The atomizer strips punctuation so the three atoms join with a
    // single space and the longest-match still matches "happy new year".
    const segments = segmentEnglish(model, "happy, new year!");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("happy new year");
    expect(segments[0].result?.entry.entryId).toBe(4);
  });

  test("punctuation also strips out around segment-breaking words", () => {
    // "water!" → just one atom; punctuation drops.
    const segments = segmentEnglish(model, "  water!  ");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("water");
    expect(segments[0].result?.entry.entryId).toBe(0);
  });

  test("returns an empty array for inputs with no word atoms", () => {
    expect(segmentEnglish(model, "")).toEqual([]);
    expect(segmentEnglish(model, "...")).toEqual([]);
  });

  test("emitted segments are JSON-serializable (no Map/Set/function leaks)", () => {
    const segments = segmentEnglish(model, "happy new year water");
    const roundTripped = JSON.parse(JSON.stringify(segments));
    expect(roundTripped).toEqual(segments);
  });
});

describe("segmentEnglish · build-time-normalization variants", () => {
  test('groups "to <verb>" — the build pipeline strips leading "to "', () => {
    const segments = segmentEnglish(model, "to protect");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("to protect");
    expect(segments[0].result?.entry.entryId).toBe(7);
  });

  test('groups "to <verb>" inside a longer sentence', () => {
    const segments = segmentEnglish(model, "I want to protect you");
    // "to protect" collapses into one tile; trailing "you" matches the
    // pronoun entry as its own tile. ("you" is the pronoun-POS one,
    // not the "to <verb>" run.)
    const tokens = segments.map((s) => s.token);
    expect(tokens).toContain("to protect");
    expect(tokens[tokens.length - 1]).toBe("you");
    const toProtect = segments.find((s) => s.token === "to protect");
    expect(toProtect?.result?.entry.entryId).toBe(7);
  });

  test('accepts both "v" and "verb" POS values for the "to "-strip gate', () => {
    const segments = segmentEnglish(model, "to go");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("to go");
    expect(segments[0].result?.entry.entryId).toBe(10);
  });

  test('"to <verb>" wins over a coincidental hyphenated-noun gloss', () => {
    // Production case "to do": ``"to-do"`` is a noun (a fuss) and
    // ``"do"`` is a verb owned by many entries. The segmenter must
    // surface the verb interpretation rather than letting the
    // hyphen-join variant hijack the match to the noun.
    const segments = segmentEnglish(model, "to do");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("to do");
    expect(segments[0].result?.entry.entryId).toBe(41);
    expect(segments[0].result?.entry.pos).toBe("verb");
  });

  test('groups "to <verb>" when the lowest-ID entry sharing the gloss is a non-verb', () => {
    // gloss_groups for "defend" returns [30 (noun), 31 (verb)] in that
    // order. A primary-only POS check would see "n" and reject the
    // match. The segmenter must filter down to the verb entries and
    // promote the verb as the tile's primary.
    const segments = segmentEnglish(model, "to defend");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("to defend");
    expect(segments[0].result?.entry.entryId).toBe(31);
    expect(segments[0].result?.entry.pos).toBe("verb");
    // The noun peer does not ride along — it does not belong to the
    // "to <verb>" semantic, so the tile's mergedPeers must not include
    // it.
    expect(
      segments[0].result?.mergedPeers.map((e) => e.entryId),
    ).not.toContain(30);
  });

  test('does NOT group "to <pronoun>" — POS gate prevents over-grouping', () => {
    // "you" is a pronoun in the fixture, so the stripped form would
    // match but the POS gate rejects it. The segmenter falls back to
    // two single-atom tiles.
    const segments = segmentEnglish(model, "to you");
    expect(segments.map((s) => s.token)).toEqual(["to", "you"]);
  });

  test('groups hyphenated glosses typed with spaces ("brother in law" → one tile)', () => {
    const segments = segmentEnglish(model, "brother in law");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("brother in law");
    expect(segments[0].result?.entry.entryId).toBe(9);
  });

  test('groups hyphenated glosses typed with hyphens ("brother-in-law")', () => {
    // The atomizer splits on the hyphens, so the lookup variants are
    // the same as the spaced form — and the hyphen-join variant still
    // wins.
    const segments = segmentEnglish(model, "brother-in-law");
    expect(segments).toHaveLength(1);
    expect(segments[0].result?.entry.entryId).toBe(9);
  });

  test('preserves the user-typed casing across all variant matches', () => {
    expect(segmentEnglish(model, "To Protect")[0].token).toBe("To Protect");
    expect(segmentEnglish(model, "Brother In Law")[0].token).toBe(
      "Brother In Law",
    );
  });
});

describe("segmentEnglish · article-noun absorption", () => {
  test('"a fish" collapses to one segment carrying fish\'s match and reverseLookupKey', () => {
    // The reported bug: "a" used to surface as its own tile with the
    // alphabet-letter entry attached. The article-noun absorption rule
    // makes it one segment spanning both atoms, with fish's forward
    // lookup as the result AND the post-article portion exposed via
    // `reverseLookupKey` so the orchestrator can route a 1-segment
    // absorbed input through `lookupReverse("fish")` rather than the
    // literal "a fish".
    const segments = segmentEnglish(model, "a fish");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("a fish");
    expect(segments[0].result?.entry.entryId).toBe(70);
    expect(segments[0].mergedWithArticle).toBe(true);
    expect(segments[0].reverseLookupKey).toBe("fish");
  });

  test('"the cat" / "an apple" / arbitrary article+noun follows the same rule', () => {
    // Even when the noun is not in the fixture, absorption still
    // happens — the tile is one item with a null result, not two
    // separate (article + noun) tiles.
    const theCat = segmentEnglish(model, "the cat");
    expect(theCat).toHaveLength(1);
    expect(theCat[0].token).toBe("the cat");
    expect(theCat[0].mergedWithArticle).toBe(true);

    const anApple = segmentEnglish(model, "an apple");
    expect(anApple).toHaveLength(1);
    expect(anApple[0].token).toBe("an apple");
    expect(anApple[0].mergedWithArticle).toBe(true);
  });

  test("an article inside a sentence absorbs only the immediately following noun phrase", () => {
    // "I see a fish" → ["I", "see", "a fish"]. The "I" tile carries
    // the pronoun match (entry 60); "see" is not in the fixture so its
    // tile has a null result; "a fish" is absorbed.
    const segments = segmentEnglish(model, "I see a fish");
    expect(segments.map((s) => s.token)).toEqual(["I", "see", "a fish"]);
    expect(segments[0].result?.entry.entryId).toBe(60);
    expect(segments[0].mergedWithArticle).toBeUndefined();
    expect(segments[1].result).toBeNull();
    expect(segments[2].result?.entry.entryId).toBe(70);
    expect(segments[2].mergedWithArticle).toBe(true);
  });

  test("absorption pulls in the longest post-article phrase, not just the next atom", () => {
    // "a happy new year" → one tile spanning all four atoms, carrying
    // the "happy new year" entry's match. Without the multi-atom probe
    // after the article, we would only absorb "a happy" and leave
    // "new year" dangling as a separate tile.
    const segments = segmentEnglish(model, "a happy new year");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("a happy new year");
    expect(segments[0].result?.entry.entryId).toBe(4);
    expect(segments[0].mergedWithArticle).toBe(true);
    // reverseLookupKey holds the entire post-article phrase so the
    // orchestrator's ranked-view route lands on the right query.
    expect(segments[0].reverseLookupKey).toBe("happy new year");
  });

  test('a real "a <X>" gloss is matched as a phrase, NOT routed through absorption', () => {
    // "a lot" is a known phrase in the fixture (entry 52). The
    // longest-match path runs before the absorption path, so the
    // resulting segment must NOT be flagged `mergedWithArticle` — the
    // tile is a normal phrase match. Without that ordering, the
    // article-strip path would re-route the orchestrator to a reverse-
    // lookup of "lot" alone, dropping the real "a lot" entry.
    const segments = segmentEnglish(model, "a lot");
    expect(segments).toHaveLength(1);
    expect(segments[0].token).toBe("a lot");
    expect(segments[0].result?.entry.entryId).toBe(52);
    expect(segments[0].mergedWithArticle).toBeUndefined();
    expect(segments[0].reverseLookupKey).toBeUndefined();
  });

  test("a trailing bare article in a sentence is suppressed, not absorbed", () => {
    // No following atom to absorb, so the article path doesn't apply
    // and the default single-atom path emits the article as its own
    // tile. `lookupAtomRun` suppresses the alphabet-letter entry, so
    // the tile carries a null result rather than the noise hit.
    const segments = segmentEnglish(model, "fish a");
    expect(segments.map((s) => s.token)).toEqual(["fish", "a"]);
    expect(segments[0].result?.entry.entryId).toBe(70);
    expect(segments[1].result).toBeNull();
    expect(segments[1].mergedWithArticle).toBeUndefined();
  });
});

describe("segmentEnglish · content-word function words keep their meaning", () => {
  // Pronouns, prepositions, etc. were briefly over-suppressed in an
  // earlier version of the fix. The user's invariant is that any word
  // with separable meaning must surface as its own tile — these tests
  // pin that down across the categories most likely to drift.

  test('"I" surfaces with the pronoun entry as a single-atom tile', () => {
    const segments = segmentEnglish(model, "I see fish");
    const iTile = segments.find((s) => s.token === "I");
    expect(iTile).toBeDefined();
    expect(iTile?.result?.entry.entryId).toBe(60);
  });

  test('"you" is not filtered when typed in a sentence', () => {
    const segments = segmentEnglish(model, "you fish");
    const youTile = segments.find((s) => s.token === "you");
    expect(youTile?.result?.entry.entryId).toBe(8);
  });

  test('"in" (preposition) is not filtered when typed in a sentence', () => {
    const segments = segmentEnglish(model, "in water");
    const inTile = segments.find((s) => s.token === "in");
    expect(inTile?.result?.entry.entryId).toBe(62);
  });
});

describe("segmentEnglish · lookupEnglishForward is unchanged", () => {
  // The forward-lookup primitive is shared with `lookupReverse`'s
  // gloss_groups fallback path. The segmenter's article rules must NOT
  // leak into it — explicit "what entries own the gloss 'a'?" calls
  // still see entry 50 even though the segmenter would hide it.
  test("direct lookup still resolves bare article keys", () => {
    expect(lookupEnglishForward(model, "a")?.entry.entryId).toBe(50);
    expect(lookupEnglishForward(model, "the")?.entry.entryId).toBe(51);
  });
});
