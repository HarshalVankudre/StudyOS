// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listMaterials: vi.fn(),
  createMaterial: vi.fn(),
  ownsLiveWorkspace: vi.fn(),
  getMaterial: vi.fn(),
  deleteMaterial: vi.fn(),
  checkUsageLimit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/materials/store", () => ({
  listMaterials: mocks.listMaterials,
  createMaterial: mocks.createMaterial,
  ownsLiveWorkspace: mocks.ownsLiveWorkspace,
  getMaterial: mocks.getMaterial,
  deleteMaterial: mocks.deleteMaterial,
}));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: mocks.checkUsageLimit }));

import { GET as LIST, POST as ADD } from "./route";
import { DELETE, GET as PAGE } from "./[id]/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  mocks.ownsLiveWorkspace.mockImplementation(async (user: string, ws: string) => user === "user-1" && ws === "ws-1");
  mocks.checkUsageLimit.mockResolvedValue({ allowed: true, remaining: 5 });
  mocks.listMaterials.mockResolvedValue([]);
  mocks.createMaterial.mockImplementation(async (input: { pages: string[] }) => ({
    ok: true,
    reused: false,
    material: { id: "mat-new", pageCount: input.pages.length },
  }));
  mocks.getMaterial.mockImplementation(async (user: string, id: string) =>
    user === "user-1" && id === "mat-1"
      ? { id: "mat-1", workspaceId: "ws-1", title: "Lecture", pages: ["Page one", "Page two"] }
      : null,
  );
  mocks.deleteMaterial.mockImplementation(async (user: string, id: string) => user === "user-1" && id === "mat-1");
});

describe("material routes", () => {
  it("require a signed-in user", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await LIST(new Request("http://x/api/materials?workspaceId=ws-1"))).status).toBe(401);
    expect((await PAGE(new Request("http://x/api/materials/mat-1?page=1"), params("mat-1"))).status).toBe(401);
    expect((await DELETE(new Request("http://x"), params("mat-1"))).status).toBe(401);
  });

  it("list only the signed-in user's own workspace", async () => {
    expect((await LIST(new Request("http://x/api/materials?workspaceId=ws-1"))).status).toBe(200);
    expect(mocks.listMaterials).toHaveBeenCalledWith("user-1", "ws-1");
    mocks.auth.mockResolvedValue({ userId: "intruder" });
    expect((await LIST(new Request("http://x/api/materials?workspaceId=ws-1"))).status).toBe(404);
  });

  it("show a page only to its owner, and a 404 (not a 403) to anyone else", async () => {
    const own = await PAGE(new Request("http://x/api/materials/mat-1?page=2"), params("mat-1"));
    expect(await own.json()).toEqual({ id: "mat-1", title: "Lecture", page: 2, pageCount: 2, text: "Page two" });
    mocks.auth.mockResolvedValue({ userId: "intruder" });
    const other = await PAGE(new Request("http://x/api/materials/mat-1?page=2"), params("mat-1"));
    expect(other.status).toBe(404);
    expect(mocks.getMaterial).toHaveBeenLastCalledWith("intruder", "mat-1");
  });

  it("validates the page number and the id", async () => {
    expect((await PAGE(new Request("http://x/api/materials/mat-1?page=3"), params("mat-1"))).status).toBe(400);
    expect((await PAGE(new Request("http://x/api/materials/mat-1?page=1e3"), params("mat-1"))).status).toBe(400);
    expect((await PAGE(new Request("http://x"), params("../etc"))).status).toBe(404);
  });

  it("delete only the owner's material", async () => {
    expect((await DELETE(new Request("http://x"), params("mat-1"))).status).toBe(200);
    mocks.auth.mockResolvedValue({ userId: "intruder" });
    expect((await DELETE(new Request("http://x"), params("mat-1"))).status).toBe(404);
  });

  it("store pasted text as page-sized parts, in the user's own workspace only", async () => {
    const text = "Photosynthesis converts light energy into chemical energy. ".repeat(100);
    const add = (workspaceId: string) =>
      ADD(
        new Request("http://x/api/materials", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId, title: "Notes", text }),
        }),
      );
    const response = await add("ws-1");
    expect(response.status).toBe(201);
    const input = mocks.createMaterial.mock.calls[0][0];
    expect(input).toMatchObject({ ownerId: "user-1", workspaceId: "ws-1", kind: "text" });
    expect(input.pages.length).toBeGreaterThan(1);
    expect((await add("ws-other")).status).toBe(404);
  });

  it("refuse an oversized JSON body before reading it, and rate-limit uploads", async () => {
    const big = new Request("http://x/api/materials", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(50 * 1024 * 1024) },
      body: "{}",
    });
    expect((await ADD(big)).status).toBe(413);

    mocks.checkUsageLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const limited = await ADD(
      new Request("http://x/api/materials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: "ws-1", title: "Notes", text: "Enough text to count as material here." }),
      }),
    );
    expect(limited.status).toBe(429);
  });

  it("extract an uploaded PDF page by page", async () => {
    const { multiPagePdf } = await import("@/lib/materials/__fixtures__/pdf");
    const form = new FormData();
    form.append("workspaceId", "ws-1");
    form.append(
      "file",
      new File(
        [new Uint8Array(multiPagePdf([["Page one talks about cells and membranes."], [], ["Page three is about enzymes and catalysis."]]))],
        "Lecture 3.pdf",
        { type: "application/pdf" },
      ),
    );
    const response = await ADD(new Request("http://x/api/materials", { method: "POST", body: form }));
    expect(response.status).toBe(201);
    const input = mocks.createMaterial.mock.calls[0][0];
    expect(input).toMatchObject({ kind: "pdf", title: "Lecture 3", sourcePages: 3 });
    expect(input.pages).toHaveLength(3);
    expect(input.pages[1]).toBe("");
    expect(input.pages[2]).toContain("enzymes and catalysis");
  });
});
