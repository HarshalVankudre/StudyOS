import type { MetadataRoute } from "next";
import { HELP_SLUGS, helpPath } from "@/lib/help/catalog";
import { legalNoticeConfigured } from "@/lib/legal/operator";
import { siteUrl } from "@/lib/site";
import { GRADE_CALCULATOR_PATH } from "@/lib/tools/catalog";

// Built per request, not at `next build`: the Docker image is built without
// the runtime settings (APP_URL, the legal notice's STUDYOS_OPERATOR_*), so a
// prerendered sitemap would carry the build machine's view of them.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/pricing`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}${GRADE_CALCULATOR_PATH}`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}${helpPath()}`, changeFrequency: "monthly", priority: 0.7 },
    ...HELP_SLUGS.map((slug) => ({
      url: `${base}${helpPath(slug)}`,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    { url: `${base}/sign-up`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/sign-in`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    ...(legalNoticeConfigured()
      ? [{ url: `${base}/legal-notice`, changeFrequency: "yearly" as const, priority: 0.2 }]
      : []),
  ];
}
