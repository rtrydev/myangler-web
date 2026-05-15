// sql.js wiring + DB query helpers.
//
// Initialization is async (we must fetch the WASM binary); every query
// is synchronous afterwards. Each call below uses prepared statements
// with parameter binding — never string concatenation.

import initSqlJs, {
  type Database,
  type SqlJsStatic,
  type Statement,
} from "sql.js";

import type { Entry, TierValue } from "./types";
import { Tier } from "./types";

/** Lazily-initialized sql.js runtime. Subsequent loads reuse it. */
let sqlJsPromise: Promise<SqlJsStatic> | null = null;

/** Initialize sql.js once. `wasmUrl` is the URL of the WASM binary; if
 *  omitted, sql.js falls back to its default resolution which only works
 *  in environments where it can find the file beside `sql-wasm.js`. */
export function getSqlJs(wasmUrl?: string): Promise<SqlJsStatic> {
  if (sqlJsPromise === null) {
    sqlJsPromise = initSqlJs(
      wasmUrl
        ? { locateFile: () => wasmUrl }
        : undefined,
    );
  }
  return sqlJsPromise;
}

/** Test-seam: load sql.js from raw WASM bytes (Node test environments
 *  where there is no `fetch`/URL for the WASM file). Replaces the cached
 *  promise. */
export function setSqlJsWasm(wasmBinary: ArrayBuffer | Uint8Array): Promise<SqlJsStatic> {
  // sql.js's `wasmBinary` option (inherited from Emscripten) takes a raw
  // buffer and skips the fetch entirely.
  sqlJsPromise = initSqlJs({
    // The emscripten typings disagree about whether `wasmBinary` accepts
    // Uint8Array — at runtime it does. Cast through `unknown` to satisfy
    // both shapes.
    wasmBinary: wasmBinary as unknown as ArrayBuffer,
  });
  return sqlJsPromise;
}

function parseStringArray(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is string => typeof x === "string");
}

function rowToEntry(row: Record<string, unknown>): Entry {
  return {
    entryId: row.entry_id as number,
    headword: row.headword as string,
    pos: (row.pos as string | null) ?? "",
    glosses: parseStringArray(row.glosses),
    normalizedGlosses: parseStringArray(row.normalized_glosses),
    ipa: typeof row.ipa === "string" ? row.ipa : null,
  };
}

const SELECT_ENTRY_COLS =
  "entry_id, headword, pos, glosses, normalized_glosses, ipa";

/** Thin wrapper that runs prepared statements against the dictionary
 *  database. Holds cached statements so hot paths don't re-prepare on
 *  every call. The wrapper *owns* the cached statements but never the
 *  Database itself — callers manage DB lifecycle. */
export class DictionaryDB {
  private readonly db: Database;
  private readonly stmts = new Map<string, Statement>();

  constructor(db: Database) {
    this.db = db;
  }

  private prepare(sql: string): Statement {
    const cached = this.stmts.get(sql);
    if (cached) return cached;
    const stmt = this.db.prepare(sql);
    this.stmts.set(sql, stmt);
    return stmt;
  }

  private all(sql: string, params: unknown[]): Record<string, unknown>[] {
    const stmt = this.prepare(sql);
    stmt.reset();
    // sql.js' BindParams permits SqlValue[] (number | string | Uint8Array | null).
    // Our internal callers only ever pass strings and numbers.
    stmt.bind(params as never);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  }

  /** Free all cached statements. Call before discarding the wrapper if
   *  the underlying DB will outlive it. */
  close(): void {
    for (const stmt of this.stmts.values()) {
      stmt.free();
    }
    this.stmts.clear();
  }

  // ---- Forward lookup --------------------------------------------------

  /** Look up entries by exact headword. The schema does not enforce a
   *  unique constraint on `headword` — multiple raw entries (different
   *  parts of speech, etc.) can collide — so we return every row. */
  entriesByHeadword(headword: string): Entry[] {
    return this.all(
      `SELECT ${SELECT_ENTRY_COLS} FROM entries WHERE headword = ?`,
      [headword],
    ).map(rowToEntry);
  }

  /** Load one or more entries by ID. Returns an `Entry` for every id that
   *  matches; preserves insertion order of `ids` in the output. */
  entriesByIds(ids: readonly number[]): Entry[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.all(
      `SELECT ${SELECT_ENTRY_COLS} FROM entries WHERE entry_id IN (${placeholders})`,
      ids as unknown as unknown[],
    ).map(rowToEntry);
    const byId = new Map<number, Entry>(rows.map((e) => [e.entryId, e]));
    const out: Entry[] = [];
    for (const id of ids) {
      const e = byId.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  /** Entry IDs that share a normalized gloss. Used to surface merged
   *  peers on forward lookup and to resolve fuzzy near-matches back to
   *  entries for reverse lookup. */
  entryIdsForNormalizedGloss(normalized: string): number[] {
    const rows = this.all(
      "SELECT entry_id FROM gloss_groups WHERE normalized_gloss = ?",
      [normalized],
    );
    return rows.map((r) => r.entry_id as number);
  }

  // ---- Reverse lookup --------------------------------------------------

  /** Postings for a single gloss-word, ordered by tier ascending. The
   *  returned shape is the natural unit for the reverse-lookup pipeline
   *  — `(tier, entry_id, gloss_index)` plus the entry's normalized gloss
   *  for merging. */
  postingsForWord(
    word: string,
  ): Array<{
    tier: TierValue;
    entryId: number;
    glossIndex: number;
    normalizedGloss: string;
  }> {
    const rows = this.all(
      `SELECT p.tier AS tier,
              p.entry_id AS entry_id,
              p.gloss_index AS gloss_index,
              e.normalized_glosses AS normalized_glosses
         FROM postings p
         JOIN entries e ON e.entry_id = p.entry_id
        WHERE p.word = ?
        ORDER BY p.tier, p.entry_id, p.gloss_index`,
      [word],
    );
    const out: Array<{
      tier: TierValue;
      entryId: number;
      glossIndex: number;
      normalizedGloss: string;
    }> = [];
    for (const r of rows) {
      const norms = parseStringArray(r.normalized_glosses);
      const idx = r.gloss_index as number;
      const norm = norms[idx] ?? "";
      const tier = r.tier as number;
      // Only tiers known to the schema are surfaced; anything else is a
      // build-pipeline contract violation, but we guard rather than crash.
      if (tier !== Tier.EXACT && tier !== Tier.HEAD && tier !== Tier.INCIDENTAL) {
        continue;
      }
      out.push({
        tier: tier as TierValue,
        entryId: r.entry_id as number,
        glossIndex: idx,
        normalizedGloss: norm,
      });
    }
    return out;
  }
}
