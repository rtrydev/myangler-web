// Smoke test: load the real synced assets and exercise each public path
// once. Skipped (with a placeholder) when assets have not been synced —
// matches the segmenter's parity-test pattern.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { loadDictionary } from "./loader";
import { lookupForward, lookupForwardWithFuzzy } from "./forward";
import { lookupReverse } from "./reverse";
import { searchBurmese } from "./burmeseSearch";

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
  SQLITE_PATH !== undefined && EN_PATH !== undefined && MY_PATH !== undefined;

describe.skipIf(!HAVE_ASSETS)(
  "Lookup module — smoke test against the real synced assets",
  () => {
    test("loads the real assets and answers basic queries", async () => {
      const sqlite = new Uint8Array(readFileSync(SQLITE_PATH!));
      const bktreeEn = JSON.parse(readFileSync(EN_PATH!, "utf8")) as unknown;
      const bktreeMy = JSON.parse(readFileSync(MY_PATH!, "utf8")) as unknown;
      const wasm = readFileSync(WASM_PATH);

      const model = await loadDictionary({
        kind: "raw",
        sqlite,
        bktreeEn,
        bktreeMy,
        wasm,
      });

      // The real assets carry thousands of entries / gloss-words; we
      // can't pin any single result. Smoke-level assertions only.
      expect(model.bktreeEn.size).toBeGreaterThan(0);
      expect(model.bktreeMy.size).toBeGreaterThan(0);

      // Reverse lookup of a generic English word should produce results
      // (Wiktionary has glosses with "the", "go", "water", etc.).
      const reverse = lookupReverse(model, "water");
      // Either there are hits, or there are not — both are valid for an
      // arbitrary word against an arbitrary dictionary. The contract is
      // that the call returns a shape, not a result count.
      expect(Array.isArray(reverse)).toBe(true);
      expect(reverse.length).toBeLessThanOrEqual(model.config.resultLimit);

      // Burmese search of a common Burmese word similarly: shape-level.
      const burmese = searchBurmese(model, "မြန်မာ");
      expect(Array.isArray(burmese)).toBe(true);

      // Forward lookup on a likely-nonexistent headword.
      expect(lookupForward(model, "definitely_not_a_burmese_word")).toBeNull();

      // Forward + fuzzy: the fallback path returns *some* shape on every
      // input.
      const ff = lookupForwardWithFuzzy(model, "မြန်မာ");
      expect(Array.isArray(ff)).toBe(true);
    });
  },
);

describe.skipIf(HAVE_ASSETS)(
  "Lookup module — smoke test (skipped: real assets not synced)",
  () => {
    test("placeholder — run `npm run sync:frontend-assets` to enable", () => {
      expect(HAVE_ASSETS).toBe(false);
    });
  },
);
