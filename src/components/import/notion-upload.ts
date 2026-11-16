/**
 * Sending a Notion export to /api/import/notion. XMLHttpRequest rather than
 * fetch: only it reports upload progress, and a 25 MB upload needs a bar.
 */
import type { NotionImportSummary } from "@/lib/import/notion/limits";

export interface NotionImportDone {
  workspaceId: string;
  name: string;
  summary: NotionImportSummary;
}

export type NotionUploadResult =
  | { ok: true; data: NotionImportDone }
  /** `code` is the route's error code, "network" (no answer) or "aborted". */
  | { ok: false; code: string; max?: number };

export interface UploadOptions {
  /** Share of the file sent so far, 0..1. */
  onProgress?: (fraction: number) => void;
  /** All bytes are sent; the server is building the workspace. */
  onSent?: () => void;
  signal?: AbortSignal;
}

export function uploadNotionExport(file: File, options: UploadOptions = {}): Promise<NotionUploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const body = new FormData();
    body.append("file", file);
    xhr.open("POST", "/api/import/notion");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) options.onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.upload.onload = () => options.onSent?.();
    xhr.onload = () => {
      const data = (xhr.response ?? null) as Record<string, unknown> | null;
      if (xhr.status === 201 && data && typeof data.workspaceId === "string") {
        resolve({ ok: true, data: data as unknown as NotionImportDone });
        return;
      }
      const code = typeof data?.code === "string" ? data.code : xhr.status === 413 ? "too_large" : "failed";
      resolve({ ok: false, code, ...(typeof data?.max === "number" ? { max: data.max } : {}) });
    };
    xhr.onerror = () => resolve({ ok: false, code: "network" });
    xhr.ontimeout = () => resolve({ ok: false, code: "network" });
    xhr.onabort = () => resolve({ ok: false, code: "aborted" });
    if (options.signal) {
      if (options.signal.aborted) {
        resolve({ ok: false, code: "aborted" });
        return;
      }
      options.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}
