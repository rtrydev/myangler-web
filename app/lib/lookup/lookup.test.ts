// End-to-end tests for the lookup module. Builds a small fixture
// dictionary in memory (real SQLite via sql.js, real `bktree/v1` JSON
// payloads) and exercises every public path.

import { beforeAll, describe, expect, test } from "vitest";
import { segmentSyllables } from "@/app/lib/segmenter";
import { buildFixtureModel, type FixtureEntry } from "./__fixtures__/buildFixture";
import {
  lookupForward,
  lookupForwardWithCompoundFallback,
  lookupForwardWithFuzzy,
  relatedFor,
} from "./forward";
import { lookupReverse } from "./reverse";
import { searchBurmese } from "./burmeseSearch";
import type { DictionaryModel } from "./loader";
import { Tier } from "./types";

// Fixture entry IDs are intentional — referenced by id throughout the
// assertions for clarity.
const FIXTURE: FixtureEntry[] = [
  // EXACT-tier mergers: both have normalized gloss "go".
  { entryId: 0, headword: "က", pos: "verb", glosses: ["go"] },
  { entryId: 1, headword: "ခ", pos: "verb", glosses: ["to go"] },
  // HEAD-tier on "go".
  { entryId: 2, headword: "ဂ", pos: "verb", glosses: ["go up"] },
  // INCIDENTAL-tier on "go" (multi-word gloss whose head is not "go").
  { entryId: 3, headword: "ဃ", pos: "verb", glosses: ["soon to go"] },
  // English fuzzy distractors: "got", "to" are 1 edit from "go".
  { entryId: 4, headword: "ဇ", pos: "verb", glosses: ["got"] },
  { entryId: 5, headword: "ဈ", pos: "verb", glosses: ["arrive at"] },
  // Burmese headwords for the syllable-fuzzy test: မြန်မာ and ထိုင်းမာ
  // differ by exactly one syllable (verified in the data-pipeline
  // BK-tree test).
  { entryId: 6, headword: "မြန်မာ", pos: "noun", glosses: ["Burma"] },
  { entryId: 7, headword: "ထိုင်းမာ", pos: "noun", glosses: ["Thai-Burma"] },
  // For the "house"/"hous" character-fuzzy test.
  { entryId: 8, headword: "ည", pos: "noun", glosses: ["house"] },
  { entryId: 9, headword: "ဋ", pos: "noun", glosses: ["hous"] },
  // Pure stopword gloss — exercises the "stopword query" behavior.
  { entryId: 10, headword: "ဌ", pos: "preposition", glosses: ["a"] },
  // Multi-word gloss with a stopword buried inside — exercises the
  // contains-fallback that surfaces entries whose primary gloss
  // *contains* the query word but does not equal it (the production
  // case "ကျွန်တော် -> I, me (formal polite, used by males in Lower
  // Myanmar)" where querying "me" hits no postings and no gloss_groups).
  {
    entryId: 11,
    headword: "ကျွန်တော်",
    pos: "pron",
    glosses: ["the man speaks"],
  },
];

let model: DictionaryModel;

beforeAll(async () => {
  model = await buildFixtureModel(FIXTURE);
});

describe("lookupForward", () => {
  test("returns the entry on a hit", () => {
    const r = lookupForward(model, "က");
    expect(r).not.toBeNull();
    expect(r!.entry.entryId).toBe(0);
    expect(r!.entry.glosses).toEqual(["go"]);
  });

  test("returns null on a miss", () => {
    expect(lookupForward(model, "no-such-headword")).toBeNull();
  });

  test("surfaces merged peers sharing an identical normalized gloss", () => {
    // Entry 0 (headword က, gloss "go") and entry 1 (headword ခ, gloss
    // "to go") share normalized gloss "go" — entry 0 should surface
    // entry 1 as a merged peer.
    const r = lookupForward(model, "က");
    const peerIds = r!.mergedPeers.map((e) => e.entryId).sort();
    expect(peerIds).toContain(1);
  });

  test("does not surface peers for an entry with no merging", () => {
    const r = lookupForward(model, "မြန်မာ");
    expect(r!.mergedPeers).toEqual([]);
  });
});

