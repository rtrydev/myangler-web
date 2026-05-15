import { describe, expect, test } from "vitest";
import {
  BKTREE_FORMAT_TAG,
  BKTreeFormatError,
  editDistance,
  parseBurmeseBKTree,
  parseEnglishBKTree,
  syllableDistance,
} from "./bktree";

function makeEnPayload(words: string[]): unknown {
  // Trivial flat encoding: root + chain. The serializer in the data
  // pipeline produces a tree shape; the loader only needs *some* valid
  // shape, so we build a flat structure where every node hangs off the
  // root at its real edit distance to the root.
  if (words.length === 0) {
    return {
      format: "bktree/v1",
      size: 0,
      root: null,
      nodes: [],
      edges: [],
    };
  }
  const root = words[0];
  const nodes: string[] = [root];
  const edges: Record<string, number>[] = [{}];
  for (let i = 1; i < words.length; i++) {
    const d = editDistance(root, words[i]);
    if (d === 0) continue;
    if (!(d in edges[0])) {
      const idx = nodes.length;
      nodes.push(words[i]);
      edges.push({});
      edges[0][String(d)] = idx;
    } else {
      // Hang on a deeper level via its distance to the existing sibling
      // so we still produce a valid BK-tree (avoid clobbering edges).
      const sibIdx = edges[0][String(d)];
      const d2 = editDistance(nodes[sibIdx], words[i]);
      if (d2 === 0) continue;
      const idx = nodes.length;
      nodes.push(words[i]);
      edges.push({});
      edges[sibIdx][String(d2)] = idx;
    }
  }
  return {
    format: "bktree/v1",
    size: nodes.length,
    root: 0,
    nodes,
    edges,
  };
}

describe("editDistance", () => {
  test("matches classic Levenshtein", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("go", "go")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
  });

  test("works on arrays of syllables", () => {
    expect(syllableDistance(["a", "b"], ["a", "b", "c"])).toBe(1);
    expect(syllableDistance(["a", "b"], ["a", "b"])).toBe(0);
    expect(syllableDistance(["a", "b"], ["c", "d"])).toBe(2);
  });
});

describe("parseEnglishBKTree", () => {
  test("rejects a payload without the bktree/v1 format tag", () => {
    expect(() => parseEnglishBKTree({})).toThrow(BKTreeFormatError);
    expect(() => parseEnglishBKTree({ format: "bktree/v2" })).toThrow(
      /bktree\/v1/,
    );
  });

  test("rejects non-object payloads", () => {
    expect(() => parseEnglishBKTree(42)).toThrow(BKTreeFormatError);
    expect(() => parseEnglishBKTree([1, 2])).toThrow(BKTreeFormatError);
    expect(() => parseEnglishBKTree(null)).toThrow(BKTreeFormatError);
  });

  test("rejects a payload whose node value is not a string", () => {
    expect(() =>
      parseEnglishBKTree({
        format: "bktree/v1",
        size: 1,
        root: 0,
        nodes: [42],
        edges: [{}],
      }),
    ).toThrow(BKTreeFormatError);
  });

  test("rehydrates and answers range queries", () => {
    const payload = makeEnPayload(["go", "do", "to", "got", "gone", "house"]);
    const tree = parseEnglishBKTree(payload);
    const hits = tree
      .query("go", 1)
      .map((h) => h.value)
      .sort();
    expect(hits).toEqual(["do", "go", "got", "to"]);
  });

  test("returns [] from an empty tree", () => {
    const payload = makeEnPayload([]);
    const tree = parseEnglishBKTree(payload);
    expect(tree.query("anything", 5)).toEqual([]);
  });

  test("exposes the format tag constant", () => {
    expect(BKTREE_FORMAT_TAG).toBe("bktree/v1");
  });
});

describe("parseBurmeseBKTree", () => {
  test("rejects payloads whose node values aren't arrays", () => {
    expect(() =>
      parseBurmeseBKTree({
        format: "bktree/v1",
        size: 1,
        root: 0,
        nodes: ["not-an-array"],
        edges: [{}],
      }),
    ).toThrow(BKTreeFormatError);
  });

  test("rejects arrays containing non-strings", () => {
    expect(() =>
      parseBurmeseBKTree({
        format: "bktree/v1",
        size: 1,
        root: 0,
        nodes: [[1, 2]],
        edges: [{}],
      }),
    ).toThrow(BKTreeFormatError);
  });

  test("rehydrates a syllable BK-tree", () => {
    const payload = {
      format: "bktree/v1",
      size: 2,
      root: 0,
      nodes: [
        ["ka", "la"],
        ["ka", "ma"],
      ],
      // distance(["ka","la"], ["ka","ma"]) = 1
      edges: [{ "1": 1 }, {}],
    };
    const tree = parseBurmeseBKTree(payload);
    const hits = tree.query(["ka", "la"], 1).map((h) => h.value.join("|"));
    expect(hits.sort()).toEqual(["ka|la", "ka|ma"]);
  });
});
