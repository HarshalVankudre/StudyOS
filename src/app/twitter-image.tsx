import { LANDING_SHARE, SHARE_IMAGE_CONTENT_TYPE, SHARE_IMAGE_SIZE, renderShareImage } from "@/lib/og/share-image";

// The landing page's card on X (summary_large_image): the same picture as
// opengraph-image.tsx, drawn in lib/og/share-image.tsx.
export const alt = LANDING_SHARE.alt;
export const size = SHARE_IMAGE_SIZE;
export const contentType = SHARE_IMAGE_CONTENT_TYPE;

export default function Image() {
  return renderShareImage(LANDING_SHARE.content);
}
