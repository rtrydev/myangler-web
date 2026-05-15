#!/usr/bin/env node
// Sync the lookup module's static assets from the data-pipeline output
// to the PWA's `public/data/` directory. Run after `data-pipeline all`
// (or the relevant individual subcommands) to refresh what the frontend
// ships.
//
// Usage:
//   node app/lib/lookup/scripts/sync-assets.mjs
//   npm run sync:lookup-assets
//
// Like `sync:segmenter-asset`, this script is a thin file copy — the
// pipeline output stays the single source of truth. `public/data/` is
// git-ignored so the synced copies never drift.

import { mkdir, copyFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

const ASSETS = [
  "dictionary.sqlite",
  "bktree-en.json",
  "bktree-my.json",
];

await mkdir(resolve(REPO_ROOT, "public", "data"), { recursive: true });

let missing = 0;
for (const name of ASSETS) {
  const source = resolve(REPO_ROOT, "tools/data-pipeline/build", name);
  const target = resolve(REPO_ROOT, "public/data", name);
  if (!existsSync(source)) {
    console.error(
      `Missing pipeline output: ${source}\n` +
        "Run `data-pipeline all` (or the relevant subcommand) first — " +
        "see tools/data-pipeline/README.md.",
    );
    missing += 1;
    continue;
  }
  await copyFile(source, target);
  const { size } = await stat(target);
  console.log(`copied ${name} (${size.toLocaleString()} bytes) -> ${target}`);
}

if (missing > 0) process.exit(1);