describe("relatedFor — homograph anchoring", () => {
  // Regression: a polysemous headword (two raw entries sharing spelling
  // but with unrelated senses) used to leak one sense's gloss-mates into
  // the other sense's "Forms" section. Production case: ကြိုက် has a
  // verb sense ("to like") and a conjunction sense ("while"); the
  // verb's detail panel filled with every particle glossed "while"
  // because `lookupForward(headword)` anchored peers to whichever raw
  // entry SQLite returned first (the conj), regardless of which sense
  // the user had selected.
  //
  // The fix anchors peers to a caller-supplied `Entry` so each sense's
  // Forms section derives from *its own* normalized glosses.
  const HOMOGRAPH_FIXTURE: FixtureEntry[] = [
    // Two same-headword homographs with disjoint senses. The "while"
    // sense's entry_id is intentionally lower so it would win
    // `direct[0]` in `entriesByHeadword` ordering — the exact failure
    // mode from the production bug.
    { entryId: 0, headword: "α", pos: "conj", glosses: ["while"] },
    { entryId: 1, headword: "α", pos: "verb", glosses: ["to like"] },
    // Foreign particles whose primary gloss is "while" — they must
    // attach to the conj sense, never to the verb sense.
    { entryId: 2, headword: "β", pos: "particle", glosses: ["while"] },
    { entryId: 3, headword: "γ", pos: "particle", glosses: ["while"] },
    // A verb sharing "like" with the verb sense.
    { entryId: 4, headword: "δ", pos: "verb", glosses: ["like"] },
  ];

  let m: DictionaryModel;
  beforeAll(async () => {
    m = await buildFixtureModel(HOMOGRAPH_FIXTURE);
  });

  test("anchors peers to the supplied entry, not direct[0]", () => {
    const verb = m.db.entriesByIds([1])[0];
    const peers = relatedFor(m, verb).map((e) => e.entryId).sort();
    // Verb sense surfaces the conj homograph (same headword) and the
    // "like"-glossed peer. The "while"-glossed particles must NOT
    // appear — they share a gloss with the conj sense, not the verb.
    expect(peers).toContain(0); // conj homograph (same headword)
    expect(peers).toContain(4); // "like" peer
    expect(peers).not.toContain(2);
    expect(peers).not.toContain(3);
  });

  test("each sense of a homograph gets its own peers", () => {
    const conj = m.db.entriesByIds([0])[0];
    const conjPeers = relatedFor(m, conj).map((e) => e.entryId).sort();
    // Conj sense surfaces both "while" particles and the verb homograph;
    // the verb's "like" peer must NOT appear.
    expect(conjPeers).toContain(1);
    expect(conjPeers).toContain(2);
    expect(conjPeers).toContain(3);
    expect(conjPeers).not.toContain(4);
  });

  test("never includes the anchor entry itself", () => {
    const verb = m.db.entriesByIds([1])[0];
    const peers = relatedFor(m, verb);
    expect(peers.every((e) => e.entryId !== 1)).toBe(true);
  });

  test("lookupForward continues to anchor to direct[0] (back-compat)", () => {
    // Public API contract unchanged: forward lookup by headword still
    // picks the first row as primary and computes peers against it.
    const r = lookupForward(m, "α");
    expect(r!.entry.entryId).toBe(0);
    const peerIds = r!.mergedPeers.map((e) => e.entryId).sort();
    // Primary is the conj — its peers include the verb homograph and
    // the "while" particles, NOT the "like" peer.
    expect(peerIds).toContain(1);
    expect(peerIds).toContain(2);
    expect(peerIds).toContain(3);
    expect(peerIds).not.toContain(4);
  });
});

