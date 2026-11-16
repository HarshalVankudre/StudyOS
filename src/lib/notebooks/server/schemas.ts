/**
 * Request validation for the notebooks API (zod), and parsing of the JSON
 * columns the store keeps (paper, page template). Stored JSON is parsed
 * leniently: a row written by an older release or edited by hand falls back
 * to the defaults instead of breaking the shelf.
 */
import { z } from "zod";
import {
  COVER_COLORS,
  DEFAULT_PAPER,
  DEFAULT_TEMPLATE,
  ID_PATTERN,
  MAX_FOLDER_NAME,
  MAX_TITLE,
  PAGE_SIZES,
  PAPER_COLORS,
  TEMPLATE_KINDS,
  type CoverColor,
  type NotebookPaper,
  type PageSizeName,
  type PageTemplate,
} from "../model";

export const idSchema = z.string().regex(ID_PATTERN);
export const templateSchema = z.object({ kind: z.enum(TEMPLATE_KINDS), paper: z.enum(PAPER_COLORS) });
export const paperSchema = z.object({
  template: templateSchema,
  size: z.enum(Object.keys(PAGE_SIZES) as [PageSizeName, ...PageSizeName[]]),
  landscape: z.boolean(),
});
export const coverSchema = z.enum(COVER_COLORS);
/** Titles are trimmed; an empty title is allowed (the shelf shows "Untitled"). */
export const titleSchema = z.string().max(MAX_TITLE * 2).transform((t) => t.trim().slice(0, MAX_TITLE));
export const folderNameSchema = z
  .string()
  .max(MAX_FOLDER_NAME * 2)
  .transform((t) => t.trim().slice(0, MAX_FOLDER_NAME))
  .refine((t) => t.length > 0);
/** A linked course workspace id (workspace ids are not notebook-style ids). */
export const workspaceIdSchema = z.string().min(1).max(100);

/** POST /api/notebooks */
export const createNotebookSchema = z.object({
  id: idSchema.optional(),
  title: titleSchema,
  cover: coverSchema,
  folderId: idSchema.nullable().optional(),
  workspaceId: workspaceIdSchema.nullable().optional(),
  paper: paperSchema,
  firstPageId: idSchema.optional(),
});
export type CreateNotebookBody = z.infer<typeof createNotebookSchema>;

/** PATCH /api/notebooks/:id (any subset; at least one field). */
export const patchNotebookSchema = z
  .object({
    title: titleSchema.optional(),
    cover: coverSchema.optional(),
    folderId: idSchema.nullable().optional(),
    workspaceId: workspaceIdSchema.nullable().optional(),
    paper: paperSchema.optional(),
    trashed: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined));
export type NotebookPatch = z.infer<typeof patchNotebookSchema>;

/** POST /api/notebooks/folders */
export const createFolderSchema = z.object({ id: idSchema.optional(), name: folderNameSchema });
/** PATCH /api/notebooks/folders/:folderId */
export const renameFolderSchema = z.object({ name: folderNameSchema });

// ---- Stored JSON ----------------------------------------------------------------

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parsePaper(text: string): NotebookPaper {
  const parsed = paperSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : DEFAULT_PAPER;
}

export function parseTemplate(text: string): PageTemplate {
  const parsed = templateSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : DEFAULT_TEMPLATE;
}

export function parseCover(text: string): CoverColor {
  return (COVER_COLORS as readonly string[]).includes(text) ? (text as CoverColor) : "slate";
}

/** Canonical JSON of a template (stable key order, so equal templates compare equal). */
export function templateJson(t: PageTemplate): string {
  return JSON.stringify({ kind: t.kind, paper: t.paper });
}

export function paperJson(p: NotebookPaper): string {
  return JSON.stringify({ template: { kind: p.template.kind, paper: p.template.paper }, size: p.size, landscape: p.landscape });
}
