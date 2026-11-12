import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({
    dict: {
      settings: {
        downloadData: "Download my data",
        preparingData: "Preparing your file…",
        downloadDataError: "Download failed",
        downloadDataLimit: "Try again tomorrow",
      },
    },
  }),
}));

import { DownloadDataButton } from "./DownloadDataButton";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("DownloadDataButton", () => {
  it("downloads the export as a file", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"ok":1}', {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="studyos-data-2026-11-12.json"' },
      }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<DownloadDataButton />);
    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/account/export", { cache: "no-store" });
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("studyos-data-2026-11-12.json");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains the daily limit", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 429 }));
    render(<DownloadDataButton />);
    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again tomorrow");
  });

  it("shows an error when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<DownloadDataButton />);
    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Download failed");
    expect(screen.getByRole("button", { name: "Download my data" })).toBeEnabled();
  });
});
