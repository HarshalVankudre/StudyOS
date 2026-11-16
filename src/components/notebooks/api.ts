/**
 * Client helpers for the notebook API (browser only) and the shared palettes.
 */
import type { CoverColor, NotebookDetail } from "@/lib/notebooks/model";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Which limit a `limit` / `too_large` refusal hit ("pages", "bytes", "storage", …). */
    readonly limit?: string,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }
}

/** POST a PDF (multipart) and return the notebook the server answers with. */
export async function uploadPdf(url: string, form: FormData): Promise<NotebookDetail> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "offline");
  }
  const body = (await res.json().catch(() => ({}))) as { code?: string; limit?: string; notebook?: NotebookDetail };
  if (!res.ok || !body.notebook) throw new ApiError(res.status, body.code ?? "error", body.limit);
  return body.notebook;
}

type LibraryStrings = {
  tooLarge: string;
  tooManyPages: string;
  notPdf: string;
  limitReached: string;
  rateLimited: string;
  importFailed: string;
};

/** The message for a failed PDF import (see the PDF routes' error codes). */
export function pdfErrorMessage(err: unknown, L: LibraryStrings): string {
  if (!(err instanceof ApiError)) return L.importFailed;
  if (err.code === "too_large") return err.limit === "pages" ? L.tooManyPages : L.tooLarge;
  if (err.code === "unsupported") return L.notPdf;
  if (err.code === "limit") return L.limitReached;
  if (err.code === "rate_limited" || err.code === "busy") return L.rateLimited;
  return L.importFailed;
}

/** fetch + JSON with the API's `{ code }` errors turned into ApiError. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  } catch {
    throw new ApiError(0, "offline");
  }
  if (!res.ok) {
    let body: { code?: string; limit?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {}
    throw new ApiError(res.status, body.code ?? "error", body.limit);
  }
  return (await res.json()) as T;
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function patchNotebook(id: string, patch: Record<string, unknown>) {
  return api<{ notebook: NotebookDetail }>(`/api/notebooks/${encodeURIComponent(id)}`, jsonInit("PATCH", patch));
}

/** Base64 of a blob's bytes (no data: prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const COVER_HEX: Record<CoverColor, string> = {
  slate: "#475569",
  red: "#b91c1c",
  orange: "#c2410c",
  amber: "#b45309",
  lime: "#4d7c0f",
  emerald: "#047857",
  teal: "#0f766e",
  sky: "#0369a1",
  indigo: "#4338ca",
  violet: "#6d28d9",
  pink: "#be185d",
  stone: "#57534e",
};

export const PEN_COLORS = ["#1f2937", "#1d4ed8", "#dc2626", "#15803d", "#7c3aed", "#ea580c", "#0891b2", "#6b7280"];
export const HIGHLIGHTER_COLORS = ["#facc15", "#4ade80", "#f472b6", "#60a5fa", "#fb923c"];
export const PEN_WIDTHS = [1.4, 2.2, 3.6];
export const HIGHLIGHTER_WIDTHS = [10, 16, 26];
export const ERASER_SIZES = [8, 18, 36];
