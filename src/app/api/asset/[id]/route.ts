import { auth } from "@clerk/nextjs/server";
import { createAssetService } from "@/lib/assets/service";
import { gcsAssetStore } from "@/lib/assets/storage";
import { prismaAssetRepo } from "@/lib/assets/repo";
import { remoteAssetImagesAvailable } from "@/lib/ops/env";

export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

// Safe at module scope (flag-off prod included) ONLY because gcsAssetStore() and
// prismaAssetRepo() are lazy — no Storage/Prisma client is constructed until a
// request actually calls signedUrlForAsset. Keep them lazy, or move this into GET.
const assets = createAssetService({ store: gcsAssetStore(), repo: prismaAssetRepo() });

export async function GET(_request: Request, { params }: Props) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  // A build whose image CSP does not allow the bucket in use serves no asset
  // images (the browser would block them); the startup log says so.
  if (!remoteAssetImagesAvailable()) return new Response("Not found", { status: 404 });

  const { id } = await params;
  const url = await assets.signedUrlForAsset(id, userId);
  if (!url) return new Response("Not found", { status: 404 });

  // 302 to a short-lived signed URL; never expose the asset publicly.
  return Response.redirect(url, 302);
}
