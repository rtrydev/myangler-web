import { describe, expect, test } from "vitest";
import { buildFixtureModel } from "@/app/lib/lookup/__fixtures__/buildFixture";
import {
  dayOfYear,
  pickWordOfTheDay,
  popularHeadwords,
} from "./wordOfTheDay";

describe("dayOfYear", () => {
  test("is 1 on Jan 1 and stable within a day", () => {
    expect(dayOfYear(new Date(2021, 0, 1, 0, 0))).toBe(1);
    expect(dayOfYear(new Date(2021, 0, 1, 23, 59))).toBe(1);
  });

  test("increments by one across days", () => {
    const day = new Date(2021, 5, 15, 12, 0);
    const next = new Date(2021, 5, 16, 12, 0);
    expect(dayOfYear(next) - dayOfYear(day)).toBe(1);
  });

  test("reaches 365 on Dec 31 of a non-leap year", () => {
    expect(dayOfYear(new Date(2021, 11, 31, 12, 0))).toBe(365);
    // 2020 is a leap year, so Dec 31 is day 366.
    expect(dayOfYear(new Date(2020, 11, 31, 12, 0))).toBe(366);
  });
});

describe("popularHeadwords", () => {
  test("ranks headwords by corpus frequency, most popular first", async () => {
    const model = await buildFixtureModel([
      { entryId: 1, headword: "ရေ", pos: "noun", glosses: ["water"] },
      { entryId: 2, headword: "စား", pos: "verb", glosses: ["eat"] },
      { entryId: 3, headword: "သွား", pos: "verb", glosses: ["go"] },
    ]);
    const unigram = new Map([
      ["ရေ", 40],
      ["စား", 100],
      ["သွား", 70],
    ]);
    expect(popularHeadwords(model, unigram, 500)).toEqual([
      "စား",
      "သွား",
      "ရေ",
    ]);
  });

  test("excludes frequent tokens that are not dictionary headwords", async () => {
    const model = await buildFixtureModel([
      { entryId: 1, headword: "ရေ", pos: "noun", glosses: ["water"] },
    ]);
    const unigram = new Map([
      ["က", 9999], // a particle: very frequent, but has no entry
      ["ရေ", 5],
    ]);
    expect(popularHeadwords(model, unigram, 500)).toEqual(["ရေ"]);
  });

  test("excludes high-frequency function words even when they are headwords", async () => {
    // ကို (object marker) and ။ (full stop) are the kind of ultra-frequent
    // grammatical tokens that dominate raw corpus frequency; both exist as
    // Wiktionary headwords but must never surface as a word of the day.
    const model = await buildFixtureModel([
      { entryId: 1, headword: "ကို", pos: "part", glosses: ["to (marker)"] },
      { entryId: 2, headword: "။", pos: "punct", glosses: ["full stop"] },
      { entryId: 3, headword: "ရေ", pos: "noun", glosses: ["water"] },
    ]);
    const unigram = new Map([
      ["ကို", 99999],
      ["။", 88888],
      ["ရေ", 10],
    ]);
    expect(popularHeadwords(model, unigram, 500)).toEqual(["ရေ"]);
  });

  test("excludes headwords absent from the frequency table", async () => {
    const model = await buildFixtureModel([
      { entryId: 1, headword: "ရေ", pos: "noun", glosses: ["water"] },
      { entryId: 2, headword: "ဇဇဇ", pos: "noun", glosses: ["nonsense"] },
    ]);
    const unigram = new Map([["ရေ", 5]]);
    expect(popularHeadwords(model, unigram, 500)).toEqual(["ရေ"]);
  });

  test("caps the pool at the requested limit", async () => {
    const model = await buildFixtureModel([
      { entryId: 1, headword: "ရေ", pos: "noun", glosses: ["water"] },
      { entryId: 2, headword: "စား", pos: "verb", glosses: ["eat"] },
      { entryId: 3, headword: "သွား", pos: "verb", glosses: ["go"] },
    ]);
    const unigram = new Map([
      ["ရေ", 40],
      ["စား", 100],
      ["သွား", 70],
    ]);
    expect(popularHeadwords(model, unigram, 2)).toEqual(["စား", "သွား"]);
  });
});

describe("pickWordOfTheDay", () => {
  test("returns a word drawn from the popularity pool", async () => {
    const model = await buildFixtureModel([
      { entryId: 1, headword: "ရေ", pos: "noun", glosses: ["water"] },
      { entryId: 2, headword: "စား", pos: "verb", glosses: ["eat"] },
    ]);
    const unigram = new Map([
      ["ရေ", 40],
      ["စား", 100],
    ]);
    const entry = pickWordOfTheDay(model, unigram, 0);
    expect(["ရေ", "စား"]).toContain(entry?.headword);
  });

  test("is deterministic for a given seed", async () => {
    const model = await buildFixtureModel([
      { entryId: 1, headword: "ရေ", pos: "noun", glosses: ["water"] },
      { entryId: 2, headword: "စား", pos: "verb", glosses: ["eat"] },
      { entryId: 3, headword: "သွား", pos: "verb", glosses: ["go"] },
    ]);
    const unigram = new Map([
      ["ရေ", 40],
      ["စား", 100],
      ["သွား", 70],
    ]);
    expect(pickWordOfTheDay(model, unigram, 7)?.headword).toBe(
      pickWordOfTheDay(model, unigram, 7)?.headword,
    );
  });

  test("returns null when no headword carries a frequency", async () => {
    const model = await buildFixtureModel([
      { entryId: 1, headword: "ရေ", pos: "noun", glosses: ["water"] },
    ]);
    const unigram = new Map([["က", 9999]]); // only a non-headword token
    expect(pickWordOfTheDay(model, unigram, 3)).toBeNull();
  });
});
