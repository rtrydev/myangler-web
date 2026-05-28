import type { Metadata, Viewport } from "next";
import { Spectral, Noto_Serif_Myanmar, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});

const notoMm = Noto_Serif_Myanmar({
  variable: "--font-noto-mm",
  subsets: ["myanmar"],
  weight: ["400", "500", "600"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Myangler · Burmese ↔ English",
  description: "A pocket Burmese–English dictionary. Offline-first, parchment-and-lacquer themed.",
  applicationName: "Myangler",
  appleWebApp: {
    capable: true,
    title: "Myangler",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F1E8D2" },
    { media: "(prefers-color-scheme: dark)", color: "#16100A" },
  ],
};

// Pre-hydration theme script. Inlined into `<head>` so it executes
// synchronously while the HTML is parsed — *before* any paint — and
// applies the user's persisted `data-accent` + `.dark` from
// `myangler.preferences.v1` directly on `<html>`. Without this, the
// page would flash the light/ruby default on every reload until React
// hydrated and the in-app store re-applied the saved theme.
//
// The schema (key name, accent whitelist, `dark` boolean field) is
// duplicated from `app/lib/app/preferences.ts` because this string is
// evaluated outside the React module graph. Keep them in lockstep if
// either side ever changes.
const THEME_INIT_SCRIPT = `(function(){try{var raw=window.localStorage.getItem("myangler.preferences.v1");var accent="ruby";var dark=false;if(raw){var prefs=JSON.parse(raw);if(prefs&&typeof prefs==="object"){if(prefs.accent==="ruby"||prefs.accent==="gold"||prefs.accent==="jade"||prefs.accent==="indigo"){accent=prefs.accent;}if(typeof prefs.dark==="boolean"){dark=prefs.dark;}}}var root=document.documentElement;root.dataset.accent=accent;if(dark){root.classList.add("dark");}}catch(e){}})();`;

// Pre-app splash overlay. Inlined into `<head>`/`<body>` so it paints in
// the first style/layout pass — before the 52 KB CSS bundle, the woff2
// fonts, or any JS chunk has arrived. Theme is correct from frame one
// because THEME_INIT_SCRIPT above has already applied `.dark` and
// `data-accent` to `<html>`.
//
// The palette here is hand-mirrored from `app/globals.css` — light/dark
// and the accent remaps — because globals.css loads via the bundle and
// isn't available yet at this point. Keep the two in sync if the token
// values shift.
//
// Removal is owned by `useSplashRemoval()` in `engine-context.tsx`: it
// flips `data-leaving="true"` (which triggers the opacity transition)
// once the engine reaches `ready` or `error`, then removes the node from
// the DOM. A safety timer falls through if `transitionend` never fires.
const SPLASH_STYLES = `:root{--splash-bg:#F1E8D2;--splash-ring:#8A2727;--splash-ink:#5A4329}
.dark{--splash-bg:#16100A;--splash-ring:#C75555;--splash-ink:#C8B68C}
[data-accent="gold"]{--splash-ring:#B07820}
[data-accent="jade"]{--splash-ring:#4F6B4D}
[data-accent="indigo"]{--splash-ring:#4F5B8B}
.dark[data-accent="gold"]{--splash-ring:#D9A94A}
.dark[data-accent="jade"]{--splash-ring:#8AA786}
.dark[data-accent="indigo"]{--splash-ring:#8088B8}
#myangler-splash{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:var(--splash-bg);color:var(--splash-ink);padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);font:italic 16px/1.4 ui-serif,Georgia,"Times New Roman",serif;transition:opacity 280ms cubic-bezier(.2,.7,.2,1);-webkit-tap-highlight-color:transparent;will-change:opacity}
#myangler-splash[data-leaving="true"]{opacity:0;pointer-events:none}
#myangler-splash .mys-stack{position:relative;display:grid;place-items:center;width:72px;height:72px}
#myangler-splash .mys-ring{width:72px;height:72px;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 60%,var(--splash-ring) 96%,transparent 100%);-webkit-mask:radial-gradient(circle,transparent 56%,#000 58%);mask:radial-gradient(circle,transparent 56%,#000 58%);animation:mys-spin 1.1s linear infinite;will-change:transform}
#myangler-splash .mys-mark{position:absolute;width:40px;height:40px;animation:mys-pulse 2.2s ease-in-out infinite;filter:drop-shadow(0 1px 2px rgba(36,21,9,.12))}
#myangler-splash .mys-caption{letter-spacing:.01em}
@keyframes mys-spin{to{transform:rotate(1turn)}}
@keyframes mys-pulse{0%,100%{opacity:.85;transform:scale(1)}50%{opacity:1;transform:scale(1.04)}}
@media (prefers-reduced-motion:reduce){#myangler-splash .mys-ring{animation:none;opacity:.55}#myangler-splash .mys-mark{animation:none}#myangler-splash .mys-caption{animation:mys-pulse 1.8s ease-in-out infinite}}`;

// Captures the time the splash first entered the DOM so the removal
// hook can enforce a minimum on-screen window for cached returning
// visitors. Inline so it runs synchronously while the body is parsed.
const SPLASH_INIT_SCRIPT = `(function(){try{var s=document.getElementById("myangler-splash");if(s)s.dataset.shownAt=String(performance.now());}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // The inline theme script below mutates `class` and `data-accent`
      // on this element before hydration runs. `suppressHydrationWarning`
      // tells React to skip the mismatch check for THIS element only —
      // children still hydrate normally.
      suppressHydrationWarning
      className={`${spectral.variable} ${notoMm.variable} ${dmSans.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <script
          id="myangler-theme-init"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <style
          id="myangler-splash-style"
          dangerouslySetInnerHTML={{ __html: SPLASH_STYLES }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <div
          id="myangler-splash"
          role="status"
          aria-live="polite"
          aria-busy="true"
          data-shown-at="0"
        >
          <div className="mys-stack">
            <div className="mys-ring" aria-hidden="true" />
            {/* Decorative — the live region's accessible name comes from
                the caption below. `alt=""` avoids double-announcing the
                brand mark. */}
            <img
              className="mys-mark"
              src="/myangler-logo.webp"
              alt=""
              aria-hidden="true"
              width={40}
              height={40}
            />
          </div>
          <div className="mys-caption">Loading dictionary…</div>
        </div>
        <script
          id="myangler-splash-init"
          dangerouslySetInnerHTML={{ __html: SPLASH_INIT_SCRIPT }}
        />
        {children}
      </body>
    </html>
  );
}
