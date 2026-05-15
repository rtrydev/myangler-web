// Independent tests for `detectScript`. The rule is small enough to
// pin in isolation — the orchestrator's routing decisions rely on it.

import { describe, expect, test } from "vitest";
import { detectScript } from "./scriptDetect";

describe("detectScript", () => {
  test("Burmese-only text is 'burmese'", () => {
    expect(detectScript("မြန်မာ")).toBe("burmese");
    expect(detectScript("မြန်မာစကား")).toBe("burmese");
    // Lone Burmese letter.
    expect(detectScript("က")).toBe("burmese");
  });

  test("Latin-only text is 'latin'", () => {
    expect(detectScript("water")).toBe("latin");
    expect(detectScript("go up")).toBe("latin");
    expect(detectScript("Hello")).toBe("latin");
    expect(detectScript("a")).toBe("latin");
  });

  test("mixed Burmese + Latin is 'mixed'", () => {
    expect(detectScript("မြန်မာ test")).toBe("mixed");
    expect(detectScript("hello မြန်မာ")).toBe("mixed");
    expect(detectScript("aက")).toBe("mixed");
  });

  test("digits, punctuation, other-script alone are 'unknown'", () => {
    expect(detectScript("12345")).toBe("unknown");
    expect(detectScript("!?.,;")).toBe("unknown");
    expect(detectScript("12 + 34")).toBe("unknown");
    // Cyrillic — not Burmese, not Latin (ASCII) letters.
    expect(detectScript("Привет")).toBe("unknown");
    // CJK.
    expect(detectScript("你好")).toBe("unknown");
  });

  test("empty / whitespace-only is 'unknown'", () => {
    expect(detectScript("")).toBe("unknown");
    expect(detectScript("   ")).toBe("unknown");
    expect(detectScript("\t\n")).toBe("unknown");
  });

  test("neutral characters do not by themselves classify", () => {
    // Burmese letter + neutral chars: still Burmese.
    expect(detectScript("မြန်မာ 123!")).toBe("burmese");
    // Latin letter + neutral chars: still Latin.
    expect(detectScript("water 123!")).toBe("latin");
    // Only neutral chars: unknown.
    expect(detectScript("   123 !!! ")).toBe("unknown");
  });

  test("leading / trailing whitespace does not affect detection", () => {
    expect(detectScript("   မြန်မာ   ")).toBe("burmese");
    expect(detectScript("   water   ")).toBe("latin");
  });

  test("Myanmar Extended-A / Extended-B codepoints are recognized", () => {
    // Sample Extended-A code point (Khamti Shan letter range U+AA60+).
    expect(detectScript("ꩠ")).toBe("burmese");
    // Sample Extended-B code point.
    expect(detectScript("ꧠ")).toBe("burmese");
  });

  test("Non-ASCII Latin (accented) is intentionally NOT 'latin'", () => {
    // The reverse-lookup index keys on ASCII gloss-words; accented
    // letters are not normalized to ASCII at build time, so we don't
    // route them down the Latin path. Documents the chosen rule.
    expect(detectScript("café")).toBe("latin"); // 'cafe' has ASCII letters
    expect(detectScript("ñ")).toBe("unknown"); // no ASCII letters at all
  });
});
