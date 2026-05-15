// Asset loader for the dictionary-lookup module.
//
// Loads the SQLite database (via sql.js) and both BK-tree JSON assets.
// Both URL-based browser loading and pre-fetched-bytes loading (for tests
// / Node) are supported via the `AssetSources` discriminated union.

import {
  BKTree,
  BKTreeFormatError,
  parseBurmeseBKTree,
  parseEnglishBKTree,
} from "./bktree";
import { DictionaryDB, getSqlJs, setSqlJsWasm } from "./sqlite";
import type { AssetSources, LookupConfig } from "./types";
import { DEFAULT_CONFIG } from "./types";

export { BKTreeFormatError };

/** Bundle of loaded assets + active config. Forward / reverse / search
 *  functions take this as their first argument. */
export interface DictionaryModel {
  readonly db: DictionaryDB;
  readonly bktreeEn: BKTree<string>;
  readonly bktreeMy: BKTree<readonly string[]>;
  readonly config: LookupConfig;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `failed to fetch ${url}: ${res.status} ${res.statusText}`,
    );
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `failed to fetch ${url}: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as unknown;
}

/** Idempotency cache keyed on the asset bundle identity. A second call
 *  with the *same* `AssetSources` reuses the loaded model; callers that
 *  want a fresh load should pass a fresh sources object. */
const modelCache = new WeakMap<object, Promise<DictionaryModel>>();

/** Load all three assets and return a queryable model. Validates every
 *  format-tagged asset's `format` field and throws on mismatch.
 *
 *  `config` is shallow-merged onto `DEFAULT_CONFIG`. Returning a raw
 *  `Promise` (rather than declaring `async`) preserves promise identity
 *  for repeat calls against the same `sources` — the cache test relies
 *  on that. */
export function loadDictionary(
  sources: AssetSources,
  config: Partial<LookupConfig> = {},
): Promise<DictionaryModel> {
  const cached = modelCache.get(sources);
  if (cached) return cached;

  const promise = (async (): Promise<DictionaryModel> => {
    let sqliteBytes: Uint8Array;
    let bktreeEnPayload: unknown;
    let bktreeMyPayload: unknown;
    let sqlJsReady: Promise<unknown>;

    if (sources.kind === "urls") {
      sqlJsReady = getSqlJs(sources.wasmUrl);
      const [bytes, enJson, myJson] = await Promise.all([
        fetchBytes(sources.sqlite),
        fetchJson(sources.bktreeEn),
        fetchJson(sources.bktreeMy),
      ]);
      sqliteBytes = bytes;
      bktreeEnPayload = enJson;
      bktreeMyPayload = myJson;
    } else {
      sqlJsReady = setSqlJsWasm(sources.wasm);
      sqliteBytes = sources.sqlite;
      bktreeEnPayload = sources.bktreeEn;
      bktreeMyPayload = sources.bktreeMy;
    }

    const SQL = (await sqlJsReady) as Awaited<ReturnType<typeof getSqlJs>>;
    const db = new SQL.Database(sqliteBytes);
    const bktreeEn = parseEnglishBKTree(bktreeEnPayload);
    const bktreeMy = parseBurmeseBKTree(bktreeMyPayload);

    return {
      db: new DictionaryDB(db),
      bktreeEn,
      bktreeMy,
      config: { ...DEFAULT_CONFIG, ...config },
    };
  })();

  modelCache.set(sources, promise);
  return promise;
}
