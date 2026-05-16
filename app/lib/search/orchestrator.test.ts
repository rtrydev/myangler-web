// End-to-end tests for the search orchestrator against fixture engines.
//
// These tests exercise the *routing* logic and result shape — the
// segmentation and lookup engines themselves are pinned by their own
// tests in `app/lib/segmenter/` and `app/lib/lookup/`.

import { beforeAll, describe, expect, test } from "vitest";
import tinyNgram from "@/app/lib/segmenter/__fixtures__/tiny-ngram.json";
import { parseNgramModel } from "@/app/lib/segmenter";
import {
  buildSearchEngine,
  SEARCH_FIXTURE,
} from "./__fixtures__/buildSearchEngine";
import { buildFixtureModel } from "@/app/lib/lookup/__fixtures__/buildFixture";
import { load, search, singleWordSearch, type SearchEngine } from "./orchestrator";
import { detectScript } from "./scriptDetect";

let engine: SearchEngine;

beforeAll(async () => {
  engine = await buildSearchEngine();
});

describe("search — edge-case result kinds", () => {
  test("empty input → 'empty'", () => {
    expect(search(engine, "")).toEqual({ kind: "empty" });
  });

  test("whitespace-only input → 'empty'", () => {
    expect(search(engine, "   ")).toEqual({ kind: "empty" });
    expect(search(engine, "\t\n")).toEqual({ kind: "empty" });
  });

  test("too-long input → 'too_long' carrying the configured cap", async () => {
    const tinyEngine = await buildSearchEngine({ maxInputLength: 5 });
    const result = search(tinyEngine, "abcdef");
    expect(result.kind).toBe("too_long");
    if (result.kind !== "too_long") throw new Error("unreachable");
    expect(result.limit).toBe(5);
    expect(result.length).toBe(6);
  });

  test("digits-only input → 'unrecognized'", () => {
    expect(search(engine, "12345")).toEqual({ kind: "unrecognized" });
  });

  test("punctuation-only input → 'unrecognized'", () => {
    expect(search(engine, "!?.")).toEqual({ kind: "unrecognized" });
  });
});

describe("search — Burmese path (segment + eager exact forward-lookup)", () => {
  test("Burmese sentence produces a 'breakdown' with every token's lookup attached", () => {
    const result = search(engine, "မြန်မာစကား");
    expect(result.kind).toBe("breakdown");
    if (result.kind !== "breakdown") throw new Error("unreachable");
    expect(result.mixedInput).toBe(false);
    expect(result.tokens.map((t) => t.token)).toEqual(["မြန်မာ", "စကား"]);
    // Both tokens are present in the fixture — both have non-null results.
    expect(result.tokens[0].result?.entry.entryId).toBe(0);
    expect(result.tokens[1].result?.entry.entryId).toBe(1);
  });

  test("Burmese tokens that are not headwords produce null result slots (miss)", () => {
    // The tiny-ngram fixture segments "မြန်မာက" → ["မြန်မာ", "က"]. The
    // fixture dictionary intentionally omits "က", so its slot is a miss.
    const result = search(engine, "မြန်မာက");
    expect(result.kind).toBe("breakdown");
    if (result.kind !== "breakdown") throw new Error("unreachable");
    expect(result.tokens.map((t) => t.token)).toEqual(["မြန်မာ", "က"]);
    expect(result.tokens[0].result).not.toBeNull();
    expect(result.tokens[1].result).toBeNull();
  });

  test("Burmese single-word input collapses to the ranked 'reverse' view, symmetric with the Latin single-segment path", () => {
    // Crucial routing decision: when the segmenter emits exactly one
    // block, the orchestrator switches to the single-word ranked view
    // (via `searchBurmese`) instead of rendering a one-tile breakdown.
    // The same rule applies to single-segment Latin input — the search
    // tab's view choice is driven by `segmented.length`, not script.
    const result = search(engine, "မြန်မာ");
    expect(result.kind).toBe("reverse");
    if (result.kind !== "reverse") throw new Error("unreachable");
    expect(result.script).toBe("burmese");
    expect(result.rows.length).toBeGreaterThan(0);
    // The exact-headword row should surface (fixture entryId 0).
    const ids = result.rows.flatMap((r) => r.entries.map((e) => e.entryId));
    expect(ids).toContain(0);
  });

  test("eager lookup is exact-only — miss tokens stay null instead of fuzzy-rescuing", () => {
    // Proof by behavior: "က" is one syllable away from many fixture
    // headwords. `lookupForwardWithFuzzy` would surface a rescued row
    // for it; `lookupForward` (the exact-only path) returns null. The
    // orchestrator must use the exact-only path here, so the miss slot
    // is null — never a substituted fuzzy entry.
    const result = search(engine, "မြန်မာက");
    if (result.kind !== "breakdown") throw new Error("expected breakdown");
    const miss = result.tokens[1];
    expect(miss.token).toBe("က");
    expect(miss.result).toBeNull();
  });

  test("mixed input is treated as Burmese and carries mixedInput: true", () => {
    const result = search(engine, "မြန်မာ test");
    expect(result.kind).toBe("breakdown");
    if (result.kind !== "breakdown") throw new Error("unreachable");
    expect(result.mixedInput).toBe(true);
    // The segmenter strips ASCII spaces, then segments. The first token
    // matches our fixture entry; non-Burmese trailing runs may or may
    // not appear as separate tokens — we just assert the breakdown
    // exists and the Burmese hit is preserved.
    expect(result.tokens.length).toBeGreaterThan(0);
    const hits = result.tokens.filter((t) => t.result !== null);
    expect(hits.map((t) => t.result!.entry.entryId)).toContain(0);
  });
});

