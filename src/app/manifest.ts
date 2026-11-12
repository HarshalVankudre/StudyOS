import type { MetadataRoute } from "next";

/**
 * Web app manifest (Next.js serves it at /manifest.webmanifest and links it
 * from every page). Colours match the default dark theme in globals.css.
 * Static on purpose: one manifest for every language and visitor.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "StudyOS",
    short_name: "StudyOS",
    description: "Your whole semester, set up in about a minute, and it maintains itself.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b0b0a",
    theme_color: "#0b0b0a",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
