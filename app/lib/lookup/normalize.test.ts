import { describe, expect, test } from "vitest";
import { normalizeGloss, tokenizeGlossWords } from "./normalize";

describe("normalizeGloss", () => {
  test("lowercases and trims", () => {
    expect(normalizeGloss("  Go  ")).toBe("go");
    expect(normalizeGloss("GO")).toBe("go");
  });

  test("strips leading 'to '", () => {
    expect(normalizeGloss("to go")).toBe("go");
    expect(normalizeGloss("To Go Up")).toBe("go up");
  });

  test("collapses internal whitespace", () => {
    expect(normalizeGloss("go   up")).toBe("go up");
  });

  test("handles empty / whitespace input", () => {
    expect(normalizeGloss("")).toBe("");
    expect(normalizeGloss("   ")).toBe("");
  });

  test("does not strip embedded 'to '", () => {
    expect(normalizeGloss("hold on to")).toBe("hold on to");
  });
});

describe("tokenizeGlossWords", () => {
  test("returns a single token for a single-word gloss", () => {
    expect(tokenizeGlossWords("go")).toEqual(["go"]);
  });

  test("splits multi-word glosses", () => {
    expect(tokenizeGlossWords("go up")).toEqual(["go", "up"]);
  });

  test("splits on hyphens — matches the Python regex", () => {
    expect(tokenizeGlossWords("brother-in-law")).toEqual([
      "brother",
      "in",
      "law",
    ]);
  });

  test("keeps inner apostrophes", () => {
    expect(tokenizeGlossWords("don't")).toEqual(["don't"]);
  });

  test("drops parenthetical punctuation", () => {
    expect(tokenizeGlossWords("go (away)")).toEqual(["go", "away"]);
  });

  test("returns [] for empty input", () => {
    expect(tokenizeGlossWords("")).toEqual([]);
  });
});