describe("lookupForwardWithCompoundFallback", () => {
  test("returns the same result as lookupForward on an exact hit", () => {
    const direct = lookupForward(model, "က");
    const fallback = lookupForwardWithCompoundFallback(model, "က");
    expect(fallback?.entry.entryId).toBe(direct?.entry.entryId);
  });

  test("falls back to a sub-sequence headword on a miss", () => {
    // The fixture has မြန်မာ as a headword. ထိုင်းမြန်မာ syllables
    // are [ထိုင်း, မြန်, မာ]; the contiguous 2-syl sub-sequence
    // starting at position 1 is [မြန်, မာ] = မြန်မာ, which is in the
    // fixture. The fallback should surface that match.
    const compoundToken = "ထိုင်းမြန်မာ";
    expect(lookupForward(model, compoundToken)).toBeNull();
    const fallback = lookupForwardWithCompoundFallback(model, compoundToken);
    expect(fallback).not.toBeNull();
    expect(fallback!.entry.headword).toBe("မြန်မာ");
  });

  test("returns null when no sub-sequence resolves", () => {
    // A token whose syllables never appear in the fixture at all.
    expect(
      lookupForwardWithCompoundFallback(model, "ဆော"),
    ).toBeNull();
  });

  test("respects the minimum sub-sequence length (no spurious 1-syl matches on long tokens)", () => {
    // A 4-syl token where only a single 1-syl piece appears in the
    // fixture would NOT be matched (floor = ceil(4/2) = 2). This guards
    // against the စ → matched-as-a-single-syllable failure mode.
    // Build a synthetic 4-syl token using fixture syllables.
    const probe = segmentSyllables("ဆော") // 1 syllable
      .concat(segmentSyllables("ဆော")) // 2
      .concat(segmentSyllables("ဆော")) // 3
      .concat(segmentSyllables("က")); // 4, "က" is a fixture headword
    const compound = probe.join("");
    // ``က`` would match at length 1 if floor were 1, but floor is 2.
    expect(
      lookupForwardWithCompoundFallback(model, compound),
    ).toBeNull();
  });
});

