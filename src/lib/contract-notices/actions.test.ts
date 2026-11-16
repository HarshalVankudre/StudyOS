/**
 * The withdrawal function and the cancellation button, end to end at the
 * action level: form → review → confirm, what is stored, the two emails, the
 * Stripe path for a signed-in subscriber, and every way it can be refused
 * (always with the email route).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";

const m = vi.hoisted(() => ({
  userId: null as string | null,
  ip: "203.0.113.1",
  locale: "en" as string,
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  subscription: vi.fn(),
  ledger: vi.fn(),
  schedule: vi.fn(),
  send: vi.fn(),
  configured: true,
  report: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": m.ip }) }));
vi.mock("@/lib/i18n/server", async () => {
  const { getDictionary } = await import("@/lib/i18n/dictionaries");
  return { getI18n: async () => ({ dict: getDictionary(m.locale as Locale), locale: m.locale }) };
});
vi.mock("@/lib/db", () => ({
  prisma: {
    contractNotice: { count: m.count, create: m.create, update: m.update },
    subscription: { findUnique: m.subscription },
    creditLedger: { findFirst: m.ledger },
  },
}));
vi.mock("@/lib/billing", () => ({ scheduleCancellationAtPeriodEnd: m.schedule }));
vi.mock("@/lib/email/mailer", () => ({ sendMail: m.send }));
vi.mock("@/lib/email/config", () => ({ emailConfigured: () => m.configured }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.report }));

import { contractNoticeAction, type NoticeState } from "./actions";
import { NOTICES_GLOBAL_DAILY_CAP, NOTICES_PER_ADDRESS_PER_HOUR } from "./config";
import { EMPTY_VALUES, type NoticeValues } from "./form";

const NOW = new Date("2026-11-13T14:30:00Z");
const en = getDictionary("en").contractNotices;
const initial: NoticeState = { step: "form", key: "initial", values: EMPTY_VALUES, errors: {}, error: null };

let seq = 0;
/** A fresh visitor (address and email) per test: the in-memory limits outlive a test. */
function visitor() {
  seq += 1;
  m.ip = `203.0.113.${seq}`;
  return `ada${seq}@example.com`;
}

function form(kind: string, intent: string, values: Partial<NoticeValues>, extra: Record<string, string> = {}) {
  const data = new FormData();
  data.set("kind", kind);
  data.set("intent", intent);
  for (const [name, value] of Object.entries({ ...EMPTY_VALUES, ...values })) data.set(name, value);
  for (const [name, value] of Object.entries(extra)) data.set(name, value);
  return data;
}

