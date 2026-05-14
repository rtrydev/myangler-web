import { describe, expect, test, vi, afterEach } from "vitest";
import tinyAsset from "./__fixtures__/tiny-ngram.json";
import {
  NGRAM_FORMAT_TAG,
  NgramFormatError,
  loadNgramModel,
  parseNgramModel,
} from "./loader";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseNgramModel", () => {
  test("parses a valid myword-ngram/v1 asset", () => {
    const model = parseNgramModel(tinyAsset);
    expect(model.unigram.get("မြန်မာ")).toBe(100);
    expect(model.bigram.get("မြန်မာ")?.get("စကား")).toBe(7);
    expect(model.unigramCount).toBe(4);
    expect(model.unigramTotal).toBe(250);
    expect(model.bigramCount).toBe(1);
    expect(model.bigramTotal).toBe(7);
    expect(model.N).toBe(102490);
  });

  test("rejects an asset with the wrong `format` field", () => {
    const bad = { ...tinyAsset, format: "myword-ngram/v0" };
    expect(() => parseNgramModel(bad)).toThrow(NgramFormatError);
    expect(() => parseNgramModel(bad)).toThrow(/myword-ngram\/v1/);
  });

  test("rejects an asset missing the `format` field", () => {
    const { format: _format, ...bad } = tinyAsset;
    void _format;
    expect(() => parseNgramModel(bad)).toThrow(NgramFormatError);
  });

  test("rejects a non-object payload", () => {
    expect(() => parseNgramModel(42)).toThrow(NgramFormatError);
    expect(() => parseNgramModel(null)).toThrow(NgramFormatError);
    expect(() => parseNgramModel([1, 2])).toThrow(NgramFormatError);
  });

  test("rejects an asset whose unigram map has non-numeric values", () => {
    const bad = { ...tinyAsset, unigram: { foo: "1" as unknown as number } };
    expect(() => parseNgramModel(bad)).toThrow(NgramFormatError);
  });

  test("rejects an asset whose bigram inner map has non-numeric values", () => {
    const bad = {
      ...tinyAsset,
      bigram: { foo: { bar: "1" as unknown as number } },
    };
    expect(() => parseNgramModel(bad)).toThrow(NgramFormatError);
  });
});

describe("loadNgramModel", () => {
  test("fetches and parses an asset URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => tinyAsset,
    });
    vi.stubGlobal("fetch", fetchMock);

    const model = await loadNgramModel("/data/ngram.json");
    expect(fetchMock).toHaveBeenCalledWith("/data/ngram.json");
    expect(model.unigram.get("စကား")).toBe(50);
  });

  test("throws when the fetch response is not OK", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadNgramModel("/missing")).rejects.toThrow(/404/);
  });

  test("throws NgramFormatError when the fetched payload is malformed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ format: "something/else" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadNgramModel("/bad")).rejects.toBeInstanceOf(
      NgramFormatError,
    );
  });
});

describe("loader constants", () => {
  test("exposes the format tag constant matching the asset", () => {
    expect(NGRAM_FORMAT_TAG).toBe(tinyAsset.format);
  });
});
