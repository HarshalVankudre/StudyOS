import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private/product surfaces: nothing behind auth or an API belongs in a
      // search index. /embed is an iframe runtime, not a page.
      disallow: ["/app", "/api/", "/embed/", "/generate"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