const run = (data: FormData) => contractNoticeAction(initial, data);
type Mail = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> };
const mails = () => m.send.mock.calls.map((c) => c[0] as Mail);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  m.userId = null;
  m.locale = "en";
  m.configured = true;
  m.count.mockReset().mockResolvedValue(0);
  m.create.mockReset().mockResolvedValue({ id: "notice_1" });
  m.update.mockReset().mockResolvedValue({});
  m.subscription.mockReset().mockResolvedValue(null);
  m.ledger.mockReset().mockResolvedValue(null);
  m.schedule.mockReset();
  m.send.mockReset().mockResolvedValue({ kind: "sent", messageId: "m1" });
  m.report.mockReset();
  vi.stubEnv("STUDYOS_OPERATOR_NAME", "Example Learning GmbH");
  vi.stubEnv("STUDYOS_OPERATOR_ADDRESS", "Musterstraße 1|10115 Berlin");
  vi.stubEnv("STUDYOS_OPERATOR_EMAIL", "legal@example.org");
  vi.stubEnv("APP_URL", "https://app.example.org");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("withdrawal, signed out", () => {
  it("shows exactly what will be sent before anything is stored", async () => {
    const email = visitor();
    const state = await run(form("withdrawal", "review", { name: "Ada Lovelace", email, contract: "pack", details: "Bought 2 Nov" }));
    expect(state.step).toBe("review");
    if (state.step !== "review") return;
    expect(state.error).toBeNull();
    expect(state.lines).toEqual([
      { label: en.lines.declaration, value: en.withdraw.statement },
      { label: en.lines.to, value: "Example Learning GmbH, Musterstraße 1, 10115 Berlin" },
      { label: en.lines.contract, value: en.pack },
      { label: en.lines.details, value: "Bought 2 Nov" },
      { label: en.lines.name, value: "Ada Lovelace" },
      { label: en.lines.email, value: email },
    ]);
    expect(m.create).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("stores it on confirm with the server's time of receipt, and acknowledges receipt (only) by email", async () => {
    const email = visitor();
    const state = await run(form("withdrawal", "confirm", { name: "Ada <b>Lovelace</b>", email, contract: "pack" }));

    expect(m.create).toHaveBeenCalledWith({
      data: {
        kind: "withdrawal",
        userId: null,
        name: "Ada <b>Lovelace</b>",
        email,
        contractKind: "pack",
        contractRef: null,
        details: null,
        cancelType: null,
        reason: null,
        requestedEnd: null,
        locale: "en",
        receivedAt: NOW,
      },
      select: { id: true },
    });
    // Never processed automatically: the row stays open, Stripe untouched.
    expect(m.schedule).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith({ where: { id: "notice_1" }, data: { ackStatus: "sent", operatorNotified: true } });

    const [ack, operator] = [mails().find((x) => x.to === email)!, mails().find((x) => x.to === "legal@example.org")!];
    expect(ack.subject).toBe(en.withdraw.emailSubject);
    expect(ack.text).toContain("We received your withdrawal declaration on");
    expect(ack.text).toContain("(2026-11-13 14:30:00 UTC)");
    expect(ack.text).toMatch(/3:30:00\s?PM GMT\+1/);
    expect(ack.text).toContain(en.email.receiptOnly);
    expect(ack.text).toContain(`${en.lines.declaration}: ${en.withdraw.statement}`);
    expect(ack.text).toContain(`${en.lines.reference}: notice_1`);
    expect(ack.text).not.toMatch(/accept|is valid|approved/i);
    // Escaped in HTML; no unsubscribe link and no List-Unsubscribe (transactional).
    expect(ack.html).toContain("Ada &lt;b&gt;Lovelace&lt;/b&gt;");
    expect(ack.html).not.toContain("<b>Lovelace");
    expect(ack.html).not.toMatch(/unsubscribe/i);
    expect(ack.headers).toEqual({ "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "OOF, AutoReply" });
    // The operator's address is the legal notice's, and their notification says what to do.
    expect(operator.subject).toBe("New withdrawal notice received");
    expect(operator.text).toContain("Account: not signed in");
    expect(operator.text).toContain("never processed automatically");
    expect(operator.text).toContain("https://app.example.org/app/admin#contract-notices");

    expect(state).toMatchObject({
      step: "receipt",
      id: "notice_1",
      ack: "sent",
      ackEmail: email,
      proEnds: null,
      receivedAt: expect.stringContaining("2026-11-13 14:30:00 UTC"),
    });
  });

  it("with email off, stores it and says on the receipt that no acknowledgement could be emailed", async () => {
    m.configured = false;
    const email = visitor();
    const state = await run(form("withdrawal", "confirm", { name: "Ada", email, contract: "pro" }));
    expect(m.send).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith({
      where: { id: "notice_1" },
      data: { ackStatus: "not_configured", operatorNotified: false },
    });
    expect(state).toMatchObject({ step: "receipt", ack: "not_configured" });
  });

  it("when the acknowledgement cannot be sent, still gives the receipt and reports it", async () => {
    const email = visitor();
    m.send.mockImplementation(async (mail: Mail) =>
      mail.to === email ? { kind: "temporary", code: null, reason: "network" } : { kind: "sent", messageId: "x" },
    );
    const state = await run(form("withdrawal", "confirm", { name: "Ada", email, contract: "pro" }));
    expect(state).toMatchObject({ step: "receipt", ack: "failed" });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "notice_1" }, data: { ackStatus: "failed", operatorNotified: true } });
    expect(m.report).toHaveBeenCalled();
  });

  it("when the database is down, says it was not sent (with the email route), never crashes", async () => {
    m.create.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const state = await run(form("withdrawal", "confirm", { name: "Ada", email: visitor(), contract: "pro" }));
    expect(state).toMatchObject({ step: "review", error: "failed" });
    expect(m.send).not.toHaveBeenCalled();
    expect(m.report).toHaveBeenCalled();
  });

  it("sends a form with errors back with the values, and 'Change details' back to the form", async () => {
    const bad = await run(form("withdrawal", "review", { name: "", email: "nope", contract: "" }));
    expect(bad).toEqual({
      step: "form",
      key: expect.any(String),
      values: { ...EMPTY_VALUES, email: "nope" },
      errors: { name: "required", email: "invalid", contract: "required" },
      error: null,
    });
    const back = await run(form("withdrawal", "edit", { name: "Ada", email: "a@b.co", contract: "pro" }));
    expect(back).toMatchObject({ step: "form", values: { name: "Ada" }, errors: {} });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("names a pack only when it is the sender's own", async () => {
    const email = visitor();
    // Signed out, a named pack cannot be anyone's.
    expect(await run(form("withdrawal", "review", { name: "Ada", email, contract: "pack:clx1" }))).toMatchObject({
      step: "form",
      errors: { contract: "invalid" },
    });
    m.userId = "user_1";
    m.ledger.mockResolvedValue({ createdAt: new Date("2026-11-02T10:00:00Z"), idempotencyKey: "credit_purchase:cs_123" });
    await run(form("withdrawal", "confirm", { name: "Ada", email, contract: "pack:clx1" }));
    expect(m.ledger).toHaveBeenCalledWith({
      where: { id: "clx1", userId: "user_1", reason: "credit_purchase" },
      select: { createdAt: true, idempotencyKey: true },
    });
    expect(m.create.mock.calls[0][0].data).toMatchObject({ userId: "user_1", contractKind: "pack", contractRef: "cs_123" });
    expect(mails().find((x) => x.to === email)!.text).toContain("Credit pack, bought on November 2, 2026");
  });
});

describe("abuse limits never dead-end", () => {
  it("a filled-in honeypot stores and sends nothing", async () => {
    const state = await run(form("withdrawal", "confirm", { name: "Bot", email: visitor(), contract: "pro" }, { website: "spam.example" }));
    expect(state).toMatchObject({ step: "review", error: "failed" });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("limits confirmations per address; the visitor is told (the page then shows the email route)", async () => {
    visitor();
    for (let i = 0; i < NOTICES_PER_ADDRESS_PER_HOUR; i++) {
      const state = await run(form("withdrawal", "confirm", { name: "Ada", email: `same-ip-${i}@example.com`, contract: "pro" }));
      expect(state.step).toBe("receipt");
    }
    const refused = await run(form("withdrawal", "confirm", { name: "Ada", email: "another@example.com", contract: "pro" }));
    expect(refused).toMatchObject({ step: "review", error: "rate_limited" });
    expect(m.create).toHaveBeenCalledTimes(NOTICES_PER_ADDRESS_PER_HOUR);
    // Reviewing is never limited.
    expect(await run(form("withdrawal", "review", { name: "Ada", email: "x@example.com", contract: "pro" }))).toMatchObject({
      step: "review",
      error: null,
    });
  });

  it("refuses past the global daily cap, and reports it so the owner sees", async () => {
    m.count.mockResolvedValue(NOTICES_GLOBAL_DAILY_CAP);
    const state = await run(form("cancellation", "confirm", { name: "Ada", email: visitor(), contract: "pro" }));
    expect(state).toMatchObject({ step: "review", error: "busy" });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.report).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/cap/) }), expect.anything());
  });
});

