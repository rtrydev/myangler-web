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

/** Default URLs for the shipped data assets — the production fetch path.
 *  Pre-built engines bypass these entirely. The WASM URL points to the
 *  copy of `sql.js`'s `sql-wasm.wasm` synced into `public/` by
 *  `npm run sync:sqljs-wasm` — without an explicit URL sql.js falls
 *  back to a self-resolved path that does not work under Next.js. */
const DEFAULT_NGRAM_URL = "/data/ngram.json";
const DEFAULT_SQLITE_URL = "/data/dictionary.sqlite";
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
        sqlite: DEFAULT_SQLITE_URL,
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
  return (
    <EngineContext.Provider value={state}>{children}</EngineContext.Provider>
  );
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
