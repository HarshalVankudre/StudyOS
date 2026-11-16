import { PRICING_SHARE, SHARE_IMAGE_CONTENT_TYPE, SHARE_IMAGE_SIZE, renderShareImage } from "@/lib/og/share-image";

// The share image of /pricing, drawn in lib/og/share-image.tsx;
// twitter-image.tsx is the same picture.
export const alt = PRICING_SHARE.alt;
export const size = SHARE_IMAGE_SIZE;
export const contentType = SHARE_IMAGE_CONTENT_TYPE;

export default function Image() {
  return renderShareImage(PRICING_SHARE.content);
}
