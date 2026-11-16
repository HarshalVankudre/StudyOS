import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import type { NotionImportDone, NotionUploadResult, UploadOptions } from "./notion-upload";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("./notion-upload", () => ({ uploadNotionExport: mocks.upload }));

import { NotionImportDialog } from "./NotionImportDialog";

const N = en.notionImport;

const DONE: NotionImportDone = {
  workspaceId: "ws-9",
  name: "Biology",
  summary: {
    pages: 3,
    databases: 1,
    rows: 5,
    images: 0,
    skipped: [
      { reason: "attachment", count: 2, examples: ["Syllabus.pdf", "Notes.docx"] },
      { reason: "page_limit", count: 12, examples: ["Archive"] },
    ],
  },
};

function renderDialog(locale: "en" | "ar" = "en") {
  const onOpenChange = vi.fn();
  render(
    <I18nProvider locale={locale} dictionary={locale === "ar" ? ar : en}>
      <NotionImportDialog open onOpenChange={onOpenChange} />
    </I18nProvider>,
  );
  return { onOpenChange };
}

const zip = (name = "Export.zip", size?: number) => {
  const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, { type: name.endsWith(".zip") ? "application/zip" : "application/pdf" });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
};

const fileInput = () => screen.getByLabelText(N.choose, { selector: "input" }) as HTMLInputElement;

beforeEach(() => {
  mocks.upload.mockResolvedValue({ ok: true, data: DONE } satisfies NotionUploadResult);
});

describe("NotionImportDialog", () => {
  it("explains how to export from Notion and waits for a file", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: N.title })).toBeInTheDocument();
    expect(screen.getByText(N.step1)).toBeInTheDocument();
    expect(screen.getByText(N.step2)).toBeInTheDocument();
    expect(screen.getByText(fmt(N.fileHint, { size: "25 MB" }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: N.start })).toBeDisabled();
  });

  it("imports the chosen zip, shows what came across and what did not, then opens the workspace", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    await user.upload(fileInput(), zip());
    expect(screen.getByText(fmt(N.selected, { name: "Export.zip" }))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: N.start }));

    expect(await screen.findByRole("heading", { name: N.doneTitle })).toBeInTheDocument();
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ name: "Export.zip" }), expect.any(Object));
    expect(screen.getByText(fmt(N.doneBody, { name: "Biology" }))).toBeInTheDocument();
    for (const label of ["3 pages", "1 table", "5 rows"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(/images?$/)).not.toBeInTheDocument();

    const skipped = screen.getByRole("region", { name: N.skippedTitle });
    expect(within(skipped).getByText(N.reasons.attachment)).toBeInTheDocument();
    expect(within(skipped).getByText("Syllabus.pdf, Notes.docx")).toBeInTheDocument();
    expect(within(skipped).getByText(fmt(N.reasons.page_limit, { max: "500" }))).toBeInTheDocument();
    expect(within(skipped).getByText("12")).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: N.open }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.push).toHaveBeenCalledWith("/app/ws-9");
  });

  it("shows upload progress, then that the workspace is being built", async () => {
    const user = userEvent.setup();
    let finish: (result: NotionUploadResult) => void = () => {};
    let options: UploadOptions = {};
    mocks.upload.mockImplementation((_file: File, opts: UploadOptions) => {
      options = opts;
      return new Promise((resolve) => (finish = resolve));
    });
    renderDialog();
    await user.upload(fileInput(), zip());
    await user.click(screen.getByRole("button", { name: N.start }));

    act(() => options.onProgress?.(0.5));
    expect(screen.getByText(fmt(N.uploading, { percent: "50%" }))).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    act(() => options.onSent?.());
    expect(screen.getByText(N.building)).toBeInTheDocument();
    // Nothing to cancel while the server builds the workspace.
    expect(screen.getByRole("button", { name: N.cancel })).toBeDisabled();

    await act(async () => finish({ ok: true, data: DONE }));
    expect(await screen.findByRole("heading", { name: N.doneTitle })).toBeInTheDocument();
  });

  it("refuses a file that is not a zip or is too large before uploading", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderDialog();
    await user.upload(fileInput(), zip("Notes.pdf"));
    expect(screen.getByRole("alert")).toHaveTextContent(N.errors.not_zip);
    await user.upload(fileInput(), zip("Huge.zip", 60 * 1024 * 1024));
    expect(screen.getByRole("alert")).toHaveTextContent(fmt(N.errors.too_large, { size: "25 MB" }));
    expect(screen.getByRole("button", { name: N.start })).toBeDisabled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("says clearly what went wrong on the server, and lets the student try again", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.upload(fileInput(), zip());
    const cases: [NotionUploadResult, string][] = [
      [{ ok: false, code: "not_notion" }, N.errors.not_notion],
      [{ ok: false, code: "workspace_limit", max: 200 }, fmt(en.limits.workspaceCap, { max: "200" })],
      [{ ok: false, code: "too_large" }, fmt(N.errors.too_large, { size: "25 MB" })],
      [{ ok: false, code: "network" }, N.errors.network],
      [{ ok: false, code: "something_new" }, N.errors.failed],
    ];
    for (const [result, message] of cases) {
      mocks.upload.mockResolvedValueOnce(result);
      await user.click(screen.getByRole("button", { name: N.start }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(message));
      expect(screen.getByRole("button", { name: N.start })).toBeEnabled();
    }
  });

  it("takes a dropped zip", () => {
    renderDialog();
    fireEvent.drop(screen.getByTestId("notion-drop-zone"), { dataTransfer: { files: [zip("Dropped.zip")] } });
    expect(screen.getByText(fmt(N.selected, { name: "Dropped.zip" }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: N.start })).toBeEnabled();
  });

  it("cancels an upload in progress", async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    mocks.upload.mockImplementation(
      (_file: File, opts: UploadOptions) =>
        new Promise((resolve) => {
          signal = opts.signal;
          opts.signal?.addEventListener("abort", () => resolve({ ok: false, code: "aborted" }));
        }),
    );
    const { onOpenChange } = renderDialog();
    await user.upload(fileInput(), zip());
    await user.click(screen.getByRole("button", { name: N.start }));
    await user.click(screen.getByRole("button", { name: N.cancel }));
    expect(signal?.aborted).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("speaks Arabic, counts included", async () => {
    const user = userEvent.setup();
    renderDialog("ar");
    expect(screen.getByRole("heading", { name: ar.notionImport.title })).toBeInTheDocument();
    await user.upload(screen.getByLabelText(ar.notionImport.choose, { selector: "input" }), zip());
    await user.click(screen.getByRole("button", { name: ar.notionImport.start }));
    expect(await screen.findByText("جدول واحد")).toBeInTheDocument();
  });
});
