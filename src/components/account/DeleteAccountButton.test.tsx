import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";

const m = vi.hoisted(() => ({ del: vi.fn() }));
vi.mock("@/app/app/account-actions", () => ({ deleteAccountAction: m.del }));
vi.mock("@/components/notifications/push-client", () => ({ clearPushBeforeSignOut: async () => {} }));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { useI18n: () => ({ dict: en, locale: "en", dir: "ltr" }) };
});

import { DeleteAccountButton } from "./DeleteAccountButton";

const S = en.settings;

beforeEach(() => {
  m.del.mockReset().mockResolvedValue(undefined);
});

describe("DeleteAccountButton", () => {
  it("asks first, in the page, and deletes nothing until confirmed", async () => {
    render(<DeleteAccountButton />);
    await userEvent.click(screen.getByRole("button", { name: S.deleteAccountButton }));
    expect(screen.getByRole("heading", { name: S.deleteConfirmTitle })).toHaveFocus();
    expect(m.del).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: S.deleteCancel }));
    expect(screen.queryByRole("heading", { name: S.deleteConfirmTitle })).toBeNull();
    expect(m.del).not.toHaveBeenCalled();
  });

  it("deletes without an answer when none is given", async () => {
    render(<DeleteAccountButton />);
    await userEvent.click(screen.getByRole("button", { name: S.deleteAccountButton }));
    await userEvent.click(screen.getByRole("button", { name: S.deleteConfirmButton }));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith(undefined));
  });

  it("sends the chosen reason and note along", async () => {
    render(<DeleteAccountButton />);
    await userEvent.click(screen.getByRole("button", { name: S.deleteAccountButton }));
    expect(screen.getByRole("group", { name: S.deleteReasonLegend })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: S.deleteReasons.finished }));
    await userEvent.type(screen.getByLabelText(S.deleteNoteLabel), "Exams are over");
    await userEvent.click(screen.getByRole("button", { name: S.deleteConfirmButton }));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith({ reason: "finished", note: "Exams are over" }));
  });

  it("says when billing could not be stopped and nothing was deleted", async () => {
    m.del.mockResolvedValue({ error: "billing_cancel_failed" });
    render(<DeleteAccountButton />);
    await userEvent.click(screen.getByRole("button", { name: S.deleteAccountButton }));
    await userEvent.click(screen.getByRole("button", { name: S.deleteConfirmButton }));
    expect(await screen.findByRole("alert")).toHaveTextContent(S.deleteAccountError);
  });
});
