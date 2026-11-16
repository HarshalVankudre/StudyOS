// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { de } from "@/lib/i18n/dictionaries/de";
import { en } from "@/lib/i18n/dictionaries/en";
import { acquireImportSlot } from "@/lib/import/notion/guard";
import { NOTION_IMPORT_LIMITS } from "@/lib/import/notion/limits";
import { makeZip, nid } from "@/lib/import/notion/zip-fixture";
import type { Workspace } from "@/lib/workspace/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkUsageLimit: vi.fn(),
  workspaceLimitReached: vi.fn(),
  saveNewWorkspace: vi.fn(),
  getI18n: vi.fn(),
  revalidatePath: vi.fn(),
  reportError: vi.fn(),
  remoteAssetImagesAvailable: vi.fn(),
  createAsset: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: mocks.checkUsageLimit,
  workspaceLimitReached: mocks.workspaceLimitReached,
  MAX_WORKSPACES_PER_USER: 200,
}));
vi.mock("@/lib/workspace/store", () => ({ saveNewWorkspace: mocks.saveNewWorkspace }));
vi.mock("@/lib/i18n/server", () => ({ getI18n: mocks.getI18n }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/ops/env", () => ({ remoteAssetImagesAvailable: mocks.remoteAssetImagesAvailable }));
vi.mock("@/lib/assets/service", () => ({ createAssetService: () => ({ createAsset: mocks.createAsset }) }));
vi.mock("@/lib/assets/storage", () => ({ gcsAssetStore: () => ({}) }));
vi.mock("@/lib/assets/repo", () => ({ prismaAssetRepo: () => ({}) }));

import { POST } from "./route";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10, 8, 6, 0, 0, 0]);

const exportZip = () =>
  makeZip({
    [`Notes ${nid(1)}.md`]: `# Notes\n\nSECRET-NOTE text.\n\n[Week 1](Notes%20${nid(1)}/Week%201%20${nid(2)}.md)\n\n![Pic](Notes%20${nid(1)}/pic.png)`,
    [`Notes ${nid(1)}/Week 1 ${nid(2)}.md`]: "# Week 1\n\nCells.",
    [`Notes ${nid(1)}/pic.png`]: PNG,
  });

function upload(bytes: Uint8Array | null, init: { headers?: Record<string, string>; name?: string } = {}) {
  const form = new FormData();
  if (bytes) form.append("file", new File([bytes as Uint8Array<ArrayBuffer>], init.name ?? "Export.zip", { type: "application/zip" }));
  return new Request("http://localhost/api/import/notion", { method: "POST", body: form, headers: init.headers });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  mocks.checkUsageLimit.mockResolvedValue({ allowed: true, remaining: 5 });
  mocks.workspaceLimitReached.mockResolvedValue(false);
  mocks.saveNewWorkspace.mockImplementation(async (_ws: Workspace, options: { id?: string }) => options.id ?? "random");
  mocks.getI18n.mockResolvedValue({ dict: en, locale: "en" });
  mocks.remoteAssetImagesAvailable.mockReturnValue(false);
  mocks.createAsset.mockResolvedValue({ assetId: "asset-9", mime: "image/png", filename: "pic.png" });
});

