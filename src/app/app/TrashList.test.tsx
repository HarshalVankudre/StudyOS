import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { DeleteWorkspaceButton } from "./DeleteWorkspaceButton";
import { TrashList } from "./TrashList";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  trashWorkspaceAction: vi.fn(),
  restoreWorkspaceAction: vi.fn(),
  deleteWorkspaceForeverAction: vi.fn(),
  duplicateWorkspaceAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("./actions", () => ({
  trashWorkspaceAction: mocks.trashWorkspaceAction,
  restoreWorkspaceAction: mocks.restoreWorkspaceAction,
  deleteWorkspaceForeverAction: mocks.deleteWorkspaceForeverAction,
  duplicateWorkspaceAction: mocks.duplicateWorkspaceAction,
}));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  const { pluralizer } = await import("@/lib/i18n/plural");
  return { useI18n: () => ({ dict: en, t: fmt, plural: pluralizer("en"), dir: "ltr", locale: "en" }) };
});

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

beforeEach(() => {
  mocks.trashWorkspaceAction.mockResolvedValue(true);
  mocks.restoreWorkspaceAction.mockResolvedValue(true);
  mocks.deleteWorkspaceForeverAction.mockResolvedValue(true);
  mocks.duplicateWorkspaceAction.mockResolvedValue({ ok: true, id: "copy-1" });
});

const items = [
  { id: "w1", name: "Fall semester", icon: "🍂", purgeAt: "2026-12-12T00:00:00.000Z" },
];

describe("TrashList", () => {
  it("renders nothing when the trash is empty", () => {
    const { container } = render(<TrashList items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("restores a workspace", async () => {
    const user = userEvent.setup();
    render(<TrashList items={items} />);
    await user.click(screen.getByText("Trash (1 workspace)"));
    await user.click(screen.getByRole("button", { name: "Restore Fall semester" }));
    await waitFor(() => expect(mocks.restoreWorkspaceAction).toHaveBeenCalledWith("w1"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("deletes forever only after confirmation", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    render(<TrashList items={items} />);
    await user.click(screen.getByText("Trash (1 workspace)"));
    const button = screen.getByRole("button", { name: "Delete Fall semester forever" });

    await user.click(button);
    expect(confirm).toHaveBeenCalled();
    expect(mocks.deleteWorkspaceForeverAction).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await user.click(button);
    await waitFor(() =>
      expect(mocks.deleteWorkspaceForeverAction).toHaveBeenCalledWith("w1"),
    );
  });
});

describe("workspace card actions", () => {
  it("moves to trash with an Undo toast that restores it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Toaster />
        <DeleteWorkspaceButton id="w1" name="Fall semester" />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Fall semester" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to trash" }));
    await waitFor(() => expect(mocks.trashWorkspaceAction).toHaveBeenCalledWith("w1"));

    expect(await screen.findByText("“Fall semester” moved to trash")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mocks.restoreWorkspaceAction).toHaveBeenCalledWith("w1"));
  });

  it("duplicates a workspace", async () => {
    const user = userEvent.setup();
    render(<DeleteWorkspaceButton id="w1" name="Fall semester" />);
    await user.click(screen.getByRole("button", { name: "Actions for Fall semester" }));
    await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(mocks.duplicateWorkspaceAction).toHaveBeenCalledWith("w1"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("explains why a duplicate was refused (workspace cap)", async () => {
    mocks.duplicateWorkspaceAction.mockResolvedValue({
      ok: false,
      code: "limit",
      message: "You’ve reached the limit of 200 workspaces.",
    });
    const user = userEvent.setup();
    render(
      <>
        <Toaster />
        <DeleteWorkspaceButton id="w1" name="Fall semester" />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Fall semester" }));
    await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));
    expect(await screen.findByText("You’ve reached the limit of 200 workspaces.")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
