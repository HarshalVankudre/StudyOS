// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ip: "198.51.100.1",
  host: "share.example.com",
  load: vi.fn(),
  record: vi.fn(),
  after: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": m.ip, host: m.host, "x-forwarded-proto": "https" }),
}));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));
vi.mock("@/lib/i18n/server", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getI18n: async () => ({ dict: en, locale: "en" }) };
});
vi.mock("@/lib/share/public-share", () => ({ loadPublicShare: m.load }));
vi.mock("@/lib/share/store", () => ({ recordShareView: m.record }));
vi.mock("@/components/share/PublicBlocks", () => ({ PublicBlocks: () => null }));
vi.mock("@/components/share/ReportShareButton", () => ({ ReportShareButton: () => null }));
vi.mock("@/components/share/SaveCopyCard", () => ({ SaveCopyCard: () => null }));
vi.mock("@/components/BrandMark", () => ({ BrandMark: () => null }));

import type { ReactElement } from "react";
import { en } from "@/lib/i18n/dictionaries/en";
import { SHARE_PAGE_VIEWS_PER_WINDOW } from "@/lib/share/throttle";
import SharedPage, { generateMetadata } from "./page";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const props = () => ({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve({}) });

/** Every element of a rendered tree (server output: function components are not expanded). */
function elements(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) for (const child of node) elements(child, out);
  else if (node && typeof node === "object" && "props" in node) {
    out.push(node as ReactElement);
    elements((node as ReactElement<{ children?: unknown; report?: unknown }>).props.children, out);
    elements((node as ReactElement<{ report?: unknown }>).props.report, out);
  }
  return out;
}

let ip = 0;
beforeEach(() => {
  m.ip = `198.51.100.${++ip}`;
  m.load.mockReset().mockResolvedValue({
    share: { id: "share_1", token: TOKEN, userId: "user_owner", workspaceId: "ws", pageId: "pg" },
    view: { title: "Cell biology", blocks: [] },
    assetIds: new Set(),
  });
  m.record.mockReset().mockResolvedValue(true);
  m.after.mockReset();
});

describe("the shared page", () => {
  it("renders the public view, with StudyOS's own origins and the request's for its links", async () => {
    const tree = elements(await SharedPage(props()));
    const blocks = tree.find((el) => (el.props as { origins?: unknown }).origins);
    expect((blocks?.props as { origins: string[] }).origins).toContain("https://share.example.com");
    expect(m.load).toHaveBeenCalledWith(TOKEN);
    // A visitor's view is counted after the response, by their rate-limit bucket.
    expect(m.after).toHaveBeenCalledTimes(1);
  });

  it("is a 404 for a link that does not work", async () => {
    m.load.mockResolvedValue(null);
    await expect(SharedPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(generateMetadata(props())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("titles the page with its public (scrubbed) title and is never indexed", async () => {
    const meta = await generateMetadata(props());
    expect(meta.title).toEqual({ absolute: "Cell biology · StudyOS" });
    expect(meta.robots).toMatchObject({ index: false, follow: false });
  });

  it(`shows a short "too many requests" page past ${SHARE_PAGE_VIEWS_PER_WINDOW} views from one address`, async () => {
    m.ip = "2001:db8:9:9::1";
    for (let i = 0; i < SHARE_PAGE_VIEWS_PER_WINDOW; i += 1) await SharedPage(props());
    expect(m.load).toHaveBeenCalledTimes(SHARE_PAGE_VIEWS_PER_WINDOW);
    // Another address of the same /64 shares the bucket.
    m.ip = "2001:db8:9:9::2";
    const tree = elements(await SharedPage(props()));
    expect(JSON.stringify(tree.map((el) => el.props))).toContain(en.share.tooMany.title);
    expect(m.load).toHaveBeenCalledTimes(SHARE_PAGE_VIEWS_PER_WINDOW);
    const meta = await generateMetadata(props());
    expect(meta.title).toEqual({ absolute: `${en.share.tooMany.title} · StudyOS` });
  });
});
