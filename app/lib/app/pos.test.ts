import { describe, expect, test } from "vitest";
import {
  posCategory,
  POS_CATEGORY_LABEL,
  POS_CATEGORY_ORDER,
} from "./pos";

describe("posCategory", () => {
  test("maps noun forms to 'noun'", () => {
    expect(posCategory("n")).toBe("noun");
    expect(posCategory("noun")).toBe("noun");
    expect(posCategory("Noun")).toBe("noun");
    expect(posCategory("noun phrase")).toBe("noun");
  });

  test("maps verb forms to 'verb'", () => {
    expect(posCategory("v")).toBe("verb");
    expect(posCategory("verb")).toBe("verb");
    expect(posCategory("  VERB ")).toBe("verb");
  });

  test("maps adjectives and adverbs to 'modifier'", () => {
    expect(posCategory("adj")).toBe("modifier");
    expect(posCategory("adjective")).toBe("modifier");
    expect(posCategory("adv")).toBe("modifier");
    expect(posCategory("adverb")).toBe("modifier");
  });

  test("does not mistake look-alikes (pronoun ≠ noun, proverb ≠ verb)", () => {
    expect(posCategory("pronoun")).toBe("other");
    expect(posCategory("pron")).toBe("other");
    expect(posCategory("proverb")).toBe("other");
  });

  test("falls back to 'other' for particles, phrases, and empty values", () => {
    expect(posCategory("particle")).toBe("other");
    expect(posCategory("phrase")).toBe("other");
    expect(posCategory("conj")).toBe("other");
    expect(posCategory("")).toBe("other");
  });

  test("every category in the display order has a label", () => {
    for (const cat of POS_CATEGORY_ORDER) {
      expect(POS_CATEGORY_LABEL[cat]).toBeTruthy();
    }
  });
});
