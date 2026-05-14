import { describe, expect, test } from "vitest";
import corpus from "./__fixtures__/syllable-corpus.json";
import { segmentSyllables } from "./syllable";

type Case = { name: string; input: string; expected: string[] };

describe("segmentSyllables — shared cross-language corpus", () => {
  test("corpus uses the expected format tag", () => {
    expect(corpus.format).toBe("syllable-corpus/v1");
  });

  for (const c of corpus.cases as Case[]) {
    test(c.name, () => {
      expect(segmentSyllables(c.input)).toEqual(c.expected);
    });
  }
});

describe("segmentSyllables — local invariants", () => {
  test("round-trips losslessly when joined back", () => {
    for (const c of corpus.cases as Case[]) {
      expect(segmentSyllables(c.input).join("")).toBe(c.input);
    }
  });
});
