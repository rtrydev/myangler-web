// Builds a small fixture dictionary in memory: a real SQLite database
// (via sql.js) plus matching `bktree/v1` JSON payloads. The fixture is
// hand-tuned to exercise every code path in the lookup module:
//
//   - forward lookup hit / miss / merged peers
//   - reverse-lookup tier behavior (exact / head / incidental)
//   - merging on identical normalized glosses across tiers
//   - fuzzy fill behavior (fuzzy present when tiers leave room; absent
//     when they fill all 10 slots; never preempting a real-tier row)
//   - English fuzzy ("recieve" → "receive") and Burmese syllable fuzzy
//   - normalization ("Go" / "to go" / "go")
//
// Loading the fixture mirrors the runtime "raw" path so the loader's
// validation discipline is exercised end-to-end.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import initSqlJs from "sql.js";
import { segmentSyllables } from "@/app/lib/segmenter";
import {
  loadDictionary,
  type DictionaryModel,
  type LookupConfig,
} from "../index";

const WASM_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "node_modules",
  "sql.js",
  "dist",
  "sql-wasm.wasm",
);

/** One entry in the fixture, in the same shape the strip step produces. */
interface FixtureEntry {
  entryId: number;
  headword: string;
  pos: string;
  glosses: string[];
  ipa?: string | null;
}

function normalizeGloss(text: string): string {
  let s = text.trim().toLowerCase().split(/\s+/u).filter(Boolean).join(" ");
  if (s.startsWith("to ")) s = s.slice(3).replace(/^\s+/u, "");
  return s;
}

