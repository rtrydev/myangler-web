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
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
