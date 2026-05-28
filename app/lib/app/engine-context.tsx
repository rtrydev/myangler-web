"use client";

// React context wrapping the framework-agnostic `SearchEngine` from
// `@/app/lib/search`. The provider owns the async load so consumers can
// branch on the discriminated `EngineState` (`loading` / `ready` /
// `error`) without each view re-implementing the same boilerplate.
//
// Tests inject a pre-built engine via the `engine` prop — the provider
// then emits `ready` directly without going through the loader.

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { load, type SearchEngine } from "@/app/lib/search";
import { DICTIONARY_SQLITE_URL } from "@/app/lib/lookup/dataAssets.generated";

/** Default URLs for the shipped data assets — the production fetch path.
 *  Pre-built engines bypass these entirely. The WASM URL points to the
 *  copy of `sql.js`'s `sql-wasm.wasm` synced into `public/` by
 *  `npm run sync:sqljs-wasm` — without an explicit URL sql.js falls
 *  back to a self-resolved path that does not work under Next.js.
 *
 *  The SQLite URL is **fingerprinted** with the data-pipeline's build
 *  stamp (see `dataAssets.generated.ts`). That's the cache-busting
 *  mechanism: a new build moves the version stamp, the URL moves with
 *  it, returning browsers ignore whatever they had cached for the old
 *  URL. Long-immutable HTTP cache on the fingerprinted URL is safe and
 *  optimal — the bytes never change for a given URL. */
const DEFAULT_NGRAM_URL = "/data/ngram.json";
const DEFAULT_BKTREE_EN_URL = "/data/bktree-en.json";
const DEFAULT_BKTREE_MY_URL = "/data/bktree-my.json";
const DEFAULT_WASM_URL = "/sql-wasm.wasm";

export type EngineState =
  | { status: "loading" }
  | { status: "ready"; engine: SearchEngine }
  | { status: "error"; error: Error };

const EngineContext = createContext<EngineState | null>(null);

type EngineProviderProps = {
  /** Pre-built engine. When supplied the provider yields `ready`
   *  synchronously and skips the network fetch. Used by tests. */
  engine?: SearchEngine;
  children: ReactNode;
};

export function EngineProvider({ engine, children }: EngineProviderProps) {
  // The pre-built path is fully synchronous — no effect, no loader. This
  // makes test setups deterministic and trims one render from the happy
  // path for tests.
  if (engine) {
    return (
      <EngineContext.Provider value={{ status: "ready", engine }}>
        {children}
      </EngineContext.Provider>
    );
  }
  return <EngineLoader>{children}</EngineLoader>;
}

function EngineLoader({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EngineState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    load({
      kind: "sources",
      ngramUrl: DEFAULT_NGRAM_URL,
      dictionarySources: {
        kind: "urls",
        sqlite: DICTIONARY_SQLITE_URL,
        bktreeEn: DEFAULT_BKTREE_EN_URL,
        bktreeMy: DEFAULT_BKTREE_MY_URL,
        wasmUrl: DEFAULT_WASM_URL,
      },
    })
      .then(loaded => {
        if (cancelled) return;
        setState({ status: "ready", engine: loaded });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useSplashRemoval(state.status);
  return (
    <EngineContext.Provider value={state}>{children}</EngineContext.Provider>
  );
}

/** DOM id of the pre-app splash node rendered by `app/layout.tsx`. */
export const SPLASH_ELEMENT_ID = "myangler-splash";

/** Minimum on-screen time before the splash starts fading. Returning
 *  visitors hitting a warm HTTP cache can resolve the engine in <50 ms;
 *  without this, the spinner pops in and out faster than the eye can
 *  parse and reads as a glitch instead of a deliberate splash. */
export const SPLASH_MIN_VISIBLE_MS = 150;

/** Hard upper bound on the fade-out. `transitionend` is the primary
 *  removal signal; this fires as a fallback if the event is suppressed
 *  (e.g. tab in background, `prefers-reduced-motion`, transition
 *  cancelled by `display:none` further up the tree). */
export const SPLASH_FADE_SAFETY_MS = 600;

/** Fades and removes the pre-app splash overlay rendered by
 *  `app/layout.tsx` once the engine reaches a terminal status. No-op
 *  while loading, and no-op if the splash node is already gone (the
 *  hook can run after re-renders without double-firing). */
export function useSplashRemoval(status: EngineState["status"]): void {
  useEffect(() => {
    if (status === "loading") return;
    if (typeof document === "undefined") return;
    const el = document.getElementById(SPLASH_ELEMENT_ID);
    if (!el) return;
    const shownAt = Number(el.dataset.shownAt ?? "0");
    const elapsed = performance.now() - shownAt;
    const delay = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      el.remove();
    };
    const startTimer = window.setTimeout(() => {
      el.dataset.leaving = "true";
      el.addEventListener("transitionend", remove, { once: true });
      window.setTimeout(remove, SPLASH_FADE_SAFETY_MS);
    }, delay);
    return () => {
      window.clearTimeout(startTimer);
    };
  }, [status]);
}

/** Consume the engine context. Throws when called outside the provider —
 *  intentional, since every screen relies on having an engine state. */
export function useEngineState(): EngineState {
  const ctx = useContext(EngineContext);
  if (!ctx) {
    throw new Error("useEngineState must be called inside <EngineProvider>");
  }
  return ctx;
}
