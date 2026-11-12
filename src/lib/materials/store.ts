/**
 * Study material persistence (server-only). Every query is scoped to the
 * owner AND to a workspace that is theirs and not in the trash, so a
 * material is invisible (to listing, generation and the citation viewer)
 * while its workspace is trashed, and gone when the workspace is purged
 * (ON DELETE CASCADE).
 */
import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  MAX_MATERIALS_PER_USER,
  MAX_MATERIALS_PER_WORKSPACE,
  MAX_MATERIAL_TITLE,
  MAX_STORED_CHARS_PER_USER,
} from "./limits";
import type { MaterialKind, MaterialSummary } from "./types";

/** Prisma filter: the material's workspace belongs to the owner and is not trashed. */
function liveWorkspace(ownerId: string) {
  return { ownerId, deletedAt: null } as const;
}

const SUMMARY_SELECT = {
  id: true,
  title: true,
  kind: true,
  pageCount: true,
  pageChars: true,
  charCount: true,
  sourcePages: true,
  truncated: true,
  sourcePageId: true,
  createdAt: true,
} as const;

type SummaryRow = {
  id: string;
  title: string;
  kind: string;
  pageCount: number;
  pageChars: string;
  charCount: number;
  sourcePages: number;
  truncated: boolean;
  sourcePageId: string | null;
  createdAt: Date;
};

function parseNumbers(json: string): number[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.map((n) => (typeof n === "number" ? n : 0)) : [];
  } catch {
    return [];
  }
}

export function parsePages(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.map((p) => (typeof p === "string" ? p : "")) : [];
  } catch {
    return [];
  }
}

function toSummary(row: SummaryRow): MaterialSummary {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as MaterialKind,
    pageCount: row.pageCount,
    pageChars: parseNumbers(row.pageChars),
    charCount: row.charCount,
    sourcePages: row.sourcePages,
    truncated: row.truncated,
    sourcePageId: row.sourcePageId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** True when the workspace exists, is the owner's, and is not in the trash. */
export async function ownsLiveWorkspace(ownerId: string, workspaceId: string): Promise<boolean> {
  const row = await prisma.workspace.findFirst({
    where: { id: workspaceId, ...liveWorkspace(ownerId) },
    select: { id: true },
  });
  return row !== null;
}

export async function listMaterials(ownerId: string, workspaceId: string): Promise<MaterialSummary[]> {
  const rows = await prisma.studyMaterial.findMany({
    where: { ownerId, workspaceId, workspace: liveWorkspace(ownerId) },
    orderBy: { createdAt: "desc" },
    select: SUMMARY_SELECT,
  });
  return rows.map(toSummary);
}

export async function countMaterials(ownerId: string, workspaceId: string): Promise<number> {
  return prisma.studyMaterial.count({ where: { ownerId, workspaceId } });
}

export function contentHashOf(pages: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(pages)).digest("hex");
}

export interface NewMaterial {
  ownerId: string;
  workspaceId: string;
  title: string;
  kind: MaterialKind;
  pages: string[];
  sourcePages: number;
  truncated: boolean;
  sourcePageId?: string | null;
}

export type CreateMaterialResult =
  | { ok: true; material: MaterialSummary; reused: boolean }
  | { ok: false; reason: "not_found" | "limit" | "storage" };

/**
 * Store a material. Identical content already in the workspace is reused
 * (sending the same notes page twice does not make a second copy).
 */
export async function createMaterial(input: NewMaterial): Promise<CreateMaterialResult> {
  if (!(await ownsLiveWorkspace(input.ownerId, input.workspaceId))) {
    return { ok: false, reason: "not_found" };
  }
  const contentHash = contentHashOf(input.pages);
  const existing = await prisma.studyMaterial.findFirst({
    where: { ownerId: input.ownerId, workspaceId: input.workspaceId, contentHash },
    select: SUMMARY_SELECT,
  });
  if (existing) return { ok: true, material: toSummary(existing), reused: true };
  if ((await countMaterials(input.ownerId, input.workspaceId)) >= MAX_MATERIALS_PER_WORKSPACE) {
    return { ok: false, reason: "limit" };
  }
  const pageChars = input.pages.map((p) => p.length);
  const chars = pageChars.reduce((a, b) => a + b, 0);
  const stored = await prisma.studyMaterial.aggregate({
    where: { ownerId: input.ownerId },
    _count: { _all: true },
    _sum: { charCount: true },
  });
  if (
    stored._count._all >= MAX_MATERIALS_PER_USER ||
    (stored._sum.charCount ?? 0) + chars > MAX_STORED_CHARS_PER_USER
  ) {
    return { ok: false, reason: "storage" };
  }
  const row = await prisma.studyMaterial.create({
    data: {
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      title: input.title.slice(0, MAX_MATERIAL_TITLE),
      kind: input.kind,
      pages: JSON.stringify(input.pages),
      pageChars: JSON.stringify(pageChars),
      pageCount: input.pages.length,
      charCount: chars,
      sourcePages: input.sourcePages,
      truncated: input.truncated,
      contentHash,
      sourcePageId: input.sourcePageId ?? null,
    },
    select: SUMMARY_SELECT,
  });
  return { ok: true, material: toSummary(row), reused: false };
}

export interface MaterialWithPages {
  id: string;
  workspaceId: string;
  title: string;
  pages: string[];
}

/** A material with its text, or null when it is not the owner's or its workspace is trashed. */
export async function getMaterial(
  ownerId: string,
  id: string,
  workspaceId?: string,
): Promise<MaterialWithPages | null> {
  const row = await prisma.studyMaterial.findFirst({
    where: {
      id,
      ownerId,
      ...(workspaceId ? { workspaceId } : {}),
      workspace: liveWorkspace(ownerId),
    },
    select: { id: true, workspaceId: true, title: true, pages: true },
  });
  return row ? { ...row, pages: parsePages(row.pages) } : null;
}

/** Delete a material; false when it is not the owner's (or its workspace is trashed). */
export async function deleteMaterial(ownerId: string, id: string): Promise<boolean> {
  const result = await prisma.studyMaterial.deleteMany({
    where: { id, ownerId, workspace: liveWorkspace(ownerId) },
  });
  return result.count > 0;
}
