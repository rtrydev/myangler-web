import { describe, expect, test } from "vitest";
import { buildFixtureModel } from "@/app/lib/lookup/__fixtures__/buildFixture";
import { dayNumber, pickWordOfTheDay } from "./wordOfTheDay";

describe("dayNumber", () => {
  test("is stable within a day and increments by one across days", () => {
    const noon = new Date("2020-06-15T12:00:00");
    const sameDay = new Date("2020-06-15T23:30:00");
    const nextDay = new Date("2020-06-16T12:00:00");
    expect(dayNumber(noon)).toBe(dayNumber(sameDay));
    expect(dayNumber(nextDay) - dayNumber(noon)).toBe(1);
  });
});

describe("pickWordOfTheDay", () => {
  test("returns a candidate that exists in the dictionary", async () => {
    // ရေ ("water") is in the candidate list; the others here are not.
    const model = await buildFixtureModel([
      { entryId: 1, headword: "ရေ", pos: "noun", glosses: ["water"] },
      { entryId: 2, headword: "ဇဇဇ", pos: "noun", glosses: ["nonsense"] },
    ]);
    const entry = pickWordOfTheDay(model, 0);
    expect(entry?.headword).toBe("ရေ");
  });

  test("is deterministic for a given seed", async () => {
    const model = await buildFixtureModel([
      { entryId: 1, headword: "ရေ", pos: "noun", glosses: ["water"] },
    ]);
    expect(pickWordOfTheDay(model, 7)?.headword).toBe(
      pickWordOfTheDay(model, 7)?.headword,
    );
  });

  test("returns null when no candidate resolves", async () => {
    const model = await buildFixtureModel([
      { entryId: 1, headword: "ဇဇဇ", pos: "noun", glosses: ["nonsense"] },
    ]);
    expect(pickWordOfTheDay(model, 3)).toBeNull();
  });
});