const WORD_RE = /[a-z0-9](?:[a-z0-9']*[a-z0-9])?/g;
function tokenizeGlossWords(normalized: string): string[] {
  return normalized ? (normalized.match(WORD_RE) ?? []) : [];
}

// Tier values must mirror the build pipeline.
const TIER_EXACT = 0;
const TIER_HEAD = 1;
const TIER_INCIDENTAL = 2;

/** Build the SQLite bytes for a given list of fixture entries. The DDL
 *  is identical to `tools/data-pipeline/src/data_pipeline/steps/build_db.py`,
 *  so tests run against the real production schema. */
async function buildSqliteBytes(
  entries: FixtureEntry[],
  stopwords: ReadonlySet<string> = new Set(["a", "the"]),
): Promise<Uint8Array> {
  const SQL = await initSqlJs({
    wasmBinary: readFileSync(WASM_PATH) as unknown as ArrayBuffer,
  });
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE entries (
      entry_id INTEGER PRIMARY KEY,
      headword TEXT NOT NULL,
      pos TEXT NOT NULL,
      glosses TEXT NOT NULL,
      normalized_glosses TEXT NOT NULL,
      ipa TEXT
    );
    CREATE TABLE postings (
      word TEXT NOT NULL,
      tier INTEGER NOT NULL,
      entry_id INTEGER NOT NULL,
      gloss_index INTEGER NOT NULL,
      PRIMARY KEY (word, tier, entry_id, gloss_index)
    ) WITHOUT ROWID;
    CREATE TABLE gloss_groups (
      normalized_gloss TEXT NOT NULL,
      entry_id INTEGER NOT NULL,
      PRIMARY KEY (normalized_gloss, entry_id)
    ) WITHOUT ROWID;
    CREATE INDEX idx_entries_headword ON entries (headword);
  `);

  const insertEntry = db.prepare(
    "INSERT INTO entries (entry_id, headword, pos, glosses, normalized_glosses, ipa) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertPosting = db.prepare(
    "INSERT INTO postings (word, tier, entry_id, gloss_index) VALUES (?, ?, ?, ?)",
  );
  const insertGroup = db.prepare(
    "INSERT INTO gloss_groups (normalized_gloss, entry_id) VALUES (?, ?)",
  );

  for (const e of entries) {
    const normalized = e.glosses.map(normalizeGloss);
    insertEntry.run([
      e.entryId,
      e.headword,
      e.pos,
      JSON.stringify(e.glosses),
      JSON.stringify(normalized),
      e.ipa ?? null,
    ]);

    const seenPosting = new Set<string>();
    const seenGroup = new Set<string>();
    for (let gi = 0; gi < normalized.length; gi++) {
      const norm = normalized[gi];
      if (!norm) continue;
      const groupKey = `${norm}|${e.entryId}`;
      if (!seenGroup.has(groupKey)) {
        seenGroup.add(groupKey);
        insertGroup.run([norm, e.entryId]);
      }
      const words = tokenizeGlossWords(norm);
      if (words.length === 0) continue;
      const isSingleWord = words.length === 1;
      for (let pos = 0; pos < words.length; pos++) {
        const word = words[pos];
        if (stopwords.has(word)) continue;
        const tier = isSingleWord
          ? TIER_EXACT
          : pos === 0
            ? TIER_HEAD
            : TIER_INCIDENTAL;
        const key = `${word}|${tier}|${e.entryId}|${gi}`;
        if (seenPosting.has(key)) continue;
        seenPosting.add(key);
        insertPosting.run([word, tier, e.entryId, gi]);
      }
    }
  }
  insertEntry.free();
  insertPosting.free();
  insertGroup.free();

  const bytes = db.export();
  db.close();
  return bytes;
}

/** Build a `bktree/v1` payload over an arbitrary set of keys, using a
 *  caller-supplied distance function. Mirrors the Python BFS-flat
 *  serialization shape so the runtime loader's validation passes. */
function buildBKTreePayload<V>(
  rawKeys: V[],
  toNode: (v: V) => unknown,
  distance: (a: V, b: V) => number,
  eq: (a: V, b: V) => boolean = (a, b) => a === b,
): unknown {
  const keys: V[] = [];
  for (const k of rawKeys) {
    if (!keys.some((seen) => eq(seen, k))) keys.push(k);
  }
  if (keys.length === 0) {
    return {
      format: "bktree/v1",
      size: 0,
      root: null,
      nodes: [],
      edges: [],
    };
  }
  const values: V[] = [keys[0]];
  const edges: Record<string, number>[] = [{}];
  for (let i = 1; i < keys.length; i++) {
    const value = keys[i];
    let nodeIdx = 0;
    while (true) {
      const d = distance(value, values[nodeIdx]);
      if (d === 0) break;
      const child = edges[nodeIdx][String(d)];
      if (child === undefined) {
        const newIdx = values.length;
        values.push(value);
        edges.push({});
        edges[nodeIdx][String(d)] = newIdx;
        break;
      }
      nodeIdx = child;
    }
  }
  return {
    format: "bktree/v1",
    size: values.length,
    root: 0,
    nodes: values.map(toNode),
    edges,
  };
}

function levenshteinStr(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  let curr = new Array<number>(lb + 1);
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

function levenshteinSyls(a: readonly string[], b: readonly string[]): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  let curr = new Array<number>(lb + 1);
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

function eqSyls(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Build the complete in-memory fixture and load it through the
 *  module's own loader. The returned model is ready to query. */
export async function buildFixtureModel(
  entries: FixtureEntry[],
  config: Partial<LookupConfig> = {},
): Promise<DictionaryModel> {
  const sqlite = await buildSqliteBytes(entries);

  // English BK-tree: distinct non-stopword gloss-words across every
  // entry's normalized glosses.
  const stopwords = new Set(["a", "the"]);
  const enWords = new Set<string>();
  for (const e of entries) {
    for (const g of e.glosses) {
      for (const w of tokenizeGlossWords(normalizeGloss(g))) {
        if (!stopwords.has(w)) enWords.add(w);
      }
    }
  }
  const bktreeEn = buildBKTreePayload(
    [...enWords],
    (w) => w,
    levenshteinStr,
  );

  // Burmese BK-tree: distinct headwords, segmented into syllable
  // sequences with the shared segmenter (the very segmenter Burmese
  // fuzzy lookup will tokenize the query with at runtime).
  const headwords = new Set(entries.map((e) => e.headword));
  const bktreeMy = buildBKTreePayload<readonly string[]>(
    [...headwords].map((h) => segmentSyllables(h)),
    (syls) => syls,
    levenshteinSyls,
    eqSyls,
  );

  const wasm = readFileSync(WASM_PATH);
  return loadDictionary(
    {
      kind: "raw",
      sqlite,
      bktreeEn,
      bktreeMy,
      wasm,
    },
    config,
  );
}

/** Re-exports for tests that need to construct payloads directly. */
export { buildBKTreePayload, buildSqliteBytes, readFileSync, WASM_PATH };
export type { FixtureEntry };
