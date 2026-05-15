import type { MetadataRoute } from "next";

// Required for the metadata file route to be emitted as a static asset
// rather than a server route under `output: "export"`.
export const dynamic = "force-static";

// Web App Manifest. Next.js emits this at /manifest.webmanifest and adds
// the matching <link rel="manifest"> tag to every page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Myangler · Burmese ↔ English",
    short_name: "Myangler",
    description:
      "A pocket Burmese–English dictionary. Offline-first, parchment-and-lacquer themed.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F1E8D2",
    theme_color: "#F1E8D2",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
