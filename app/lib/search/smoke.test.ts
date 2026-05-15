// Smoke test: load the real synced assets — full `ngram.json` for the
// segmenter, real `dictionary.sqlite` + `bktree-*.json` for lookup —
// and exercise the orchestrator end to end. Skipped (with a
// placeholder) when assets are not synced; mirrors the segmenter parity
// and lookup smoke test patterns.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { loadDictionary } from "@/app/lib/lookup";
import { parseNgramModel } from "@/app/lib/segmenter";
import { load, search, singleWordSearch } from "./orchestrator";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const ASSET_DIRS = [
  resolve(REPO_ROOT, "public", "data"),
  resolve(REPO_ROOT, "tools", "data-pipeline", "build"),
];

function findAssetPath(name: string): string | undefined {
  for (const dir of ASSET_DIRS) {
    const p = resolve(dir, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

const NGRAM_PATH = findAssetPath("ngram.json");
const SQLITE_PATH = findAssetPath("dictionary.sqlite");
const EN_PATH = findAssetPath("bktree-en.json");
const MY_PATH = findAssetPath("bktree-my.json");
const WASM_PATH = resolve(
  REPO_ROOT,
  "node_modules",
  "sql.js",
  "dist",
  "sql-wasm.wasm",
);

const HAVE_ASSETS =
  NGRAM_PATH !== undefined &&
  SQLITE_PATH !== undefined &&
  EN_PATH !== undefined &&
  MY_PATH !== undefined;

describe.skipIf(!HAVE_ASSETS)(
  "Search orchestrator — smoke test against real synced assets",
  () => {
    test("a known Burmese sentence produces a sensible breakdown, English query produces ranked rows", async () => {
      const segmenter = parseNgramModel(
        JSON.parse(readFileSync(NGRAM_PATH!, "utf8")) as unknown,
      );
      const dictionary = await loadDictionary({
        kind: "raw",
        sqlite: new Uint8Array(readFileSync(SQLITE_PATH!)),
        bktreeEn: JSON.parse(readFileSync(EN_PATH!, "utf8")) as unknown,
        bktreeMy: JSON.parse(readFileSync(MY_PATH!, "utf8")) as unknown,
        wasm: readFileSync(WASM_PATH),
      });

      const engine = await load({ kind: "preloaded", segmenter, dictionary });

      // Burmese — sentence breakdown. The real segmenter + dictionary
      // produce *some* token sequence; the contract is the shape, not a
      // specific tokenization (which depends on the live n-gram).
      const sentence = search(engine, "မြန်မာစကားပြောတယ်");
      expect(sentence.kind).toBe("breakdown");
      if (sentence.kind !== "breakdown") throw new Error("unreachable");
      expect(sentence.tokens.length).toBeGreaterThan(0);
      // At least one Burmese token should hit the real dictionary —
      // the spec corpus contains common words like မြန်မာ, စကား, etc.
      const hits = sentence.tokens.filter((t) => t.result !== null);
      expect(hits.length).toBeGreaterThan(0);

      // English — reverse lookup.
      const reverse = search(engine, "water");
      expect(reverse.kind).toBe("reverse");
      if (reverse.kind !== "reverse") throw new Error("unreachable");
      expect(reverse.rows.length).toBeLessThanOrEqual(
        dictionary.config.resultLimit,
      );

      // Single-word Burmese search box.
      const single = singleWordSearch(engine, "မြန်မာ");
      expect(single.kind).toBe("single_word");
      if (single.kind !== "single_word") throw new Error("unreachable");
      expect(single.script).toBe("burmese");

      // Edge cases.
      expect(search(engine, "").kind).toBe("empty");
      expect(search(engine, "12345").kind).toBe("unrecognized");
    });
  },
);

describe.skipIf(HAVE_ASSETS)(
  "Search orchestrator — smoke test (skipped: real assets not synced)",
  () => {
    test("placeholder — run `npm run sync:frontend-assets` to enable", () => {
      expect(HAVE_ASSETS).toBe(false);
    });
  },
);
