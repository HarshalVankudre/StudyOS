import { PRICING_SHARE, SHARE_IMAGE_CONTENT_TYPE, SHARE_IMAGE_SIZE, renderShareImage } from "@/lib/og/share-image";

// /pricing's card on X (summary_large_image): the same picture as
// opengraph-image.tsx, drawn in lib/og/share-image.tsx.
export const alt = PRICING_SHARE.alt;
export const size = SHARE_IMAGE_SIZE;
export const contentType = SHARE_IMAGE_CONTENT_TYPE;

export default function Image() {
  return renderShareImage(PRICING_SHARE.content);
}
