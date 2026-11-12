/**
 * Validation of a patch (changes.ts `Op[]`) sent by a browser: the closing
 * tab's last edits (`/api/workspace/save`). Only the shape is checked here;
 * the document the patch produces still goes through the save gate
 * (`prepareWorkspaceForSave`), exactly like a whole-document save.
 *
 * Paths may not step through `__proto__`, `constructor` or `prototype`, so a
 * crafted patch can never reach an object's prototype.
 */
import { z } from "zod";
import type { Op } from "./changes";

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

const key = z
  .string()
  .min(1)
  .max(200)
  .refine((k) => !FORBIDDEN.has(k), "forbidden key");
const seg = z.union([key, z.object({ id: z.string().min(1).max(200) }).strict()]);
const path = z.array(seg).max(32);
const neighbours = z.tuple([z.string().max(200).nullable(), z.string().max(200).nullable()]);
const item = z.record(z.string(), z.unknown()).refine((v) => typeof v.id === "string", "item without id");

const op = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), path: path.min(1), before: z.unknown().optional(), after: z.unknown().optional() }),
  z.object({ op: z.literal("ins"), path, item, at: neighbours }),
  z.object({ op: z.literal("del"), path, item, at: neighbours }),
  z.object({ op: z.literal("mov"), path, id: z.string().min(1).max(200), from: neighbours, to: neighbours }),
]);

export const MAX_PATCH_OPS = 2_000;

/** The ops, or null when the input is not a well-formed patch. */
export function parsePatch(input: unknown): Op[] | null {
  const parsed = z.array(op).max(MAX_PATCH_OPS).safeParse(input);
  return parsed.success ? (parsed.data as Op[]) : null;
}