describe("cancellation", () => {
  const PERIOD_END = new Date("2026-12-02T09:00:00Z");

  it("schedules a signed-in subscriber's ordinary cancellation in Stripe and says when Pro ends", async () => {
    m.userId = "user_1";
    m.subscription.mockResolvedValue({ stripeSubscriptionId: "sub_1", status: "active", currentPeriodEnd: PERIOD_END });
    m.schedule.mockResolvedValue({ outcome: "scheduled", subscriptionId: "sub_1", endsAt: PERIOD_END });
    const email = visitor();
    const state = await run(form("cancellation", "confirm", { name: "Ada", email, contract: "pro" }));

    expect(m.schedule).toHaveBeenCalledWith("user_1");
    expect(m.create.mock.calls[0][0].data).toMatchObject({
      kind: "cancellation",
      userId: "user_1",
      contractKind: "pro",
      contractRef: "sub_1",
      cancelType: "ordinary",
      requestedEnd: null,
    });
    expect(m.update).toHaveBeenCalledWith({
      where: { id: "notice_1" },
      data: {
        status: "done",
        handledAt: NOW,
        stripeOutcome: "scheduled",
        proEndsAt: PERIOD_END,
        ackStatus: "sent",
        operatorNotified: true,
      },
    });
    expect(state).toMatchObject({ step: "receipt", proEnds: "December 2, 2026" });
    const ack = mails().find((x) => x.to === email)!;
    expect(ack.subject).toBe(en.cancel.emailSubject);
    expect(ack.text).toContain("We received your cancellation on");
    expect(ack.text).toContain("Your Pro subscription ends on December 2, 2026 and won’t renew.");
    expect(mails().find((x) => x.to === "legal@example.org")!.text).toContain("Stripe updated");
  });

  it("keeps it open for the operator when Stripe fails, and reports it", async () => {
    m.userId = "user_1";
    m.schedule.mockRejectedValue(new Error("Stripe is unreachable"));
    const email = visitor();
    const state = await run(form("cancellation", "confirm", { name: "Ada", email, contract: "pro" }));
    expect(state).toMatchObject({ step: "receipt", proEnds: null, ack: "sent" });
    const data = m.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ stripeOutcome: "failed", proEndsAt: null });
    expect(data.status).toBeUndefined();
    expect(m.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ route: "scheduleCancellationAtPeriodEnd" }));
    expect(mails().find((x) => x.to === email)!.text).toContain(en.cancel.next);
    expect(mails().find((x) => x.to === "legal@example.org")!.text).toContain("Stripe update FAILED");
  });

  it("leaves extraordinary, dated and signed-out cancellations to the operator", async () => {
    m.userId = "user_1";
    await run(form("cancellation", "confirm", { name: "Ada", email: visitor(), contract: "pro", cancelType: "extraordinary", reason: "Broken" }));
    await run(form("cancellation", "confirm", { name: "Ada", email: visitor(), contract: "pro", endWhen: "date", endDate: "2027-01-31" }));
    m.userId = null;
    await run(form("cancellation", "confirm", { name: "Ada", email: visitor(), contract: "pro" }));
    expect(m.schedule).not.toHaveBeenCalled();
    expect(m.create).toHaveBeenCalledTimes(3);
    expect(m.create.mock.calls[0][0].data).toMatchObject({ cancelType: "extraordinary", reason: "Broken" });
    expect(m.create.mock.calls[1][0].data).toMatchObject({ requestedEnd: "2027-01-31" });
    for (const [call] of m.update.mock.calls) expect(call.data.status).toBeUndefined();
  });

  it("speaks the visitor's language, in the review and the acknowledgement, and English to the operator", async () => {
    m.locale = "de";
    const de = getDictionary("de").contractNotices;
    const email = visitor();
    const review = await run(form("cancellation", "review", { name: "Ada", email, contract: "pro" }));
    expect(review).toMatchObject({ step: "review" });
    if (review.step === "review") expect(review.lines[0]).toEqual({ label: de.lines.declaration, value: de.cancel.statementOrdinary });
    await run(form("cancellation", "confirm", { name: "Ada", email, contract: "pro" }));
    const ack = mails().find((x) => x.to === email)!;
    expect(ack.subject).toBe(de.cancel.emailSubject);
    expect(ack.html).toContain('lang="de"');
    expect(ack.text).toContain("MEZ");
    expect(mails().find((x) => x.to === "legal@example.org")!.text).toContain(en.cancel.statementOrdinary);
    expect(m.create.mock.calls[0][0].data.locale).toBe("de");
  });
});