describe("POST /api/import/notion", () => {
  it("requires a signed-in user", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const res = await POST(upload(exportZip()));
    expect(res.status).toBe(401);
    expect(mocks.checkUsageLimit).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request", async () => {
    const res = await POST(upload(exportZip(), { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }));
    expect(res.status).toBe(403);
    expect(mocks.saveNewWorkspace).not.toHaveBeenCalled();
  });

  it("imports the export as a new workspace whose links name its id, and reports what it made", async () => {
    const res = await POST(upload(exportZip()));
    expect(res.status).toBe(201);
    const body = await json(res);
    const [workspace, options] = mocks.saveNewWorkspace.mock.calls[0] as [Workspace, { id: string }];
    expect(body.workspaceId).toBe(options.id);
    expect(options.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(workspace.id).toBe(options.id);
    expect(body.name).toBe("Notes");
    expect(body.summary).toMatchObject({ pages: 2, databases: 0, rows: 0, images: 0 });
    const week = workspace.pages.find((p) => p.title === "Week 1")!;
    expect(JSON.stringify(workspace.pages[0].blocks)).toContain(`/app/${options.id}?page=${week.id}`);
    expect(mocks.checkUsageLimit).toHaveBeenCalledWith("user-1", "notion_import");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
  });

  it("writes in the student's language and reads their dates day first", async () => {
    mocks.getI18n.mockResolvedValue({ dict: de, locale: "de" });
    const zip = makeZip({ [`A ${nid(1)}.md`]: "# A\n\nx", [`Termine ${nid(2)}.csv`]: "Name,Datum\nKlausur,03/04/2026\n" });
    expect((await POST(upload(zip))).status).toBe(201);
    const [workspace] = mocks.saveNewWorkspace.mock.calls[0] as [Workspace];
    expect(workspace.name).toBe("Notion-Import");
    const db = workspace.databases[0];
    expect(db.rows[0].cells[db.properties[1].id]).toBe("2026-04-03");
  });

  it("stores PNG images as assets of the new workspace when asset images are available", async () => {
    mocks.remoteAssetImagesAvailable.mockReturnValue(true);
    const res = await POST(upload(exportZip()));
    expect(res.status).toBe(201);
    const [workspace, options] = mocks.saveNewWorkspace.mock.calls[0] as [Workspace, { id: string }];
    expect(mocks.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "user-1", workspaceId: options.id, mime: "image/png", filename: "pic.png" }),
    );
    expect(workspace.pages[0].blocks).toContainEqual(expect.objectContaining({ type: "media", assetId: "asset-9" }));
    expect((await json(res)).summary).toMatchObject({ images: 1 });
  });

  it("stores a JPEG photo by its bytes, and never an SVG", async () => {
    mocks.remoteAssetImagesAvailable.mockReturnValue(true);
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);
    const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const zip = makeZip({
      [`Trip ${nid(1)}.md`]: `# Trip

![Photo](Trip%20${nid(1)}/photo.jpg)

![Logo](Trip%20${nid(1)}/logo.svg)`,
      [`Trip ${nid(1)}/photo.jpg`]: JPEG,
      [`Trip ${nid(1)}/logo.svg`]: SVG,
    });
    expect((await POST(upload(zip))).status).toBe(201);
    expect(mocks.createAsset).toHaveBeenCalledTimes(1);
    expect(mocks.createAsset).toHaveBeenCalledWith(expect.objectContaining({ mime: "image/jpeg", filename: "photo.jpg" }));
  });

  it("refuses a declared body over the limit without reading it or spending the hourly limit", async () => {
    const req = new Request("http://localhost/api/import/notion", {
      method: "POST",
      body: "x",
      headers: { "content-length": String(NOTION_IMPORT_LIMITS.maxUploadBytes + 1024 * 1024) },
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(await json(res)).toEqual({ code: "too_large" });
    expect(mocks.checkUsageLimit).not.toHaveBeenCalled();
  });

  it("stops reading an undeclared body as soon as it passes the limit", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 60) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const req = new Request("http://localhost/api/import/notion", {
      method: "POST",
      body: stream,
      headers: { "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(60);
    expect(mocks.saveNewWorkspace).not.toHaveBeenCalled();
  });

  it("refuses when the workspace cap is reached, before anything else", async () => {
    mocks.workspaceLimitReached.mockResolvedValue(true);
    const res = await POST(upload(exportZip()));
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ code: "workspace_limit", max: 200 });
    expect(mocks.checkUsageLimit).not.toHaveBeenCalled();
  });

  it("refuses past the hourly import limit", async () => {
    mocks.checkUsageLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const res = await POST(upload(exportZip()));
    expect(res.status).toBe(429);
    expect(await json(res)).toEqual({ code: "rate_limited" });
    expect(mocks.saveNewWorkspace).not.toHaveBeenCalled();
  });

  it("runs one import at a time per student, and frees the slot afterwards", async () => {
    const release = acquireImportSlot("user-1")!;
    const busy = await POST(upload(exportZip()));
    expect(busy.status).toBe(429);
    expect(await json(busy)).toEqual({ code: "busy" });
    release();
    expect((await POST(upload(exportZip()))).status).toBe(201);
    expect((await POST(upload(exportZip()))).status).toBe(201);
  });

  it("asks for a file", async () => {
    const res = await POST(upload(null));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ code: "invalid" });
  });

  it("names what is wrong with an upload that is not a usable export", async () => {
    const cases: [Uint8Array, string, number][] = [
      [new TextEncoder().encode("not a zip at all"), "not_zip", 422],
      [makeZip({ "photo.png": PNG }), "not_notion", 422],
      [makeZip({ "../escape.md": "x" }), "unsafe", 422],
      [makeZip({ "big.csv": new Uint8Array(4 * 1024 * 1024) }, 9), "unsafe", 422],
    ];
    for (const [bytes, code, status] of cases) {
      const res = await POST(upload(bytes));
      expect(res.status, code).toBe(status);
      expect(await json(res)).toEqual({ code });
    }
    expect(mocks.saveNewWorkspace).not.toHaveBeenCalled();
  });

  it("reports an unexpected failure without the export's contents", async () => {
    mocks.saveNewWorkspace.mockRejectedValue(new Error("database said no to SECRET-NOTE"));
    const res = await POST(upload(exportZip()));
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ code: "failed" });
    const [reported] = mocks.reportError.mock.calls[0] as [Error];
    expect(reported.message).not.toContain("SECRET");
    expect(reported.stack ?? "").not.toContain("SECRET");
  });
});
