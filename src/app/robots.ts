import type { MetadataRoute } from "next";

// Outbound redirects, the admin area and APIs are never crawled. The sitemap comes with SEO work.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/go/", "/admin", "/api/"] },
  };
}
