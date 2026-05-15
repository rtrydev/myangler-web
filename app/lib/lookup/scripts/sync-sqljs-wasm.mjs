#!/usr/bin/env node
// Sync the sql.js WebAssembly binary from `node_modules/sql.js/dist/`
// into `public/` so Next.js can serve it as `/sql-wasm.wasm`. The
// `EngineProvider` points sql.js at that URL via the `wasmUrl` option;
// without this synced copy, sql.js falls back to a self-resolved path
// that Next.js does not serve and the dictionary fails to load with
// "Response has unsupported MIME type 'text/html'".
//
// Usage:
//   node app/lib/lookup/scripts/sync-sqljs-wasm.mjs
//   npm run sync:sqljs-wasm

import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

const source = resolve(REPO_ROOT, "node_modules/sql.js/dist/sql-wasm.wasm");
const target = resolve(REPO_ROOT, "public/sql-wasm.wasm");

if (!existsSync(source)) {
  console.error(
    `Missing sql.js binary: ${source}\n` +
      "Run `npm install` first — `sql.js` ships its WASM in `dist/`.",
  );
  process.exit(1);
}

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
const { size } = await stat(target);
console.log(`copied sql-wasm.wasm (${size.toLocaleString()} bytes) -> ${target}`);
