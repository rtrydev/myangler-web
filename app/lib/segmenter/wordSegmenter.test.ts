import { describe, expect, test } from "vitest";
import tinyAsset from "./__fixtures__/tiny-ngram.json";
import { parseNgramModel } from "./loader";
import {
  preprocess,
  segmentPrepared,
  segmentWords,
} from "./wordSegmenter";
import type { NgramAsset, NgramModel } from "./types";

const TINY_MODEL: NgramModel = parseNgramModel(tinyAsset);

// Synthetic asset where unigram-only vs. bigram-aware Viterbi pick
// different segmentations of "abcd". Used by the "bigrams are live"
// regression test below. See the test for the algebra.
const BIGRAM_DISCRIMINATOR_ASSET: NgramAsset = {
  format: "myword-ngram/v1",
  source: { unigram: "synthetic", bigram: "synthetic" },
  unigram_count: 5,
  unigram_total: 141,
  bigram_count: 1,
  bigram_total: 100,
  unigram: { abc: 50, ab: 30, c: 30, abcd: 1, d: 30 },
  bigram: { abc: { d: 100 } },
};
const BIGRAM_DISCRIMINATOR_NO_BIGRAM: NgramAsset = {
  ...BIGRAM_DISCRIMINATOR_ASSET,
  bigram_count: 0,
  bigram_total: 0,
  bigram: {},
};

describe("segmentWords — load-once-then-segment-many", () => {
  test("the same model can be reused across many calls", () => {
    expect(segmentWords(TINY_MODEL, "မြန်မာစကား")).toEqual([
      "မြန်မာ",
      "စကား",
    ]);
    expect(segmentWords(TINY_MODEL, "မြန်မာက")).toEqual(["မြန်မာ", "က"]);
    expect(segmentWords(TINY_MODEL, "ပြော")).toEqual(["ပြော"]);
  });

  test("segmentation is synchronous and pure given a model", () => {
    const a = segmentWords(TINY_MODEL, "မြန်မာစကား");
    const b = segmentWords(TINY_MODEL, "မြန်မာစကား");
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // distinct array instances → no shared cache leak
  });
});

describe("segmentWords — edge cases (mirrors the upstream Python)", () => {
  test("empty string returns []", () => {
    expect(segmentWords(TINY_MODEL, "")).toEqual([]);
  });

  test("whitespace-only input returns []", () => {
    // myword.py preprocessing is `line.replace(" ", "").strip()`; either
    // operation alone is enough to leave nothing for Viterbi.
    expect(segmentWords(TINY_MODEL, "   ")).toEqual([]);
    expect(segmentWords(TINY_MODEL, "\t\n")).toEqual([]);
  });

  test("ASCII spaces between Burmese tokens are stripped before Viterbi", () => {
    // The preprocessing step removes interior spaces, so these inputs
    // produce the same segmentation as the no-space form.
    expect(segmentWords(TINY_MODEL, "မြန်မာ စကား")).toEqual([
      "မြန်မာ",
      "စကား",
    ]);
  });

  test("non-Burmese characters are run through Viterbi as unknown words", () => {
    // ASCII letters are not in the unigram map, so each individual char
    // gets the unknown-word smoothing. Compare against the prepared form
    // to make the contract explicit.
    expect(segmentWords(TINY_MODEL, "abc")).toEqual(
      segmentPrepared(TINY_MODEL, "abc"),
    );
    expect(segmentWords(TINY_MODEL, "abc")).not.toEqual([]);
  });

  test("Burmese with digits and punctuation is not specially preprocessed", () => {
    // No Python-side stripping of digits or `။` — they pass through as
    // unknown-unigram tokens. Just lock the contract in: empty? no.
    const tokens = segmentWords(TINY_MODEL, "မြန်မာ၁၂၃။");
    expect(tokens.length).toBeGreaterThan(0);
    // The known prefix must still be recovered as a single token.
    expect(tokens[0]).toBe("မြန်မာ");
  });
});

describe("preprocess", () => {
  test('strips ASCII spaces and outer whitespace, like Python\'s line.replace(" ", "").strip()', () => {
    expect(preprocess("  hello world  ")).toBe("helloworld");
    expect(preprocess("မြန်မာ စကား")).toBe("မြန်မာစကား");
    expect(preprocess("")).toBe("");
    expect(preprocess("   ")).toBe("");
  });
});

describe("segmentWords — bigrams are live (regression check)", () => {
  // The load-bearing TS-side companion to
  // `tools/data-pipeline/tests/test_reference_myword.py::test_bigrams_change_output_on_ambiguous_input`.
  //
  // The synthetic asset above has two competing parses for "abcd":
  //
  //   • single word "abcd" — known unigram with count 1
  //     score = log10(1 / 102490) ≈ -5.01
  //
  //   • split ["abc", "d"]
  //     - unigram-only: log10(50/N) + log10(30/N) ≈ -3.31 + -3.53 ≈ -6.84
  //     - bigram-aware: log10(50/N) + log10(P_bigram[(abc,d)] / count(abc))
  //                   = log10(50/N) + log10(100/50)
  //                   ≈ -3.31 + 0.30 ≈ -3.01
  //
  // So unigram-only picks ["abcd"] (-5.01 > -6.84) and bigram-aware picks
  // ["abc", "d"] (-3.01 is the best of all). If the port regresses to
  // unigram-only, this test fails.
  test("bigram-aware Viterbi splits 'abcd' but unigram-only would not", () => {
    const withBigram = parseNgramModel(BIGRAM_DISCRIMINATOR_ASSET);
    const withoutBigram = parseNgramModel(BIGRAM_DISCRIMINATOR_NO_BIGRAM);

    expect(segmentPrepared(withBigram, "abcd")).toEqual(["abc", "d"]);
    expect(segmentPrepared(withoutBigram, "abcd")).toEqual(["abcd"]);
  });

  test("observably consults the bigram map via a hit-counting Proxy", () => {
    // Stronger guard: instrument the bigram map so any read is counted.
    // If a future change accidentally bypasses the bigram lookup the
    // counter stays at zero and this test fails immediately.
    const model = parseNgramModel(BIGRAM_DISCRIMINATOR_ASSET);
    let hits = 0;
    const original = model.bigram.get.bind(model.bigram);
    (model.bigram as { get: typeof original }).get = (key: string) => {
      const inner = original(key);
      if (inner !== undefined) hits += 1;
      return inner;
    };
    segmentPrepared(model, "abcd");
    expect(hits).toBeGreaterThan(0);
  });
});
