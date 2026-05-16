import { describe, expect, test, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  applyPreferences,
  clearStoredPreferences,
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  readPreferences,
  usePreferences,
} from "./preferences";

beforeEach(() => {
  clearStoredPreferences();
});

describe("readPreferences", () => {
  test("returns the defaults when no key is set", () => {
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  test("reads a previously persisted value", () => {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ accent: "jade", dark: true }),
    );
    expect(readPreferences()).toEqual({ accent: "jade", dark: true });
  });

  test("falls back to defaults for invalid JSON", () => {
    window.localStorage.setItem(PREFERENCES_KEY, "{not json");
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  test("falls back per-field when fields are missing or malformed", () => {
    // unknown accent string + non-boolean dark → both defaulted
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ accent: "neon-pink", dark: "yes" }),
    );
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  test("merges partial saves — only `dark` set keeps the default accent", () => {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ dark: true }),
    );
    expect(readPreferences()).toEqual({
      accent: DEFAULT_PREFERENCES.accent,
      dark: true,
    });
  });
});

describe("applyPreferences", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.accent;
  });

  test("writes data-accent and adds .dark when dark is true", () => {
    applyPreferences({ accent: "jade", dark: true });
    expect(document.documentElement.dataset.accent).toBe("jade");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("removes .dark when dark is false", () => {
    document.documentElement.classList.add("dark");
    applyPreferences({ accent: "ruby", dark: false });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.accent).toBe("ruby");
  });
});

describe("usePreferences", () => {
  test("starts at DEFAULT_PREFERENCES when storage is empty", () => {
    const { result } = renderHook(() => usePreferences());
    expect(result.current.accent).toBe(DEFAULT_PREFERENCES.accent);
    expect(result.current.dark).toBe(DEFAULT_PREFERENCES.dark);
  });

  test("hydrates the initial state from previously persisted prefs", () => {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ accent: "indigo", dark: true }),
    );
    const { result } = renderHook(() => usePreferences());
    expect(result.current.accent).toBe("indigo");
    expect(result.current.dark).toBe(true);
  });

  test("setAccent persists to localStorage and applies to <html>", () => {
    const { result } = renderHook(() => usePreferences());
    act(() => result.current.setAccent("jade"));
    expect(result.current.accent).toBe("jade");
    expect(document.documentElement.dataset.accent).toBe("jade");
    expect(
      JSON.parse(window.localStorage.getItem(PREFERENCES_KEY)!),
    ).toEqual({ accent: "jade", dark: false });
  });

  test("setDark persists to localStorage and toggles the .dark class", () => {
    const { result } = renderHook(() => usePreferences());
    act(() => result.current.setDark(true));
    expect(result.current.dark).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(
      JSON.parse(window.localStorage.getItem(PREFERENCES_KEY)!),
    ).toEqual({ accent: DEFAULT_PREFERENCES.accent, dark: true });

    act(() => result.current.setDark(false));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("setting one field preserves the other in storage", () => {
    const { result } = renderHook(() => usePreferences());
    act(() => result.current.setAccent("gold"));
    act(() => result.current.setDark(true));
    expect(
      JSON.parse(window.localStorage.getItem(PREFERENCES_KEY)!),
    ).toEqual({ accent: "gold", dark: true });
  });

  test("a second mount surfaces the prefs that were persisted by the first", () => {
    // Simulates the production reload path: mount, change prefs, unmount,
    // mount again — the second mount must read the saved values.
    const first = renderHook(() => usePreferences());
    act(() => first.result.current.setAccent("indigo"));
    act(() => first.result.current.setDark(true));
    first.unmount();

    const second = renderHook(() => usePreferences());
    expect(second.result.current.accent).toBe("indigo");
    expect(second.result.current.dark).toBe(true);
  });
});

describe("clearStoredPreferences", () => {
  test("removes the localStorage entry and resets <html>", () => {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ accent: "jade", dark: true }),
    );
    applyPreferences({ accent: "jade", dark: true });

    clearStoredPreferences();

    expect(window.localStorage.getItem(PREFERENCES_KEY)).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.accent).toBeUndefined();
  });
});
