import { auth } from "@clerk/nextjs/server";
import { createAssetService } from "@/lib/assets/service";
import { gcsAssetStore } from "@/lib/assets/storage";
import { prismaAssetRepo } from "@/lib/assets/repo";

export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

const assets = createAssetService({ store: gcsAssetStore(), repo: prismaAssetRepo() });

export async function GET(_request: Request, { params }: Props) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const url = await assets.signedUrlForAsset(id, userId);
  if (!url) return new Response("Not found", { status: 404 });

  // 302 to a short-lived signed URL; never expose the asset publicly.
  return Response.redirect(url, 302);
}
