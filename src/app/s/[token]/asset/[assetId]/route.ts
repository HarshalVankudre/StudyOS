import { createAssetService } from "@/lib/assets/service";
import { gcsAssetStore } from "@/lib/assets/storage";
import { prismaAssetRepo } from "@/lib/assets/repo";
import { clientRateLimitKey } from "@/lib/ops/client-ip";
import { reportError } from "@/lib/ops/report-error";
import { sharedAssetImage } from "@/lib/share/asset";
import { allowShareAssetRequest, SHARE_THROTTLE_WINDOW_MS } from "@/lib/share/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string; assetId: string }> };

// Lazy like /api/asset/[id]: no Storage or Prisma client is built until a
// request asks for an image.
const assets = createAssetService({ store: gcsAssetStore(), repo: prismaAssetRepo() });

const NOT_FOUND_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * An image of a shared page, only for the images that page shows
 * (lib/share/asset.ts). No sign-in needed: the link's token is the
 * credential. The bytes are sent from here, never a redirect to the storage
 * bucket (whose object path names the sharer's account), with the type the
 * Asset row records, and headers that keep the response an inert image even
 * when opened on its own: nosniff, a sandboxing CSP that loads nothing,
 * inline, never cached. Throttled per address (lib/share/throttle.ts).
 */
export async function GET(request: Request, { params }: Props) {
  if (!allowShareAssetRequest(clientRateLimitKey(request.headers))) {
    return new Response("Too many requests", {
      status: 429,
      headers: { ...NOT_FOUND_HEADERS, "Retry-After": String(Math.ceil(SHARE_THROTTLE_WINDOW_MS / 1000)) },
    });
  }
  // No bucket configured: no stored images at all.
  if (!process.env.ASSETS_BUCKET?.trim()) return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

  const { token, assetId } = await params;
  let image;
  try {
    image = await sharedAssetImage(token, assetId, assets);
  } catch (error) {
    reportError(error, { source: "share-asset" });
    image = null;
  }
  if (!image) return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

  return new Response(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.mime }), {
    status: 200,
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(image.bytes.byteLength),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      // Opened on its own (an SVG, say), the response runs nothing and loads nothing.
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      // The link can be turned off at any moment: never kept by a browser or a proxy.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
