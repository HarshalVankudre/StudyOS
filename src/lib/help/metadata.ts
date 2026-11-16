import type { Metadata, ResolvingMetadata } from "next";

/**
 * Title, description, canonical address and share card of a help page.
 * Metadata objects merge shallowly, so setting openGraph and twitter here
 * replaces the root layout's blocks; the share image the root provides
 * (app/opengraph-image.tsx, app/twitter-image.tsx) is carried over.
 */
export async function helpMetadata(
  { title, description, path }: { title: string; description: string; path: string },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const inherited = await parent;
  const ogImages = inherited?.openGraph?.images;
  const twitterImages = inherited?.twitter?.images;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: "StudyOS",
      type: "website",
      ...(ogImages?.length ? { images: ogImages } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(twitterImages?.length ? { images: twitterImages } : {}),
    },
  };
}
