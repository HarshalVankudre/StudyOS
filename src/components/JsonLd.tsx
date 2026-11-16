import { jsonLdScript } from "@/lib/seo/structured-data";

/** Structured data for search engines (schema.org JSON-LD), escaped. */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />;
}
