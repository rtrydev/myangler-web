#!/usr/bin/env node
// Sync the myWord n-gram asset from the data-pipeline output to the
// PWA's `public/data/ngram.json`. Run after `data-pipeline convert-ngram`
// (or `data-pipeline all`) to refresh what the frontend ships.
//
// Usage:
//   node app/lib/segmenter/scripts/sync-asset.mjs
//   npm run sync:segmenter-asset
//
// The script copies — it does *not* maintain a hand-edited duplicate.
// `public/data/` is git-ignored precisely so the pipeline output stays
// the single source of truth.

import { mkdir, copyFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

const SOURCE = resolve(REPO_ROOT, "tools/data-pipeline/build/ngram.json");
const TARGET = resolve(REPO_ROOT, "public/data/ngram.json");

if (!existsSync(SOURCE)) {
  console.error(
    `Missing pipeline output: ${SOURCE}\n` +
      "Run `data-pipeline convert-ngram` (or `data-pipeline all`) first " +
      "— see tools/data-pipeline/README.md.",
  );
  process.exit(1);
}

await mkdir(dirname(TARGET), { recursive: true });
await copyFile(SOURCE, TARGET);
const { size } = await stat(TARGET);
console.log(`copied ngram.json (${size.toLocaleString()} bytes) -> ${TARGET}`);
