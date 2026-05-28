import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  EngineProvider,
  SPLASH_ELEMENT_ID,
  SPLASH_FADE_SAFETY_MS,
  SPLASH_MIN_VISIBLE_MS,
  useEngineState,
  useSplashRemoval,
} from "./engine-context";
import { buildAppEngine } from "./__fixtures__/buildAppFixture";

describe("EngineProvider", () => {
  test("emits ready immediately when a pre-built engine is supplied", async () => {
    const engine = await buildAppEngine();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EngineProvider engine={engine}>{children}</EngineProvider>
    );
    const { result } = renderHook(() => useEngineState(), { wrapper });
    expect(result.current.status).toBe("ready");
    if (result.current.status === "ready") {
      expect(result.current.engine).toBe(engine);
    }
  });

  test("Consumer outside the provider throws", () => {
    expect(() => renderHook(() => useEngineState())).toThrow(/EngineProvider/);
  });

  test("renders children once ready", async () => {
    const engine = await buildAppEngine();
    render(
      <EngineProvider engine={engine}>
        <div>app body</div>
      </EngineProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("app body")).toBeInTheDocument();
    });
  });
});

describe("useSplashRemoval", () => {
  function mountSplash(shownAt = 0): HTMLElement {
    const el = document.createElement("div");
    el.id = SPLASH_ELEMENT_ID;
    el.dataset.shownAt = String(shownAt);
    document.body.appendChild(el);
    return el;
  }

  afterEach(() => {
    document.getElementById(SPLASH_ELEMENT_ID)?.remove();
    vi.useRealTimers();
  });

  test("is a no-op while loading", () => {
    vi.useFakeTimers();
    const el = mountSplash();
    renderHook(() => useSplashRemoval("loading"));
    vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS + SPLASH_FADE_SAFETY_MS);
    expect(document.getElementById(SPLASH_ELEMENT_ID)).toBe(el);
    expect(el.dataset.leaving).toBeUndefined();
  });

  test("marks data-leaving after the min visible window when ready", () => {
    vi.useFakeTimers();
    // shownAt = now → elapsed is 0 → full SPLASH_MIN_VISIBLE_MS delay.
    const el = mountSplash(performance.now());
    renderHook(() => useSplashRemoval("ready"));
    expect(el.dataset.leaving).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });
    expect(el.dataset.leaving).toBe("true");
    expect(document.getElementById(SPLASH_ELEMENT_ID)).toBe(el);
  });

  test("removes the node on transitionend after fading", () => {
    vi.useFakeTimers();
    const el = mountSplash(performance.now());
    renderHook(() => useSplashRemoval("ready"));
    act(() => {
      vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });
    act(() => {
      el.dispatchEvent(new Event("transitionend"));
    });
    expect(document.getElementById(SPLASH_ELEMENT_ID)).toBeNull();
  });

  test("falls back to the safety timer when transitionend never fires", () => {
    vi.useFakeTimers();
    const el = mountSplash(performance.now());
    renderHook(() => useSplashRemoval("error"));
    act(() => {
      vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });
    expect(el.isConnected).toBe(true);
    act(() => {
      vi.advanceTimersByTime(SPLASH_FADE_SAFETY_MS);
    });
    expect(document.getElementById(SPLASH_ELEMENT_ID)).toBeNull();
  });

  test("skips the min-visible delay when the splash has been on screen long enough", () => {
    vi.useFakeTimers();
    // shownAt far in the past → elapsed >> SPLASH_MIN_VISIBLE_MS, so the
    // start timer should fire on the next tick.
    const el = mountSplash(performance.now() - 10_000);
    renderHook(() => useSplashRemoval("ready"));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(el.dataset.leaving).toBe("true");
  });

  test("no-ops when the splash node is absent", () => {
    vi.useFakeTimers();
    expect(() => {
      renderHook(() => useSplashRemoval("ready"));
      vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS + SPLASH_FADE_SAFETY_MS);
    }).not.toThrow();
  });
});
