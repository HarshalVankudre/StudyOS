import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Workspace } from "@/lib/workspace/types";
import { emit, OPEN_EXPORT_EVENT } from "./events";
import { ExportMenu } from "./ExportMenu";

vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  return { useI18n: () => ({ dict: en, t: fmt, dir: "ltr", locale: "en" }) };
});

const ws: Workspace = {
  id: "w",
  name: "Fall",
  pages: [{ id: "p", title: "Week 1", blocks: [{ id: "b", type: "paragraph", text: "Hello" }] }],
  databases: [
    {
      id: "d",
      name: "Assignments",
      icon: "📚",
      properties: [{ id: "n", name: "Name", type: "text" }],
      rows: [{ id: "r", cells: { n: "=1+1" } }],
      views: [{ id: "v", name: "Table", type: "table" }],
    },
  ],
};

let downloads: { name: string; blob: Blob }[];

beforeEach(() => {
  downloads = [];
  const blobs = new Map<string, Blob>();
  let n = 0;
  URL.createObjectURL = vi.fn((b: Blob) => {
    const url = `blob:${++n}`;
    blobs.set(url, b);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: blobs.get(this.href)! });
  });
});

describe("ExportMenu", () => {
  it("exports from the sheet the palette opens", async () => {
    const user = userEvent.setup();
    render(<ExportMenu workspace={ws} page={ws.pages[0]} />);
    act(() => emit(OPEN_EXPORT_EVENT));
    const csv = await screen.findByRole("button", { name: "📚 Assignments as CSV" });
    await user.click(csv);
    expect(downloads[0].name).toBe("Assignments.csv");
    expect(await downloads[0].blob.text()).toContain("'=1+1");

    act(() => emit(OPEN_EXPORT_EVENT));
    await user.click(await screen.findByRole("button", { name: en.exportMenu.pageMarkdown }));
    expect(downloads[1].name).toBe("Week 1.md");
    expect(await downloads[1].blob.text()).toBe("# Week 1\n\nHello\n");
  });

  it("offers the header menu with every export", async () => {
    const user = userEvent.setup();
    render(<ExportMenu workspace={ws} page={ws.pages[0]} />);
    await user.click(screen.getByRole("button", { name: en.exportMenu.menuLabel }));
    for (const label of [en.exportMenu.pageMarkdown, "📚 Assignments as CSV", en.exportMenu.workspaceZip, en.exportMenu.print]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
  });
});