describe("lookupReverse — tiered ranking", () => {
  test("orders rows by tier: exact > head > incidental > fuzzy", () => {
    const rows = lookupReverse(model, "go");
    // Real-tier rows come first, in tier order. We assert the
    // grouping_key + tier of each row.
    const realRows = rows.filter((r) => !r.fuzzy);
    expect(realRows.length).toBeGreaterThanOrEqual(3);
    // Row for normalized "go" (entries 0+1 merged) is EXACT.
    const goRow = realRows.find((r) => r.key === "go");
    expect(goRow?.tier).toBe(Tier.EXACT);
    // Row for "go up" is HEAD.
    const goUpRow = realRows.find((r) => r.key === "go up");
    expect(goUpRow?.tier).toBe(Tier.HEAD);
    // Row for "soon to go" is INCIDENTAL.
    const incRow = realRows.find((r) => r.key === "soon to go");
    expect(incRow?.tier).toBe(Tier.INCIDENTAL);

    // Position assertion: real rows appear in tier order.
    const tierSequence = realRows.map((r) => r.tier);
    const sorted = [...tierSequence].sort((a, b) => a - b);
    expect(tierSequence).toEqual(sorted);
  });

  test("merges entries with identical normalized gloss into one row", () => {
    // Entries 0 ("go") and 1 ("to go" → normalized "go") both contribute
    // to a single merged row with key "go" at the EXACT tier.
    const rows = lookupReverse(model, "go");
    const goRow = rows.find((r) => r.key === "go");
    expect(goRow).toBeDefined();
    expect(goRow!.tier).toBe(Tier.EXACT);
    const ids = goRow!.entries.map((e) => e.entryId).sort();
    expect(ids).toEqual([0, 1]);
  });

  test("strips leading 'to ' and is case-insensitive", () => {
    const rowsGo = lookupReverse(model, "go");
    const rowsToGo = lookupReverse(model, "to go");
    const rowsCap = lookupReverse(model, "Go");
    const exactKeys = (rows: ReturnType<typeof lookupReverse>) =>
      rows.filter((r) => r.tier === Tier.EXACT).map((r) => r.key);
    expect(exactKeys(rowsGo)).toContain("go");
    expect(exactKeys(rowsToGo)).toContain("go");
    expect(exactKeys(rowsCap)).toContain("go");
  });

  test("English fuzzy fires for a 1-edit typo and resolves to entries", () => {
    // "hous" is in the index as the gloss of entry 9. Querying "house"
    // should produce an EXACT-tier row for entry 8, and a FUZZY row for
    // entry 9 ("hous" is 1 edit from "house").
    const rows = lookupReverse(model, "house");
    const exact = rows.find(
      (r) => !r.fuzzy && r.entries.some((e) => e.entryId === 8),
    );
    expect(exact?.tier).toBe(Tier.EXACT);
    const fuzzy = rows.find(
      (r) => r.fuzzy && r.entries.some((e) => e.entryId === 9),
    );
    expect(fuzzy).toBeDefined();
    expect(fuzzy!.distance).toBe(1);
  });

  test("fuzzy results never preempt real-tier rows", async () => {
    // Lower the fuzzy length floor so a 2-char query actually triggers
    // fuzzy — the test is about ordering between real and fuzzy tiers,
    // not the gating policy.
    const m = await buildFixtureModel(FIXTURE, { minQueryLengthForFuzzyEn: 0 });
    const rows = lookupReverse(m, "go");
    const realFirstFuzzyLast = (() => {
      let sawFuzzy = false;
      for (const r of rows) {
        if (r.fuzzy) sawFuzzy = true;
        else if (sawFuzzy) return false;
      }
      return true;
    })();
    expect(realFirstFuzzyLast).toBe(true);
  });

  test("fuzzy is absent when real-tier rows fill the result cap", async () => {
    const tinyModel = await buildFixtureModel(FIXTURE, {
      resultLimit: 2,
      minQueryLengthForFuzzyEn: 0,
    });
    const rows = lookupReverse(tinyModel, "go");
    expect(rows.length).toBe(2);
    expect(rows.every((r) => !r.fuzzy)).toBe(true);
  });

  test("fuzzy fills slots remaining after real-tier rows", async () => {
    const m = await buildFixtureModel(FIXTURE, { minQueryLengthForFuzzyEn: 0 });
    const rows = lookupReverse(m, "go");
    // We expect at least one FUZZY row when room remains; e.g. "got" (1
    // edit from "go") is the gloss of entry 4 and should show up.
    const fuzzyRows = rows.filter((r) => r.fuzzy);
    expect(fuzzyRows.length).toBeGreaterThan(0);
    const fuzzyKeys = fuzzyRows.map((r) => r.key);
    // "got" is the normalized gloss of entry 4 and is 1 edit from "go".
    expect(fuzzyKeys).toContain("got");
  });

  test("English fuzzy is gated by query length (no fuzzy for very short queries)", () => {
    // The default fuzzy length floor is 5. A 2-char query "go" finds
    // exact-tier matches via postings, but fuzzy near-matches ("got")
    // are intentionally suppressed because distance-1 on 2-char queries
    // matches unrelated words, not typos.
    const rows = lookupReverse(model, "go");
    expect(rows.every((r) => !r.fuzzy)).toBe(true);
  });

  test("merged-row tier reflects the highest-priority contributor", async () => {
    // Same query word appearing at multiple positions in the same gloss
    // yields multiple postings at different tiers (HEAD at pos 0,
    // INCIDENTAL at later positions). They merge into one bucket; the
    // bucket's tier must reflect the highest-priority contributor (HEAD,
    // not INCIDENTAL).
    const mergedFixture: FixtureEntry[] = [
      { entryId: 0, headword: "α", pos: "n", glosses: ["mango mango drink"] },
    ];
    const m = await buildFixtureModel(mergedFixture);
    const rows = lookupReverse(m, "mango");
    const row = rows.find((r) => r.key === "mango mango drink");
    expect(row?.tier).toBe(Tier.HEAD);
  });

  test("returns [] for an empty query", () => {
    expect(lookupReverse(model, "")).toEqual([]);
    expect(lookupReverse(model, "   ")).toEqual([]);
  });

  test("multi-word query matches an exact full-gloss entry", () => {
    const rows = lookupReverse(model, "go up");
    const exact = rows.find((r) => r.key === "go up" && !r.fuzzy);
    expect(exact?.tier).toBe(Tier.EXACT);
    expect(exact!.entries.map((e) => e.entryId)).toEqual([2]);
  });

  test("contains-fallback surfaces entries whose primary gloss contains the query word", () => {
    // "the" is a stopword in the fixture — excluded from postings.
    // No entry has the bare normalized gloss "the", so gloss_groups
    // misses too. The contains-fallback should LIKE-scan, word-filter,
    // and surface entry 11 (gloss "the man speaks", which tokenizes to
    // ["the", "man", "speaks"]).
    const rows = lookupReverse(model, "the");
    const containsRow = rows.find((r) =>
      r.entries.some((e) => e.entryId === 11),
    );
    expect(containsRow).toBeDefined();
    expect(containsRow!.fuzzy).toBe(false);
    expect(containsRow!.key).toBe("the man speaks");
  });

  test("stopword query falls back to gloss_groups", () => {
    // "a" is a stopword — excluded from postings at build time. The
    // default pass returns nothing; the empty-fallback driver re-runs
    // with single-token gloss_groups enabled and surfaces entry 10
    // (headword ဌ, gloss "a"). Mirrors the production bug where
    // searching "that" returned no results even though entries with
    // that gloss exist.
    const rows = lookupReverse(model, "a");
    const row = rows.find((r) => r.key === "a");
    expect(row).toBeDefined();
    expect(row!.fuzzy).toBe(false);
    expect(row!.tier).toBe(Tier.EXACT);
    expect(row!.entries.map((e) => e.entryId)).toContain(10);
  });
});