describe("search — Latin (English) path", () => {
  test("single-word Latin input produces a 'reverse' result with the lookup module's top-N", () => {
    const result = search(engine, "speak");
    expect(result.kind).toBe("reverse");
    if (result.kind !== "reverse") throw new Error("unreachable");
    expect(result.rows.length).toBeGreaterThan(0);
    // The fixture entry whose gloss is "speak" (entryId 2) should
    // surface in the top results.
    const ids = result.rows.flatMap((r) => r.entries.map((e) => e.entryId));
    expect(ids).toContain(2);
  });

  test("single-word Latin input respects the lookup module's result cap (≤10)", () => {
    const result = search(engine, "water");
    expect(result.kind).toBe("reverse");
    if (result.kind !== "reverse") throw new Error("unreachable");
    expect(result.rows.length).toBeLessThanOrEqual(
      engine.dictionary.config.resultLimit,
    );
  });

  test("multi-word Latin input produces an English 'breakdown' (sentence mode)", () => {
    const result = search(engine, "happy new year");
    expect(result.kind).toBe("breakdown");
    if (result.kind !== "breakdown") throw new Error("unreachable");
    expect(result.script).toBe("english");
    expect(result.mixedInput).toBe(false);
    // "new year" is a known multi-word gloss in the fixture, so the
    // sentence collapses into ["happy", "new year"] — proof that the
    // segmenter groups the known phrase rather than emitting three
    // separate single-word tiles.
    expect(result.tokens.map((t) => t.token)).toEqual(["happy", "new year"]);
    // Each tile carries its exact-gloss forward lookup.
    expect(result.tokens[0].result?.entry.entryId).toBe(5);
    expect(result.tokens[1].result?.entry.entryId).toBe(4);
  });

  test("English breakdown preserves original casing in tile tokens", () => {
    const result = search(engine, "Happy New Year");
    if (result.kind !== "breakdown") throw new Error("expected breakdown");
    expect(result.tokens.map((t) => t.token)).toEqual(["Happy", "New Year"]);
  });

  test("English sentence with an unknown word produces a null-result tile for the miss", () => {
    const result = search(engine, "happy absent");
    if (result.kind !== "breakdown") throw new Error("expected breakdown");
    expect(result.script).toBe("english");
    expect(result.tokens.map((t) => t.token)).toEqual(["happy", "absent"]);
    expect(result.tokens[0].result).not.toBeNull();
    expect(result.tokens[1].result).toBeNull();
  });

  test("a multi-word input that resolves to a single segment renders as 'reverse', not a one-tile breakdown", () => {
    // "new year" is a known multi-word gloss in the fixture. The
    // segmenter collapses it to one segment, which is logically a
    // single query — the orchestrator must surface it as the ranked
    // reverse-lookup view rather than a one-tile breakdown.
    const result = search(engine, "new year");
    expect(result.kind).toBe("reverse");
    if (result.kind !== "reverse") throw new Error("unreachable");
    // The reverse lookup resolves the same entry (entryId 4 owns
    // gloss "new year" in the fixture).
    const ids = result.rows.flatMap((r) => r.entries.map((e) => e.entryId));
    expect(ids).toContain(4);
  });

  test("view stabilizes — half-typed multi-atom input is breakdown, full single-phrase input falls back to reverse", () => {
    // Simulates the user typing "new year" character by character.
    // While the input is two unmatched atoms ("new" alone has no exact
    // gloss in the fixture) we expect breakdown mode; once the full
    // phrase resolves to a single segment, the orchestrator falls back
    // to the ranked reverse-lookup so the view doesn't get stuck on a
    // one-tile breakdown.
    const mid = search(engine, "new ye");
    expect(mid.kind).toBe("breakdown");
    if (mid.kind !== "breakdown") throw new Error("unreachable");
    expect(mid.tokens.length).toBe(2);

    const done = search(engine, "new year");
    expect(done.kind).toBe("reverse");
  });

  test('"a fish" routes to reverse-lookup with the article stripped', () => {
    // The segmenter collapses "a fish" into a single article-absorbed
    // segment with `reverseLookupKey: "fish"`. The orchestrator picks
    // up that key and routes through `lookupReverse(model, "fish")` —
    // not the literal "a fish" — so the user sees the same ranked
    // single-word view they would have seen typing just "fish".
    const result = search(engine, "a fish");
    expect(result.kind).toBe("reverse");
    if (result.kind !== "reverse") throw new Error("unreachable");
    const ids = result.rows.flatMap((r) => r.entries.map((e) => e.entryId));
    expect(ids).toContain(6);
  });

  test('"a fish" surfaces the same ranked rows as "fish" alone', () => {
    // The user-facing invariant: typing "a fish" should not behave
    // differently from typing "fish". Compare the two row lists to
    // make that drift visible if the article-stripping path ever
    // regresses.
    const articled = search(engine, "a fish");
    const bare = search(engine, "fish");
    if (articled.kind !== "reverse" || bare.kind !== "reverse") {
      throw new Error("both queries must route to reverse view");
    }
    const idsArticled = articled.rows.flatMap((r) =>
      r.entries.map((e) => e.entryId),
    );
    const idsBare = bare.rows.flatMap((r) => r.entries.map((e) => e.entryId));
    expect(idsArticled).toEqual(idsBare);
  });
});

