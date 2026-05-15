import { describe, expect, test, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  clearAllStorage,
  FAVORITES_KEY,
  HISTORY_KEY,
  HISTORY_MAX,
  useFavorites,
  useHistory,
} from "./storage";

beforeEach(() => {
  clearAllStorage();
});

describe("useHistory", () => {
  test("starts empty", () => {
    const { result } = renderHook(() => useHistory());
    expect(result.current.items).toEqual([]);
  });

  test("record prepends new items in newest-first order", () => {
    const { result } = renderHook(() => useHistory());
    act(() => result.current.record({ query: "water", kind: "latin" }));
    act(() => result.current.record({ query: "ရေ", kind: "burmese" }));
    expect(result.current.items.map(i => i.query)).toEqual(["ရေ", "water"]);
  });

  test("record dedupes by query — repeating an identical query promotes it", () => {
    const { result } = renderHook(() => useHistory());
    act(() => result.current.record({ query: "water", kind: "latin", at: 100 }));
    act(() => result.current.record({ query: "ရေ", kind: "burmese", at: 200 }));
    act(() => result.current.record({ query: "water", kind: "latin", at: 300 }));
    expect(result.current.items.map(i => i.query)).toEqual(["water", "ရေ"]);
    expect(result.current.items[0].at).toBe(300);
  });

  test("cap at HISTORY_MAX items, dropping the oldest", () => {
    const { result } = renderHook(() => useHistory());
    act(() => {
      for (let i = 0; i < HISTORY_MAX + 5; i++) {
        result.current.record({ query: `q${i}`, kind: "latin", at: i });
      }
    });
    expect(result.current.items.length).toBe(HISTORY_MAX);
    expect(result.current.items[0].query).toBe(`q${HISTORY_MAX + 4}`);
  });

  test("clear empties the list and writes through to storage", () => {
    const { result } = renderHook(() => useHistory());
    act(() => result.current.record({ query: "water", kind: "latin" }));
    act(() => result.current.clear());
    expect(result.current.items).toEqual([]);
    expect(window.localStorage.getItem(HISTORY_KEY)).toBe("[]");
  });

  test("hydrates from localStorage on mount", () => {
    window.localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([{ query: "water", kind: "latin", at: 1 }]),
    );
    const { result } = renderHook(() => useHistory());
    expect(result.current.items).toEqual([
      { query: "water", kind: "latin", at: 1 },
    ]);
  });
});

describe("useFavorites", () => {
  const sample = {
    entryId: 7,
    headword: "ရေ",
    pos: "noun",
    glosses: ["water"],
    ipa: null,
    at: 0,
  };

  test("starts empty", () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.items).toEqual([]);
    expect(result.current.isSaved(7)).toBe(false);
  });

  test("toggle adds new entries and removes existing ones", () => {
    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggle(sample));
    expect(result.current.isSaved(7)).toBe(true);
    act(() => result.current.toggle(sample));
    expect(result.current.isSaved(7)).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  test("entries are stored newest-first", () => {
    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggle({ ...sample, entryId: 1 }));
    act(() => result.current.toggle({ ...sample, entryId: 2 }));
    expect(result.current.items.map(i => i.entryId)).toEqual([2, 1]);
  });

  test("remove deletes by id", () => {
    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggle({ ...sample, entryId: 1 }));
    act(() => result.current.toggle({ ...sample, entryId: 2 }));
    act(() => result.current.remove(1));
    expect(result.current.items.map(i => i.entryId)).toEqual([2]);
  });

  test("clear empties the list", () => {
    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggle(sample));
    act(() => result.current.clear());
    expect(result.current.items).toEqual([]);
  });

  test("hydrates from localStorage on mount", () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([sample]));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.isSaved(7)).toBe(true);
  });
});
