import { auth } from "@clerk/nextjs/server";
import { allowMaterialRead, allowMaterialWrite } from "@/lib/materials/guard";
import { deleteMaterial, getMaterial } from "@/lib/materials/store";
import type { MaterialPage } from "@/lib/materials/types";

export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

const ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * GET    /api/materials/:id?page=N  One page of the material's text, for the
 *                                   citation viewer (owner only).
 * DELETE /api/materials/:id          Remove the material. Cards already made
 *                                   from it keep their text and quote.
 *
 * Someone else's material, or one whose workspace is in the trash, is a 404:
 * the response never reveals that it exists.
 */
export async function GET(request: Request, { params }: Props) {
  const { userId } = await auth();
  if (!userId) return Response.json({ code: "not_authenticated" }, { status: 401 });
  if (!allowMaterialRead(userId)) return Response.json({ code: "rate_limited" }, { status: 429 });
  const { id } = await params;
  if (!ID.test(id)) return Response.json({ code: "not_found" }, { status: 404 });

  const material = await getMaterial(userId, id);
  if (!material) return Response.json({ code: "not_found" }, { status: 404 });

  const raw = new URL(request.url).searchParams.get("page") ?? "1";
  const requested = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  const pageCount = material.pages.length;
  if (!Number.isInteger(requested) || requested < 1 || requested > pageCount) {
    return Response.json({ code: "invalid" }, { status: 400 });
  }
  const body: MaterialPage = {
    id: material.id,
    title: material.title,
    page: requested,
    pageCount,
    text: material.pages[requested - 1] ?? "",
  };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(_request: Request, { params }: Props) {
  const { userId } = await auth();
  if (!userId) return Response.json({ code: "not_authenticated" }, { status: 401 });
  if (!allowMaterialWrite(userId)) return Response.json({ code: "rate_limited" }, { status: 429 });
  const { id } = await params;
  if (!ID.test(id)) return Response.json({ code: "not_found" }, { status: 404 });
  const deleted = await deleteMaterial(userId, id);
  if (!deleted) return Response.json({ code: "not_found" }, { status: 404 });
  return Response.json({ deleted: true });
}