describe("singleWordSearch", () => {
  test("Burmese single-word query → exact + syllable fuzzy via searchBurmese", () => {
    const result = singleWordSearch(engine, "မြန်မာ");
    expect(result.kind).toBe("single_word");
    if (result.kind !== "single_word") throw new Error("unreachable");
    expect(result.script).toBe("burmese");
    // The exact-headword row should be present.
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].key).toBe("မြန်မာ");
  });

  test("Latin single-word query → lookupReverse", () => {
    const result = singleWordSearch(engine, "speak");
    expect(result.kind).toBe("single_word");
    if (result.kind !== "single_word") throw new Error("unreachable");
    expect(result.script).toBe("latin");
    expect(result.rows.length).toBeGreaterThan(0);
  });

  test("edge-case handling mirrors search()", () => {
    expect(singleWordSearch(engine, "")).toEqual({ kind: "empty" });
    expect(singleWordSearch(engine, "   ")).toEqual({ kind: "empty" });
    expect(singleWordSearch(engine, "12345")).toEqual({ kind: "unrecognized" });
  });

  test("too-long input → 'too_long'", async () => {
    const tinyEngine = await buildSearchEngine({ maxInputLength: 3 });
    const result = singleWordSearch(tinyEngine, "မြန်မာ");
    expect(result.kind).toBe("too_long");
  });
});

describe("load — dependency injection and idempotency", () => {
  test("accepts already-loaded engines without re-initializing", async () => {
    const segmenter = parseNgramModel(tinyNgram);
    const dictionary = await buildFixtureModel(SEARCH_FIXTURE);

    const e = await load({ kind: "preloaded", segmenter, dictionary });
    expect(e.segmenter).toBe(segmenter);
    expect(e.dictionary).toBe(dictionary);
  });

  test("repeated load() with the same input object returns the same promise", async () => {
    const segmenter = parseNgramModel(tinyNgram);
    const dictionary = await buildFixtureModel(SEARCH_FIXTURE);
    const input = { kind: "preloaded" as const, segmenter, dictionary };
    const p1 = load(input);
    const p2 = load(input);
    expect(p1).toBe(p2);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(b);
  });

  test("config defaults to DEFAULT_CONFIG when omitted", async () => {
    const segmenter = parseNgramModel(tinyNgram);
    const dictionary = await buildFixtureModel(SEARCH_FIXTURE);
    const e = await load({ kind: "preloaded", segmenter, dictionary });
    expect(e.config.maxInputLength).toBe(500);
  });
});

describe("result shape is serializable", () => {
  test("every result kind round-trips through JSON.stringify", () => {
    const cases = [
      search(engine, ""),
      search(engine, "12345"),
      search(engine, "မြန်မာစကား"),
      search(engine, "မြန်မာ test"),
      search(engine, "speak"),
      singleWordSearch(engine, "မြန်မာ"),
      singleWordSearch(engine, "water"),
    ];
    for (const r of cases) {
      const roundtripped = JSON.parse(JSON.stringify(r));
      expect(roundtripped).toEqual(r);
    }
  });

  test("too-long result is serializable", async () => {
    const tinyEngine = await buildSearchEngine({ maxInputLength: 2 });
    const r = search(tinyEngine, "abc");
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe("script detection drives routing", () => {
  // Smoke-level check that the orchestrator and `detectScript` agree on
  // the routing edges.
  test.each([
    // Single-block inputs collapse to 'reverse' regardless of script —
    // the Burmese case used to stay a one-tile breakdown; it now mirrors
    // the Latin single-segment behavior.
    ["မြန်မာ", "burmese", "reverse"],
    ["speak", "latin", "reverse"],
    // "new year" is a known multi-word gloss in the fixture; the
    // segmenter collapses it to one segment, which the orchestrator
    // surfaces as a single-query reverse-lookup, not a one-tile
    // breakdown.
    ["new year", "latin", "reverse"],
    // Multi-segment English remains breakdown.
    ["happy absent", "latin", "breakdown"],
    ["မြန်မာ test", "mixed", "breakdown"],
    ["12345", "unknown", "unrecognized"],
  ])("%s → script=%s → result.kind=%s", (input, script, kind) => {
    expect(detectScript(input.trim())).toBe(script);
    expect(search(engine, input).kind).toBe(kind);
  });
});
