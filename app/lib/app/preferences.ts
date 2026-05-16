"use client";

// LocalStorage-backed user preferences: theme (light/dark) and accent.
//
// Shape mirrors `storage.ts` — `useSyncExternalStore` for cross-tab
// reactivity, a parsed-snapshot cache so the hook returns stable
// references across renders, and a same-tab pub-sub for in-app updates.
//
// The DOM side (`data-accent` attribute + `.dark` class on `<html>`)
// is owned in two places that must stay in lockstep:
//
//   1. The pre-hydration inline script in `app/layout.tsx` runs before
//      paint to apply persisted prefs and avoid a FOUC on reload.
//   2. `applyPreferences()` below is called from the in-app setters and
//      from the cross-tab storage listener so the DOM tracks every
//      subsequent change.
//
// `usePreferences()` deliberately does NOT include a `useEffect` mirror
// of `prefs → DOM`. That would re-fire on the first commit with the
// SSR/default snapshot and clobber the values the inline script applied,
// causing a visible flash before `useSyncExternalStore` re-syncs. The
// setters and the storage listener cover all real DOM-update paths.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Accent } from "@/app/components/ThemeToggle";

export const PREFERENCES_KEY = "myangler.preferences.v1";

export interface Preferences {
  accent: Accent;
  dark: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  accent: "ruby",
  dark: false,
};

const ACCENTS: readonly Accent[] = ["ruby", "gold", "jade", "indigo"];

function isAccent(value: unknown): value is Accent {
  return typeof value === "string" && (ACCENTS as readonly string[]).includes(value);
}

/** Parse the persisted prefs from localStorage, with a defaulting pass
 *  on each field. Any malformed input collapses to `DEFAULT_PREFERENCES`
 *  so a corrupted entry can never crash the app at startup. */
export function readPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PREFERENCES_KEY);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (raw === null) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULT_PREFERENCES;
    const candidate = parsed as Record<string, unknown>;
    return {
      accent: isAccent(candidate.accent)
        ? candidate.accent
        : DEFAULT_PREFERENCES.accent,
      dark:
        typeof candidate.dark === "boolean"
          ? candidate.dark
          : DEFAULT_PREFERENCES.dark,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Write the prefs to localStorage *and* refresh the local snapshot
 *  cache so the next `useSyncExternalStore` read returns a referentially
 *  stable object (required to avoid infinite re-render loops). */
function writePreferences(prefs: Preferences): void {
  if (typeof window === "undefined") return;
  let raw: string;
  try {
    raw = JSON.stringify(prefs);
  } catch {
    return;
  }
  try {
    window.localStorage.setItem(PREFERENCES_KEY, raw);
  } catch {
    // Quota / disabled storage — keep the in-memory snapshot in sync
    // anyway so this session's UI reflects the change.
  }
  snapshotRaw = raw;
  snapshot = prefs;
}

/** Apply prefs directly to `<html>`. The pre-hydration inline script in
 *  `app/layout.tsx` inlines the same logic — keep them in sync if either
 *  attribute name changes. */
export function applyPreferences(prefs: Preferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.accent = prefs.accent;
  if (prefs.dark) root.classList.add("dark");
  else root.classList.remove("dark");
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyPreferences(): void {
  for (const fn of listeners) fn();
}

function subscribePreferences(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === PREFERENCES_KEY) listener();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

// Snapshot cache: stable identity required for useSyncExternalStore.
// We compare the raw localStorage string; only when it changes do we
// re-parse and produce a fresh Preferences object.
let snapshot: Preferences | null = null;
let snapshotRaw: string | null | undefined = undefined;

function getSnapshot(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PREFERENCES_KEY);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (snapshot !== null && snapshotRaw === raw) return snapshot;
  snapshotRaw = raw;
  snapshot = readPreferences();
  return snapshot;
}

function getServerSnapshot(): Preferences {
  return DEFAULT_PREFERENCES;
}

export interface PreferencesStore {
  accent: Accent;
  dark: boolean;
  setAccent: (accent: Accent) => void;
  setDark: (dark: boolean) => void;
}

/** React binding for the preferences store. Reads via
 *  `useSyncExternalStore` (SSR-safe via `getServerSnapshot`), exposes
 *  setters that persist + apply to `<html>` in one call, and subscribes
 *  to cross-tab `storage` events to mirror external changes to the DOM. */
export function usePreferences(): PreferencesStore {
  const prefs = useSyncExternalStore(
    subscribePreferences,
    getSnapshot,
    getServerSnapshot,
  );

  // Cross-tab DOM sync. Same-tab updates apply inside the setters below,
  // so the DOM is correct the moment the click handler returns.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === PREFERENCES_KEY) applyPreferences(readPreferences());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAccent = useCallback((accent: Accent) => {
    const next: Preferences = { ...readPreferences(), accent };
    writePreferences(next);
    applyPreferences(next);
    notifyPreferences();
  }, []);

  const setDark = useCallback((dark: boolean) => {
    const next: Preferences = { ...readPreferences(), dark };
    writePreferences(next);
    applyPreferences(next);
    notifyPreferences();
  }, []);

  return { accent: prefs.accent, dark: prefs.dark, setAccent, setDark };
}

/** Test-only helper to wipe the persisted prefs and reset the in-memory
 *  snapshot cache, mirroring `clearAllStorage` for the history /
 *  favorites stores. Also resets `<html>` so leftover `data-accent` /
 *  `.dark` from a prior test doesn't leak into the next one. */
export function clearStoredPreferences(): void {
  snapshot = null;
  snapshotRaw = undefined;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(PREFERENCES_KEY);
    } catch {}
  }
  if (typeof document !== "undefined") {
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.accent;
  }
}
