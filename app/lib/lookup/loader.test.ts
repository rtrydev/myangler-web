// Loader-level tests: format-tag validation, asset wiring, idempotency.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildFixtureModel, WASM_PATH } from "./__fixtures__/buildFixture";
import { BKTreeFormatError, loadDictionary } from "./loader";
import type { AssetSources } from "./types";

describe("loadDictionary — format validation", () => {
  test("rejects a BK-tree asset with the wrong `format` field", async () => {
    const wasm = readFileSync(WASM_PATH);
    // Tiny but well-formed SQLite (built via the fixture helper) so the
    // BK-tree validation runs.
    const bytes = (await import("sql.js")).default;
    void bytes; // ensure sql.js is initialized through our cache before
    // we ask for a fresh load below.

    const stub = await stubSqliteBytes();
    const sources: AssetSources = {
      kind: "raw",
      sqlite: stub,
      bktreeEn: { format: "bktree/v0", size: 0, root: null, nodes: [], edges: [] },
      bktreeMy: { format: "bktree/v1", size: 0, root: null, nodes: [], edges: [] },
      wasm,
    };
    await expect(loadDictionary(sources)).rejects.toBeInstanceOf(
      BKTreeFormatError,
    );
  });

  test("rejects a Burmese BK-tree with non-array node values", async () => {
    const wasm = readFileSync(WASM_PATH);
    const stub = await stubSqliteBytes();
    const sources: AssetSources = {
      kind: "raw",
      sqlite: stub,
      bktreeEn: { format: "bktree/v1", size: 0, root: null, nodes: [], edges: [] },
      bktreeMy: {
        format: "bktree/v1",
        size: 1,
        root: 0,
        nodes: ["not-an-array"],
        edges: [{}],
      },
      wasm,
    };
    await expect(loadDictionary(sources)).rejects.toBeInstanceOf(
      BKTreeFormatError,
    );
  });
});

describe("loadDictionary — caching", () => {
  test("returns the same model promise for the same sources object", async () => {
    // Reuse a fixture model — calling load with the SAME sources object
    // a second time must return the same cached promise.
    const wasm = readFileSync(WASM_PATH);
    const stub = await stubSqliteBytes();
    const sources: AssetSources = {
      kind: "raw",
      sqlite: stub,
      bktreeEn: { format: "bktree/v1", size: 0, root: null, nodes: [], edges: [] },
      bktreeMy: { format: "bktree/v1", size: 0, root: null, nodes: [], edges: [] },
      wasm,
    };
    const first = loadDictionary(sources);
    const second = loadDictionary(sources);
    expect(first).toBe(second);
    await first; // ensure neither call rejects
  });
});

describe("loadDictionary — fixture path", () => {
  test("load-once-then-query-many: model is reusable across calls", async () => {
    const m = await buildFixtureModel([
      { entryId: 0, headword: "က", pos: "n", glosses: ["one"] },
    ]);
    // Two consecutive forward lookups on the same model — no re-init.
    expect(m.db.entriesByHeadword("က")[0].entryId).toBe(0);
    expect(m.db.entriesByHeadword("က")[0].entryId).toBe(0);
  });
});

// Build a minimally-valid SQLite database byte stream to use as filler in
// tests where we want to exercise BK-tree validation independently. We
// can't ship an empty Uint8Array — sql.js refuses to open an empty buffer.
async function stubSqliteBytes(): Promise<Uint8Array> {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs({
    wasmBinary: readFileSync(WASM_PATH) as unknown as ArrayBuffer,
  });
  const db = new SQL.Database();
  db.run("CREATE TABLE entries (entry_id INTEGER PRIMARY KEY);");
  const bytes = db.export();
  db.close();
  return bytes;
}