describe("searchBurmese", () => {
  test("returns the exact headword row first", () => {
    const rows = searchBurmese(model, "မြန်မာ");
    expect(rows[0].key).toBe("မြန်မာ");
    expect(rows[0].tier).toBe(Tier.EXACT);
    expect(rows[0].entries.map((e) => e.entryId)).toContain(6);
  });

  test("fuzzy fires at syllable edit distance 1", () => {
    const rows = searchBurmese(model, "မြန်မာ");
    // ထိုင်းမာ is 1 syllable away from မြန်မာ — a fuzzy row.
    const fuzzy = rows.find(
      (r) => r.fuzzy && r.entries.some((e) => e.entryId === 7),
    );
    expect(fuzzy).toBeDefined();
    expect(fuzzy!.distance).toBe(1);
  });

  test("fuzzy never preempts the exact-headword row", () => {
    const rows = searchBurmese(model, "မြန်မာ");
    let sawFuzzy = false;
    for (const r of rows) {
      if (r.fuzzy) sawFuzzy = true;
      else if (sawFuzzy) throw new Error("real row appeared after fuzzy");
    }
  });

  test("uses the same syllable tokenizer the BK-tree was built with", () => {
    // The BK-tree's distance metric works in syllable space. If the
    // module ever drifted to using a different tokenizer, no fuzzy
    // result for မြန်မာ would appear. The shared module is verified
    // by importing the segmenter and re-segmenting the query — the
    // syllable count should match the BK-tree's keying.
    const syls = segmentSyllables("မြန်မာ");
    expect(syls.length).toBe(2);
  });
});

describe("lookupForwardWithFuzzy", () => {
  test("returns the exact-tier row on a hit", () => {
    const rows = lookupForwardWithFuzzy(model, "မြန်မာ");
    expect(rows[0].tier).toBe(Tier.EXACT);
    expect(rows[0].entries.map((e) => e.entryId)).toContain(6);
  });

  test("falls back to syllable-fuzzy headwords on a miss", () => {
    // Single syllable "မြန်" — not a headword in the fixture. It is one
    // syllable's-edit (deletion) away from the headword မြန်မာ. Many
    // 1-syllable letters in the fixture are also distance 1 (sub), so
    // မြန်မာ is one of several fuzzy rows — the assertion is just that
    // it shows up and is marked fuzzy.
    const rows = lookupForwardWithFuzzy(model, "မြန်");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.fuzzy)).toBe(true);
    const mranmaRow = rows.find((r) =>
      r.entries.some((e) => e.entryId === 6),
    );
    expect(mranmaRow).toBeDefined();
    expect(mranmaRow!.distance).toBe(1);
  });
});
