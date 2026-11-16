import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";

const m = vi.hoisted(() => ({ send: vi.fn(), summary: vi.fn() }));

vi.mock("@/app/app/feedback-actions", () => ({ sendFeedbackAction: m.send }));
vi.mock("@/app/app/account-actions", () => ({ getAccountSummaryAction: m.summary }));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { fullName: "Sam", firstName: "Sam", primaryEmailAddress: { emailAddress: "s@uni.edu" } } }),
  useClerk: () => ({ openUserProfile: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  const { pluralizer } = await import("@/lib/i18n/plural");
  return { useI18n: () => ({ dict: en, t: fmt, plural: pluralizer("en"), dir: "ltr", locale: "en" }) };
});

import { resetCreditsBusForTests } from "@/lib/credits-bus";
import { emit, OPEN_FEEDBACK_EVENT } from "@/components/command/events";
import { AccountMenu } from "./AccountMenu";
import { FeedbackDialog } from "./FeedbackDialog";
import { FeedbackHost } from "./FeedbackHost";

const F = en.feedback;

beforeEach(() => {
  m.send.mockReset().mockResolvedValue({ ok: true });
  m.summary.mockReset();
  resetCreditsBusForTests();
  window.history.replaceState({}, "", "/app/w1?page=p2#block-4");
});

function renderDialog() {
  const onOpenChange = vi.fn();
  render(<FeedbackDialog open onOpenChange={onOpenChange} />);
  return { onOpenChange, message: screen.getByRole("textbox", { name: F.messageLabel }) };
}

describe("FeedbackDialog", () => {
  it("sends the kind, message, page path, language and contact choice, then thanks the student", async () => {
    const user = userEvent.setup();
    const { message } = renderDialog();
    await user.click(screen.getByRole("radio", { name: F.kinds.idea }));
    await user.type(message, "  Please add a dark flashcard theme  ");
    await user.click(screen.getByRole("checkbox", { name: F.contactOk }));
    await user.click(screen.getByRole("button", { name: F.send }));

    expect(m.send).toHaveBeenCalledWith({
      kind: "idea",
      message: "Please add a dark flashcard theme",
      pagePath: "/app/w1",
      locale: "en",
      contactOk: true,
    });
    expect(await screen.findByText(F.thanksTitle)).toBeInTheDocument();
    expect(screen.getByText(`${F.thanksBody} ${F.thanksContact}`)).toBeInTheDocument();
  });

  it("starts as a bug report without permission to email", async () => {
    const user = userEvent.setup();
    const { message } = renderDialog();
    expect(screen.getByRole("radio", { name: F.kinds.bug })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: F.contactOk })).not.toBeChecked();
    await user.type(message, "The timer froze");
    await user.click(screen.getByRole("button", { name: F.send }));
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "bug", contactOk: false }));
    expect(await screen.findByText(F.thanksBody)).toBeInTheDocument();
  });

  it("asks for a longer message before sending anything", async () => {
    const user = userEvent.setup();
    const { message } = renderDialog();
    await user.type(message, " hi ");
    await user.click(screen.getByRole("button", { name: F.send }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please write at least 5 characters.");
    expect(message).toHaveAttribute("aria-invalid", "true");
    expect(m.send).not.toHaveBeenCalled();
  });

  it("says so when the student has sent too many messages", async () => {
    m.send.mockResolvedValue({ ok: false, error: "rate_limited" });
    const user = userEvent.setup();
    const { message } = renderDialog();
    await user.type(message, "Another idea for you");
    await user.click(screen.getByRole("button", { name: F.send }));
    expect(await screen.findByRole("alert")).toHaveTextContent(F.errors.rateLimited);
    // The message is kept so it can be sent later.
    expect(message).toHaveValue("Another idea for you");
  });

  it("explains a refused message and a failed send", async () => {
    const user = userEvent.setup();
    const { message } = renderDialog();
    await user.type(message, "Something odd happened");
    m.send.mockResolvedValueOnce({ ok: false, error: "invalid" });
    await user.click(screen.getByRole("button", { name: F.send }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please write between 5 and 4,000 characters.");
    m.send.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    // The button reads "Sending…" until the first send settles: wait for it.
    await user.click(await screen.findByRole("button", { name: F.send }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(F.errors.failed));
  });

  it("closes with Cancel", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    await user.click(screen.getByRole("button", { name: F.cancel }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("FeedbackHost", () => {
  it("opens the dialog when asked to, from anywhere", async () => {
    render(<FeedbackHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => emit(OPEN_FEEDBACK_EVENT));
    expect(await screen.findByRole("dialog", { name: F.title })).toBeInTheDocument();
  });
});

describe("account menu", () => {
  it("offers Send feedback, which opens the dialog", async () => {
    m.summary.mockResolvedValue({ pro: false, credits: 10, billing: false, admin: false });
    const opened = vi.fn();
    window.addEventListener(OPEN_FEEDBACK_EVENT, opened);
    const user = userEvent.setup();
    render(<AccountMenu variant="header" />);
    await user.click(screen.getByRole("button", { name: /View profile/ }));
    await user.click(await screen.findByRole("menuitem", { name: new RegExp(F.open) }));
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_FEEDBACK_EVENT, opened);
  });

  it("links the operator console only for an admin", async () => {
    const user = userEvent.setup();
    m.summary.mockResolvedValue({ pro: false, credits: 10, billing: false, admin: false });
    const { unmount } = render(<AccountMenu variant="header" />);
    await user.click(screen.getByRole("button", { name: /View profile/ }));
    await screen.findByText("10 credits");
    expect(screen.queryByRole("menuitem", { name: /Operator console/ })).toBeNull();
    unmount();

    m.summary.mockResolvedValue({ pro: false, credits: 10, billing: false, admin: true });
    render(<AccountMenu variant="header" />);
    await user.click(screen.getByRole("button", { name: /View profile/ }));
    expect(await screen.findByRole("menuitem", { name: /Operator console/ })).toHaveAttribute("href", "/app/admin");
  });
});
