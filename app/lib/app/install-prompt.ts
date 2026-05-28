"use client";

// "Add to Home Screen" install-guide gating.
//
// Tells the caller whether installation is even applicable on the
// current device by answering two questions:
//
//   1. Is this a mobile device (iOS or Android)?
//      Detected from the User-Agent, defensively — we only care enough
//      to choose which set of platform steps to show.
//   2. Is the app already running as an installed PWA?
//      `display-mode: standalone` covers Android Chrome + iOS once the
//      icon has been added; `navigator.standalone` is Safari's legacy
//      iOS hook. If either says yes, the guide makes no sense.
//
// There is no auto-open or dismissal tracking — the install guide is
// reached explicitly via the header button in `AppShell`. The hook just
// reports `available`; the parent decides when to surface the entry
// point.

import { useEffect, useState } from "react";

export type InstallPlatform = "ios" | "android" | "other";

/** Inspect a UA string and label the device family. Kept pure / arg-in
 *  arg-out so tests can drive it without monkey-patching navigator. */
export function detectPlatform(userAgent: string): InstallPlatform {
  const ua = userAgent.toLowerCase();
  // iPadOS 13+ reports as Macintosh; the `maxTouchPoints` sniff inside
  // `isMobileDevice` catches that case — here, the UA alone tells us
  // iPhone / iPod (iPad reports plain "Macintosh").
  if (/iphone|ipod/.test(ua)) return "ios";
  // Legacy iPad UA still includes the token.
  if (/ipad/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "other";
}

/** Is this a phone / tablet we want to surface an install affordance
 *  on? Uses UA for the platform sniff plus the iPadOS touch-points
 *  fallback, since modern iPads otherwise look identical to a desktop
 *  Mac. */
export function isMobileDevice(
  userAgent: string,
  maxTouchPoints: number = 0,
): boolean {
  const platform = detectPlatform(userAgent);
  if (platform === "ios" || platform === "android") return true;
  // iPadOS 13+ masquerades as macOS — distinguish via touch.
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return true;
  return false;
}

/** True when the page is being rendered from the installed PWA. Covers
 *  both the standards path (`display-mode: standalone`) and Safari's
 *  legacy `navigator.standalone` shim. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    // matchMedia can throw in very old jsdom — treat as not standalone.
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export interface InstallPromptState {
  /** Mobile platform family — `"other"` on desktop or unknown UAs. */
  platform: InstallPlatform;
  /** Whether the app is running as an installed PWA right now. */
  isStandalone: boolean;
  /** Is installation possible on this device right now? `true` only on
   *  iOS/Android in a browser tab; `false` on desktop and inside the
   *  installed PWA. Use this to gate the install entry-point UI. */
  available: boolean;
}

/** React binding. Computes platform / standalone client-side on mount
 *  (they don't change during a session) so SSR renders the safe
 *  "unavailable" state and the real values fill in after hydration. */
export function useInstallPrompt(): InstallPromptState {
  const [env, setEnv] = useState<{ platform: InstallPlatform; isStandalone: boolean }>(
    { platform: "other", isStandalone: false },
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator/matchMedia are client-only; reading them in a lazy useState initializer would cause an SSR/hydration mismatch.
    setEnv({
      platform: detectPlatform(window.navigator.userAgent),
      isStandalone: isStandaloneDisplay(),
    });
  }, []);

  const isMobile = env.platform === "ios" || env.platform === "android";
  return {
    platform: env.platform,
    isStandalone: env.isStandalone,
    available: isMobile && !env.isStandalone,
  };
}
