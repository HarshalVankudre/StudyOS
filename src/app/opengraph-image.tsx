import { LANDING_SHARE, SHARE_IMAGE_CONTENT_TYPE, SHARE_IMAGE_SIZE, renderShareImage } from "@/lib/og/share-image";

// The share image of the landing page (and of any page without its own).
// Drawn in lib/og/share-image.tsx; twitter-image.tsx is the same picture.
export const alt = LANDING_SHARE.alt;
export const size = SHARE_IMAGE_SIZE;
export const contentType = SHARE_IMAGE_CONTENT_TYPE;

export default function Image() {
  return renderShareImage(LANDING_SHARE.content);
}
