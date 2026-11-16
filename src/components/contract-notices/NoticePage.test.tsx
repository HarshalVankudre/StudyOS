/**
 * /withdraw and /cancel render signed out and signed in (prefilled), survive
 * an unreachable database, and walk form → review → receipt with the
 * statutory buttons, showing the email route whenever something stops it.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";

const m = vi.hoisted(() => ({
  userId: null as string | null,
  locale: "en" as string,
  subscription: vi.fn(),
  ledger: vi.fn(),
  action: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: m.userId }),
  currentUser: async () => ({
    firstName: "Ada",
    lastName: "Lovelace",
    primaryEmailAddress: { emailAddress: "ada@example.com" },
    emailAddresses: [{ emailAddress: "ada@example.com" }],
  }),
}));
vi.mock("@/lib/i18n/server", async () => {
  const { getDictionary } = await import("@/lib/i18n/dictionaries");
  return { getI18n: async () => ({ dict: getDictionary(m.locale as Locale), locale: m.locale }) };
});
vi.mock("@/lib/db", () => ({
  prisma: { subscription: { findUnique: m.subscription }, creditLedger: { findMany: m.ledger } },
}));
vi.mock("@/lib/contract-notices/actions", () => ({ contractNoticeAction: m.action }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.report }));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

import { NoticePage, noticeMetadata } from "./NoticePage";

const en = getDictionary("en").contractNotices;

beforeEach(() => {
  m.userId = null;
  m.locale = "en";
  m.subscription.mockReset().mockResolvedValue(null);
  m.ledger.mockReset().mockResolvedValue([]);
  m.action.mockReset();
  m.report.mockReset();
  vi.stubEnv("STUDYOS_SUPPORT_EMAIL", "help@studyos.app");
  vi.stubEnv("STUDYOS_OPERATOR_NAME", "");
  vi.stubEnv("STUDYOS_OPERATOR_ADDRESS", "");
});
afterEach(() => vi.unstubAllEnvs());

const options = () => within(screen.getByLabelText(en.contractLabel)).getAllByRole("option").map((o) => o.textContent);

describe("the withdrawal page", () => {
  it("works signed out: the generic contracts, nothing prefilled, the email route, not indexed", async () => {
    render(await NoticePage({ kind: "withdrawal" }));
    expect(screen.getByRole("heading", { level: 1, name: en.withdraw.title })).toBeTruthy();
    expect(options()).toEqual([en.chooseOne, en.pro, en.pack, en.other]);
    expect((screen.getByLabelText(en.nameLabel) as HTMLInputElement).value).toBe("");
    expect(screen.getAllByRole("link", { name: "help@studyos.app" })[0]).toHaveAttribute("href", "mailto:help@studyos.app");
    expect(screen.getByRole("button", { name: en.continue })).toBeTruthy();
    expect(m.subscription).not.toHaveBeenCalled();
    expect((await noticeMetadata("withdrawal")).robots).toEqual({ index: false });
  });

  it("signed in, fills in the name, the email and the sender's own contracts", async () => {
    m.userId = "user_1";
    m.subscription.mockResolvedValue({ stripeSubscriptionId: "sub_1", status: "active", currentPeriodEnd: new Date("2026-12-02T09:00:00Z") });
    m.ledger.mockResolvedValue([{ id: "led_1", createdAt: new Date("2026-11-02T10:00:00Z") }]);
    render(await NoticePage({ kind: "withdrawal" }));
    expect((screen.getByLabelText(en.nameLabel) as HTMLInputElement).value).toBe("Ada Lovelace");
    expect((screen.getByLabelText(en.emailLabel) as HTMLInputElement).value).toBe("ada@example.com");
    expect(options()).toEqual([
      en.chooseOne,
      "Pro subscription, paid until December 2, 2026",
      "Credit pack, bought on November 2, 2026",
      en.other,
    ]);
    expect(screen.getByText(en.signedIn)).toBeTruthy();
  });

  it("still renders, with the generic contracts, when the database is unreachable", async () => {
    m.userId = "user_1";
    m.subscription.mockRejectedValue(new Error("connect ECONNREFUSED"));
    render(await NoticePage({ kind: "withdrawal" }));
    expect(options()).toEqual([en.chooseOne, en.pro, en.pack, en.other]);
    expect(m.report).toHaveBeenCalled();
  });
});

describe("the cancellation page", () => {
  it("in German, offers the kind of cancellation and the end date, Pro preselected", async () => {
    m.locale = "de";
    const de = getDictionary("de").contractNotices;
    render(await NoticePage({ kind: "cancellation" }));
    expect(screen.getByRole("heading", { level: 1, name: de.cancel.title })).toBeTruthy();
    expect(screen.getByRole("radio", { name: de.cancel.ordinary })).toBeChecked();
    expect(screen.getByRole("radio", { name: de.cancel.endEarliest })).toBeChecked();
    expect((screen.getByLabelText(de.contractLabel) as HTMLSelectElement).value).toBe("pro");
    // A credit pack is one-off: not offered for cancelling.
    expect(within(screen.getByLabelText(de.contractLabel)).queryByRole("option", { name: de.pack })).toBeNull();
  });
});

describe("the flow", () => {
  const lines = [
    { label: en.lines.declaration, value: en.withdraw.statement },
    { label: en.lines.name, value: "Ada Lovelace" },
  ];
  const values = { name: "Ada Lovelace", email: "ada@example.com", contract: "pro", details: "", cancelType: "ordinary", reason: "", endWhen: "earliest", endDate: "" };
  /** Fill in the required fields (the browser checks them before posting). */
  const fill = (M: typeof en) => {
    fireEvent.change(screen.getByLabelText(M.nameLabel), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByLabelText(M.emailLabel), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText(M.contractLabel), { target: { value: "pro" } });
  };

  it("goes from the form to the review with the statutory confirm button, then to the receipt", async () => {
    m.locale = "de";
    const de = getDictionary("de").contractNotices;
    m.action
      .mockResolvedValueOnce({ step: "review", values, lines, error: null })
      .mockResolvedValueOnce({
        step: "receipt",
        id: "notice_1",
        lines,
        receivedAt: "13. November 2026 um 15:30:00 MEZ (2026-11-13 14:30:00 UTC)",
        ack: "not_configured",
        ackEmail: "ada@example.com",
        proEnds: null,
      });
    render(await NoticePage({ kind: "withdrawal" }));
    fill(de);
    fireEvent.click(screen.getByRole("button", { name: de.continue }));
    const confirm = await screen.findByRole("button", { name: "Widerruf bestätigen" });
    const posted = m.action.mock.calls[0][1] as FormData;
    expect([posted.get("kind"), posted.get("intent"), posted.get("name"), posted.get("contract")]).toEqual([
      "withdrawal",
      "review",
      "Ada Lovelace",
      "pro",
    ]);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    // The review posts everything back, with the honeypot.
    const form = confirm.closest("form")!;
    expect((form.querySelector('input[name="email"]') as HTMLInputElement).value).toBe("ada@example.com");
    expect(form.querySelector('input[name="website"]')).not.toBeNull();
    fireEvent.click(confirm);
    expect(await screen.findByRole("heading", { name: de.withdraw.receiptTitle })).toBeTruthy();
    expect(screen.getByText(/2026-11-13 14:30:00 UTC/)).toBeTruthy();
    expect(screen.getByText("notice_1")).toBeTruthy();
    // No email could be sent: print/save this page, and the address to write to.
    expect(screen.getByRole("status").textContent).toContain("help@studyos.app");
    expect(screen.getByRole("button", { name: de.receipt.print })).toBeTruthy();
  });

  it("shows field errors tied to their fields, and a refusal with the email route", async () => {
    m.action
      // The browser's own check passes "ada@example"; the server's does not.
      .mockResolvedValueOnce({ step: "form", key: "k1", values: { ...values, email: "ada@example" }, errors: { email: "invalid" }, error: null })
      .mockResolvedValueOnce({ step: "review", values, lines, error: null })
      .mockResolvedValueOnce({ step: "review", values, lines, error: "rate_limited" });
    render(await NoticePage({ kind: "withdrawal" }));
    fill(en);
    fireEvent.click(screen.getByRole("button", { name: en.continue }));
    const message = await screen.findByText(en.errors.invalidEmail);
    const input = screen.getByLabelText(en.emailLabel);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(message.id);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect((input as HTMLInputElement).value).toBe("ada@example");

    fireEvent.click(screen.getByRole("button", { name: en.continue }));
    fireEvent.click(await screen.findByRole("button", { name: en.withdraw.confirm }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(en.errors.rateLimited);
    expect(within(alert).getByRole("link", { name: "help@studyos.app" })).toHaveAttribute("href", "mailto:help@studyos.app");
  });
});
