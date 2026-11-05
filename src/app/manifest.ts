import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

// Web app manifest. Lets people add the site to their Home Screen, which iPhones require
// before they will deliver push notifications, and gives notifications the site's icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: site.name,
    description: site.tagline,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0d0d10",
    theme_color: "#0d0d10",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
