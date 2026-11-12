/**
 * Browser side of the /api/materials routes. Errors come back as codes; the
 * dialog turns them into words (dict.materials.errors).
 */
import type { KitEvent, KitRequest, MaterialPage, MaterialSummary } from "@/lib/materials/types";

export class MaterialApiError extends Error {
  readonly code: string;
  readonly kind?: string;
  constructor(code: string, kind?: string) {
    super(code);
    this.name = "MaterialApiError";
    this.code = code;
    this.kind = kind;
  }
}

async function fail(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { code?: string; kind?: string } | null;
  throw new MaterialApiError(body?.code ?? (response.status === 413 ? "too_large" : "network"), body?.kind);
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new MaterialApiError("network");
  }
  if (!response.ok) return fail(response);
  return (await response.json()) as T;
}

export async function fetchMaterials(workspaceId: string): Promise<MaterialSummary[]> {
  const body = await call<{ materials: MaterialSummary[] }>(
    `/api/materials?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return body.materials;
}

export async function uploadMaterial(workspaceId: string, file: File): Promise<MaterialSummary> {
  const form = new FormData();
  form.append("workspaceId", workspaceId);
  form.append("file", file);
  const body = await call<{ material: MaterialSummary }>("/api/materials", { method: "POST", body: form });
  return body.material;
}

export async function pasteMaterial(input: {
  workspaceId: string;
  title: string;
  text: string;
  sourcePageId?: string;
}): Promise<MaterialSummary> {
  const body = await call<{ material: MaterialSummary }>("/api/materials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return body.material;
}

export async function deleteMaterial(id: string): Promise<void> {
  await call(`/api/materials/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchMaterialPage(id: string, page: number, signal?: AbortSignal): Promise<MaterialPage> {
  return call<MaterialPage>(`/api/materials/${encodeURIComponent(id)}?page=${page}`, { signal });
}

/**
 * Start a study kit and feed each streamed event to `onEvent`. Resolves when
 * the stream ends; rejects with MaterialApiError on an HTTP error.
 */
export async function streamStudyKit(
  request: KitRequest,
  onEvent: (event: KitEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/materials/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal.aborted) return;
    throw error instanceof MaterialApiError ? error : new MaterialApiError("network");
  }
  if (!response.ok || !response.body) return fail(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: KitEvent;
        try {
          event = JSON.parse(line) as KitEvent;
        } catch {
          continue; // A torn line is ignored; the end of the stream still settles the run.
        }
        onEvent(event);
      }
      if (done) break;
    }
  } catch (error) {
    if (signal.aborted) return;
    throw error instanceof MaterialApiError ? error : new MaterialApiError("network");
  }
}

/** Tell the server to stop a run (also stops it behind proxies that keep the connection). */
export function cancelStudyKit(generationId: string): void {
  void fetch("/api/materials/generate/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generationId }),
    keepalive: true,
  }).catch(() => {});
}
