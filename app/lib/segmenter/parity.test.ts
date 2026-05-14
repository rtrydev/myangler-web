import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import referenceCorpus from "./__fixtures__/reference-corpus.json";
import { parseNgramModel } from "./loader";
import { segmentPrepared } from "./wordSegmenter";
import type { NgramModel } from "./types";

// The full myWord n-gram asset lives outside the repo (~32 MB,
// git-ignored). It is copied into `public/data/ngram.json` by
// `npm run sync:segmenter-asset`. Falls back to the build/ output if the
// public copy hasn't been synced yet.
const ASSET_CANDIDATES = [
  resolve(__dirname, "..", "..", "..", "public", "data", "ngram.json"),
  resolve(
    __dirname,
    "..",
    "..",
    "..",
    "tools",
    "data-pipeline",
    "build",
    "ngram.json",
  ),
];

const ASSET_PATH = ASSET_CANDIDATES.find((p) => existsSync(p));

describe.skipIf(ASSET_PATH === undefined)(
  "Viterbi port — parity with the corrected vendored Python reference",
  () => {
    let model: NgramModel;

    test("loads the full myword-ngram/v1 asset", () => {
      const raw = readFileSync(ASSET_PATH!, "utf8");
      const payload = JSON.parse(raw);
      model = parseNgramModel(payload);
      expect(model.unigramCount).toBeGreaterThan(0);
      expect(model.bigramCount).toBeGreaterThan(0);
    });

    test("reference fixture uses the expected format", () => {
      expect(referenceCorpus.format).toBe("myword-reference/v1");
      expect(referenceCorpus.cases.length).toBeGreaterThan(0);
    });

    test("segmentation is identical to the Python reference for every case", () => {
      // Every case in the fixture is the corrected vendored Python
      // reference's output. Any mismatch here is a port-level divergence
      // and must be surfaced.
      const divergences: Array<{
        input: string;
        prepared: string;
        expected: string[];
        got: string[];
      }> = [];

      for (const c of referenceCorpus.cases) {
        const got = segmentPrepared(model, c.prepared);
        if (
          got.length !== c.tokens.length ||
          got.some((t, i) => t !== c.tokens[i])
        ) {
          divergences.push({
            input: c.input,
            prepared: c.prepared,
            expected: c.tokens,
            got,
          });
        }
      }

      if (divergences.length > 0) {
        const summary = divergences
          .slice(0, 5)
          .map(
            (d, i) =>
              `  [${i + 1}] input: ${JSON.stringify(d.input)}\n` +
              `      expected: ${JSON.stringify(d.expected)}\n` +
              `      got:      ${JSON.stringify(d.got)}`,
          )
          .join("\n");
        throw new Error(
          `${divergences.length}/${referenceCorpus.cases.length} cases diverged from Python myWord:\n${summary}`,
        );
      }
    });
  },
);

describe.skipIf(ASSET_PATH !== undefined)(
  "Viterbi port — parity (skipped: full ngram.json unavailable)",
  () => {
    test("placeholder — sync the asset with `npm run sync:segmenter-asset` to enable", () => {
      // Intentional: ensures the test file always reports something.
      expect(ASSET_PATH).toBeUndefined();
    });
  },
);
