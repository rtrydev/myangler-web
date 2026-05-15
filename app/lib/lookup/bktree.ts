// In-memory BK-tree built from the `bktree/v1` flat JSON produced by
// `tools/data-pipeline/src/data_pipeline/bktree.py`.
//
// The pipeline ships nodes (`V`) and parent → child edges keyed by edit
// distance. We re-hydrate the same shape and walk it the standard way:
// at each node, compute `d = distance(probe, node.value)`; recurse into
// every child whose edge label lies in `[d - threshold, d + threshold]`.
//
// The tree is iterative-only (an explicit stack) — Burmese headword
// trees can exceed 1300 levels deep, which trips the JS recursion limit
// on some engines.

import type { BKTreeAsset } from "./types";

export const BKTREE_FORMAT_TAG = "bktree/v1";

export class BKTreeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BKTreeFormatError";
  }
}

/** Classic Levenshtein over any indexable, equality-comparable sequence.
 *  Used directly for the English tree (`string`) and wrapped for the
 *  Burmese tree (`readonly string[]`). Mirrors
 *  `data_pipeline.bktree.edit_distance`. */
export function editDistance<T>(
  a: ArrayLike<T>,
  b: ArrayLike<T>,
  eq: (x: T, y: T) => boolean = (x, y) => x === y,
): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= lb; j++) {
      const cost = eq(ai, b[j - 1]) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[lb];
}

export function syllableDistance(
  a: readonly string[],
  b: readonly string[],
): number {
  return editDistance(a, b);
}

interface InternalNode<V> {
  value: V;
  /** Child indices keyed by edit distance. */
  children: Map<number, number>;
}

/** Re-hydrated BK-tree. Parameterized by the value type so the same
 *  class backs both the English (`string`) and Burmese (`readonly
 *  string[]`) trees. */
export class BKTree<V> {
  private readonly nodes: InternalNode<V>[];
  private readonly rootIdx: number | null;
  private readonly distance: (a: V, b: V) => number;

  constructor(
    nodes: InternalNode<V>[],
    rootIdx: number | null,
    distance: (a: V, b: V) => number,
  ) {
    this.nodes = nodes;
    this.rootIdx = rootIdx;
    this.distance = distance;
  }

  get size(): number {
    return this.nodes.length;
  }

  /** Range query: all values within `threshold` edits of `probe`, sorted
   *  by distance ascending. Iterative — never recurses. */
  query(probe: V, threshold: number): Array<{ value: V; distance: number }> {
    if (this.rootIdx === null) return [];
    const out: Array<{ value: V; distance: number }> = [];
    const stack: number[] = [this.rootIdx];
    while (stack.length > 0) {
      const idx = stack.pop()!;
      const node = this.nodes[idx];
      const d = this.distance(probe, node.value);
      if (d <= threshold) out.push({ value: node.value, distance: d });
      const lo = d - threshold;
      const hi = d + threshold;
      for (const [edge, childIdx] of node.children) {
        if (edge >= lo && edge <= hi) stack.push(childIdx);
      }
    }
    out.sort((a, b) => a.distance - b.distance);
    return out;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate a `bktree/v1` payload and re-hydrate it with the supplied
 *  distance function. Throws `BKTreeFormatError` on any contract
 *  violation, including a missing/mismatched `format` field. */
export function parseBKTree<V>(
  payload: unknown,
  distance: (a: V, b: V) => number,
  coerceValue: (raw: unknown) => V,
): BKTree<V> {
  if (!isObject(payload)) {
    throw new BKTreeFormatError(
      `expected BK-tree asset to be a JSON object, got ${typeof payload}`,
    );
  }
  if (payload.format !== BKTREE_FORMAT_TAG) {
    throw new BKTreeFormatError(
      `expected BK-tree format ${JSON.stringify(BKTREE_FORMAT_TAG)}, ` +
        `got ${JSON.stringify(payload.format)}`,
    );
  }
  const rawNodes = payload.nodes;
  const rawEdges = payload.edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) {
    throw new BKTreeFormatError(
      "BK-tree asset is missing `nodes` and/or `edges` arrays",
    );
  }
  if (rawNodes.length !== rawEdges.length) {
    throw new BKTreeFormatError(
      `BK-tree asset has ${rawNodes.length} nodes but ${rawEdges.length} edge maps`,
    );
  }
  const rootRaw = payload.root;
  if (rootRaw !== null && typeof rootRaw !== "number") {
    throw new BKTreeFormatError(
      `BK-tree \`root\` must be a number or null, got ${typeof rootRaw}`,
    );
  }

  const nodes: InternalNode<V>[] = rawNodes.map((raw) => ({
    value: coerceValue(raw),
    children: new Map<number, number>(),
  }));

  for (let i = 0; i < rawEdges.length; i++) {
    const edgeMap = rawEdges[i];
    if (!isObject(edgeMap)) {
      throw new BKTreeFormatError(
        `BK-tree edges[${i}] is not an object`,
      );
    }
    for (const [distStr, childIdx] of Object.entries(edgeMap)) {
      if (typeof childIdx !== "number") {
        throw new BKTreeFormatError(
          `BK-tree edges[${i}][${JSON.stringify(distStr)}] is not a number`,
        );
      }
      const distNum = Number(distStr);
      if (!Number.isFinite(distNum)) {
        throw new BKTreeFormatError(
          `BK-tree edges[${i}] has non-numeric distance key ${JSON.stringify(distStr)}`,
        );
      }
      nodes[i].children.set(distNum, childIdx);
    }
  }

  return new BKTree<V>(nodes, rootRaw, distance);
}

/** Parse the `bktree-en.json` payload — node values are strings. */
export function parseEnglishBKTree(payload: unknown): BKTree<string> {
  const tree = parseBKTree<string>(
    payload,
    (a, b) => editDistance(a, b),
    (raw) => {
      if (typeof raw !== "string") {
        throw new BKTreeFormatError(
          `English BK-tree node value is not a string: ${JSON.stringify(raw)}`,
        );
      }
      return raw;
    },
  );
  return tree;
}

/** Parse the `bktree-my.json` payload — node values are arrays of syllable
 *  strings produced by the build-time syllable segmenter. */
export function parseBurmeseBKTree(
  payload: unknown,
): BKTree<readonly string[]> {
  return parseBKTree<readonly string[]>(
    payload,
    syllableDistance,
    (raw) => {
      if (!Array.isArray(raw)) {
        throw new BKTreeFormatError(
          `Burmese BK-tree node value is not an array: ${JSON.stringify(raw)}`,
        );
      }
      const syls: string[] = [];
      for (const s of raw) {
        if (typeof s !== "string") {
          throw new BKTreeFormatError(
            `Burmese BK-tree node value contains non-string element: ${JSON.stringify(s)}`,
          );
        }
        syls.push(s);
      }
      return syls;
    },
  );
}

/** Re-export so consumers can validate a raw `BKTreeAsset` typed payload
 *  without depending on `parseBKTree`. */
export function isBKTreeV1Payload(payload: unknown): payload is BKTreeAsset<unknown> {
  return (
    isObject(payload) &&
    payload.format === BKTREE_FORMAT_TAG &&
    Array.isArray(payload.nodes) &&
    Array.isArray(payload.edges)
  );
}
