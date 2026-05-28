import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  detectPlatform,
  isMobileDevice,
  isStandaloneDisplay,
  useInstallPrompt,
} from "./install-prompt";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const IPAD_LEGACY_UA =
  "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1";
const IPADOS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1";

// jsdom doesn't ship `window.matchMedia`, so each test that touches it
// installs a stub. This helper builds a MediaQueryList-shaped object
// whose `matches` is whatever the test wants for a specific query.
function stubMatchMedia(matcher: (query: string) => boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matcher(query),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

function clearMatchMedia(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).matchMedia;
}

describe("detectPlatform", () => {
  test("iPhone UA → ios", () => {
    expect(detectPlatform(IPHONE_UA)).toBe("ios");
  });
  test("legacy iPad UA → ios", () => {
    expect(detectPlatform(IPAD_LEGACY_UA)).toBe("ios");
  });
  test("Android UA → android", () => {
    expect(detectPlatform(ANDROID_UA)).toBe("android");
  });
  test("desktop UA → other", () => {
    expect(detectPlatform(DESKTOP_UA)).toBe("other");
  });
  test("modern iPadOS spoofing as Mac → other from UA alone", () => {
    // The touch-point fallback inside `isMobileDevice` is what catches
    // this case; `detectPlatform` is intentionally narrow.
    expect(detectPlatform(IPADOS_UA)).toBe("other");
  });
});

describe("isMobileDevice", () => {
  test.each([
    ["iPhone", IPHONE_UA, 5, true],
    ["Android", ANDROID_UA, 5, true],
    ["Desktop Mac", DESKTOP_UA, 0, false],
    ["iPadOS spoofing Mac with touch", IPADOS_UA, 5, true],
    ["Desktop Mac (no touch)", DESKTOP_UA, 0, false],
    ["Mac with single 'touch' point (trackpad)", DESKTOP_UA, 1, false],
  ])("%s", (_label, ua, touch, expected) => {
    expect(isMobileDevice(ua, touch)).toBe(expected);
  });
});

describe("isStandaloneDisplay", () => {
  afterEach(() => {
    clearMatchMedia();
    const nav = window.navigator as Navigator & { standalone?: boolean };
    delete nav.standalone;
  });

  test("returns true when display-mode standalone matches", () => {
    stubMatchMedia(q => q === "(display-mode: standalone)");
    expect(isStandaloneDisplay()).toBe(true);
  });

  test("returns true when navigator.standalone is set (Safari)", () => {
    stubMatchMedia(() => false);
    (window.navigator as Navigator & { standalone?: boolean }).standalone = true;
    expect(isStandaloneDisplay()).toBe(true);
  });

  test("returns false in a browser tab", () => {
    stubMatchMedia(() => false);
    expect(isStandaloneDisplay()).toBe(false);
  });
});

describe("useInstallPrompt", () => {
  beforeEach(() => {
    // Default: mobile Safari, not standalone.
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get: () => IPHONE_UA,
    });
    stubMatchMedia(() => false);
  });
  afterEach(() => {
    clearMatchMedia();
    vi.restoreAllMocks();
  });

  test("on iPhone in a browser tab → available=true, platform='ios'", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.platform).toBe("ios");
    expect(result.current.isStandalone).toBe(false);
    expect(result.current.available).toBe(true);
  });

  test("on Android in a browser tab → available=true, platform='android'", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get: () => ANDROID_UA,
    });
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.platform).toBe("android");
    expect(result.current.available).toBe(true);
  });

  test("desktop UA → available=false", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get: () => DESKTOP_UA,
    });
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.platform).toBe("other");
    expect(result.current.available).toBe(false);
  });

  test("standalone display → available=false even on mobile", () => {
    stubMatchMedia(q => q === "(display-mode: standalone)");
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isStandalone).toBe(true);
    expect(result.current.available).toBe(false);
  });
});
