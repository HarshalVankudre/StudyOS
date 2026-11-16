// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({}) }));
const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ops/report-error", () => ({ reportError }));

import type { AddressBook, AddressLookup } from "@/lib/email/address";
import type { MailOutcome, OutgoingMail } from "@/lib/email/mailer";
import { unsubscribeKey, verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { dailyPlanMessage, testEmailMessage } from "./content";
import { runNotificationDispatch } from "./dispatch";
import {
  MAX_REFUSALS_PER_RUN,
  createDormantEmailChannel,
  createEmailChannel,
  type EmailPreference,
  type EmailPreferenceStore,
} from "./email-channel";
import { FakeChannel, MemoryStore, planItem } from "./test-fakes";

const KEY = unsubscribeKey({ CLERK_SECRET_KEY: "sk_test_email_channel" })!;
const ORIGIN = "https://app.studyos.test";
/** A stand-in for the keyed hash (lib/email/bounce): stable and readable. */
const hashOf = (address: string) => `h:${address.trim().toLowerCase()}`;

let prefs: Map<string, EmailPreference>;
let addresses: Map<string, AddressLookup>;
let outbox: OutgoingMail[];
let nextOutcome: MailOutcome;
let bounced: { userId: string; at: Date; hash: string | null }[];
let lifted: { userId: string; at?: Date }[];

const store: EmailPreferenceStore = {
  get: async (userId) => {
    const pref = prefs.get(userId);
    return pref ? { ...pref } : null;
  },
  markBounced: async (userId, at, hash) => {
    bounced.push({ userId, at, hash });
    const pref = prefs.get(userId);
    if (pref && !pref.emailBouncedAt) Object.assign(pref, { emailBouncedAt: at, emailBouncedHash: hash });
  },
  clearBounce: async (userId, at) => {
    lifted.push({ userId, ...(at ? { at } : {}) });
    const pref = prefs.get(userId);
    if (pref?.emailBouncedAt && (!at || pref.emailBouncedAt.getTime() === at.getTime())) {
      Object.assign(pref, { emailBouncedAt: null, emailBouncedHash: null });
    }
  },
};
const book: AddressBook = { lookup: async (userId) => addresses.get(userId) ?? { kind: "missing" } };

function channel(overrides: Partial<Parameters<typeof createEmailChannel>[0]> = {}) {
  return createEmailChannel({
    preferences: store,
    addresses: book,
    send: async (mail) => {
      outbox.push(mail);
      return nextOutcome;
    },
    origin: ORIGIN,
    unsubscribeKey: KEY,
    operator: { name: "Example GmbH", address: ["Musterstraße 1", "10115 Berlin"] },
    addressHash: hashOf,
    now: () => new Date("2026-11-12T07:00:00Z"),
    ...overrides,
  });
}

const on = (extra: Partial<EmailPreference> = {}): EmailPreference => ({
  emailEnabled: true,
  emailBouncedAt: null,
  emailBouncedHash: null,
  ...extra,
});

/** A student who turned email on, with a verified address. */
function optedIn(userId = "u1", email = "student@example.com") {
  prefs.set(userId, on());
  addresses.set(userId, { kind: "verified", email });
}

/** A student whose address `refused` was refused for good. */
function refused(userId: string, refusedAddress: string | null) {
  prefs.set(userId, on({ emailBouncedAt: new Date(0), emailBouncedHash: refusedAddress ? hashOf(refusedAddress) : null }));
}

const en = getDictionary("en");

beforeEach(() => {
  prefs = new Map();
  addresses = new Map();
  outbox = [];
  bounced = [];
  lifted = [];
  nextOutcome = { kind: "sent", messageId: "<m1@studyos.test>" };
  reportError.mockClear();
});

describe("who can be reached by email", () => {
  it("only a student who turned it on, with a verified primary address that was not refused", async () => {
    const email = channel();
    optedIn("ok");
    prefs.set("off", on({ emailEnabled: false }));
    addresses.set("off", { kind: "verified", email: "off@example.com" });
    refused("bounced", "same@example.com");
    addresses.set("bounced", { kind: "verified", email: "same@example.com" });
    prefs.set("unverified", on());
    addresses.set("unverified", { kind: "unverified", email: "new@example.com" });
    prefs.set("noAddress", on());
    prefs.set("clerkDown", on());
    addresses.set("clerkDown", { kind: "unavailable" });

    expect(await email.reachable("ok")).toBe(true);
    for (const id of ["off", "bounced", "unverified", "noAddress", "clerkDown", "noRowAtAll"]) {
      expect(await email.reachable(id), id).toBe(false);
    }
  });

  it("tells the dispatch to look again soon when Clerk is down, and to keep the schedule while an address is unverified", async () => {
    const email = channel();
    prefs.set("clerkDown", on());
    addresses.set("clerkDown", { kind: "unavailable" });
    prefs.set("unverified", on());
    addresses.set("unverified", { kind: "unverified", email: "new@example.com" });
    refused("bounced", "same@example.com");
    addresses.set("bounced", { kind: "verified", email: "same@example.com" });

    expect(await email.standby("clerkDown")).toBe("retry");
    expect(await email.standby("unverified")).toBe("wait");
    // Off, or stopped by a refusal of the address they have: nothing to wait for.
    expect(await email.standby("bounced")).toBeNull();
    expect(await email.standby("nobody")).toBeNull();
  });

  it("counts no address at all (deleted in Clerk, a phone-only account) as email off, not as waiting forever", async () => {
    prefs.set("noAddress", on());
    expect(await channel().standby("noAddress")).toBeNull();
  });
});

describe("a refusal belongs to the address", () => {
  it("stops email to the refused address only, whatever its case", async () => {
    refused("u1", "Student@Example.com");
    addresses.set("u1", { kind: "verified", email: "student@example.com" });
    expect(await channel().reachable("u1")).toBe(false);
    expect(lifted).toEqual([]);
  });

  it("is ignored, and cleared, once the student's primary address is another one", async () => {
    refused("u1", "old@example.com");
    addresses.set("u1", { kind: "verified", email: "new@example.com" });
    const email = channel();
    expect(await email.reachable("u1")).toBe(true);
    expect(lifted).toEqual([{ userId: "u1" }]);
    expect(prefs.get("u1")).toMatchObject({ emailBouncedAt: null, emailBouncedHash: null });
    expect(await email.deliver("u1", testEmailMessage(en, "en"))).toEqual({ delivered: 1 });
    expect(outbox[0].to).toBe("new@example.com");
  });

  it("is cleared for a new address still being verified, which then keeps the schedule", async () => {
    refused("u1", "old@example.com");
    addresses.set("u1", { kind: "unverified", email: "new@example.com" });
    expect(await channel().standby("u1")).toBe("wait");
    expect(prefs.get("u1")!.emailBouncedAt).toBeNull();
  });

  it("still applies when it cannot be compared: recorded without a hash, or Clerk unreachable", async () => {
    refused("legacy", null);
    addresses.set("legacy", { kind: "verified", email: "any@example.com" });
    refused("clerkDown", "old@example.com");
    addresses.set("clerkDown", { kind: "unavailable" });
    const email = channel();
    expect(await email.reachable("legacy")).toBe(false);
    expect(await email.reachable("clerkDown")).toBe(false);
    expect(await email.standby("clerkDown")).toBeNull();
    expect(lifted).toEqual([]);
  });
});

describe("sending a reminder email", () => {
  it("sends the push message's words to the verified address, with a one-click (HTTPS only) unsubscribe", async () => {
    optedIn("user_1", "student@example.com");
    const message = dailyPlanMessage([planItem({ id: "a", title: "Lab report draft", minutes: 25 })], "2026-11-12", en, "en")!;
    expect(await channel().deliver("user_1", message)).toEqual({ delivered: 1 });
    expect(outbox).toHaveLength(1);
    const [mail] = outbox;
    expect(mail.to).toBe("student@example.com");
    expect(mail.subject).toBe(message.title);
    expect(mail.text).toContain(message.body);
    const header = mail.headers!["List-Unsubscribe"];
    // No mailto: target (it would reach an inbox nobody reads).
    expect(header).not.toContain("mailto:");
    const [, url] = /^<([^>]+)>$/.exec(header)!;
    expect(url.startsWith(`${ORIGIN}/api/notifications/unsubscribe?t=`)).toBe(true);
    // The link names this student, and only verifies with our key.
    expect(verifyUnsubscribeToken(new URL(url).searchParams.get("t"), KEY)).toBe("user_1");
    expect(mail.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // The same link is in the body, with the settings link and the operator's address.
    expect(mail.html).toContain(url.replace(/&/g, "&amp;"));
    expect(mail.text).toContain(`${ORIGIN}/app/settings#notifications`);
    expect(mail.text).toContain("Musterstraße 1");
  });

  it("writes in the message's language", async () => {
    optedIn();
    const de = getDictionary("de");
    await channel().deliver("u1", testEmailMessage(de, "de"));
    expect(outbox[0].subject).toBe(de.email.testTitle);
    expect(outbox[0].html).toContain(`lang="de"`);
  });

  it("writes to the address the student has now, not one seen earlier in the run", async () => {
    optedIn("u1", "old@example.com");
    const email = channel();
    expect(await email.reachable("u1")).toBe(true);
    addresses.set("u1", { kind: "verified", email: "new@example.com" });
    await email.deliver("u1", testEmailMessage(en, "en"));
    expect(outbox[0].to).toBe("new@example.com");
  });

  it("records a permanent refusal with the refused address's hash, and sends nothing more to it", async () => {
    optedIn();
    nextOutcome = { kind: "rejected", code: 550 };
    const email = channel();
    expect(await email.deliver("u1", testEmailMessage(en, "en"))).toEqual({ delivered: 0 });
    expect(bounced).toEqual([{ userId: "u1", at: new Date("2026-11-12T07:00:00Z"), hash: hashOf("student@example.com") }]);
    expect(await email.reachable("u1")).toBe(false);
    // Reported by status only: the address never reaches the error log.
    expect(JSON.stringify(reportError.mock.calls)).not.toContain("student@example.com");
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ userId: "u1", status: 550 }));
  });

  it("leaves a temporary failure alone (the next reminder tries again), reported once per run without addresses", async () => {
    const email = channel();
    nextOutcome = { kind: "temporary", code: 550, reason: "config" };
    for (const id of ["u1", "u2", "u3"]) {
      optedIn(id, `${id}@example.com`);
      expect(await email.deliver(id, testEmailMessage(en, "en"))).toEqual({ delivered: 0 });
    }
    expect(bounced).toEqual([]);
    expect(await email.reachable("u1")).toBe(true);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0].message).toBe("email not sent (config, status 550)");
    expect(JSON.stringify(reportError.mock.calls)).not.toMatch(/example\.com|u1|u2/);
    // Another kind of failure is reported too, once.
    nextOutcome = { kind: "temporary", code: null, reason: "timeout" };
    await email.deliver("u1", testEmailMessage(en, "en"));
    await email.deliver("u2", testEmailMessage(en, "en"));
    expect(reportError).toHaveBeenCalledTimes(2);
    // A new run reports again.
    await channel().deliver("u3", testEmailMessage(en, "en"));
    expect(reportError).toHaveBeenCalledTimes(3);
  });

  it("never sends without a working unsubscribe link, or to someone not reachable", async () => {
    optedIn();
    expect(await channel({ unsubscribeKey: null }).deliver("u1", testEmailMessage(en, "en"))).toEqual({ delivered: 0 });
    prefs.set("u2", on({ emailEnabled: false }));
    addresses.set("u2", { kind: "verified", email: "u2@example.com" });
    expect(await channel().deliver("u2", testEmailMessage(en, "en"))).toEqual({ delivered: 0 });
    expect(outbox).toHaveLength(0);
  });
});

describe("the circuit breaker", () => {
  it(`stops believing refusals after more than ${MAX_REFUSALS_PER_RUN} students in one run, lifts the run's, and raises one alarm`, async () => {
    const email = channel();
    nextOutcome = { kind: "rejected", code: 550 };
    const ids = Array.from({ length: MAX_REFUSALS_PER_RUN + 3 }, (_, i) => `u${i}`);
    for (const id of ids) optedIn(id, `${id}@example.com`);
    for (const id of ids) await email.deliver(id, testEmailMessage(en, "en"));

    // The first five were recorded, then lifted when the sixth tripped the breaker.
    expect(bounced.map((b) => b.userId)).toEqual(ids.slice(0, MAX_REFUSALS_PER_RUN));
    expect(lifted.map((l) => l.userId)).toEqual(ids.slice(0, MAX_REFUSALS_PER_RUN));
    for (const id of ids) expect(prefs.get(id)!.emailBouncedAt, id).toBeNull();
    // One alarm for the run, without any address.
    const alarms = reportError.mock.calls.filter(([e]) => /more than 5 students/.test((e as Error).message));
    expect(alarms).toHaveLength(1);
    expect(JSON.stringify(reportError.mock.calls)).not.toContain("example.com");
    // Every student is still reachable: nobody is stopped by a setup problem.
    for (const id of ids) expect(await email.reachable(id), id).toBe(true);
  });

  it("lifts a refusal still being saved when the breaker trips (parallel students)", async () => {
    let finishSave: () => void = () => {};
    const slowStore: EmailPreferenceStore = {
      ...store,
      markBounced: (userId, at, hash) =>
        new Promise<void>((resolve) => {
          finishSave = () => {
            void store.markBounced(userId, at, hash).then(resolve);
          };
        }),
    };
    const email = channel({ preferences: slowStore, maxRefusals: 1 });
    nextOutcome = { kind: "rejected", code: 550 };
    optedIn("a", "a@example.com");
    optedIn("b", "b@example.com");
    const first = email.deliver("a", testEmailMessage(en, "en"));
    await new Promise((r) => setTimeout(r, 0));
    const second = email.deliver("b", testEmailMessage(en, "en"));
    await new Promise((r) => setTimeout(r, 0));
    finishSave();
    await Promise.all([first, second]);
    expect(prefs.get("a")!.emailBouncedAt).toBeNull();
    expect(prefs.get("b")!.emailBouncedAt).toBeNull();
  });

  it("counts students, not messages: one student refused twice is one", async () => {
    const email = channel({ maxRefusals: 1 });
    nextOutcome = { kind: "rejected", code: 550 };
    optedIn("u1");
    await email.deliver("u1", testEmailMessage(en, "en"));
    // Stopped for this address now; a second message is not even sent.
    await email.deliver("u1", testEmailMessage(en, "en"));
    expect(outbox).toHaveLength(1);
    expect(prefs.get("u1")!.emailBouncedAt).not.toBeNull();
  });
});

describe("email in the dispatch, next to push", () => {
  // Thursday 12 November 2026, 08:00 in Berlin.
  const DAILY = new Date("2026-11-12T07:00:00Z");

  it("sends the daily plan by push and by email, logged and counted once", async () => {
    const memory = new MemoryStore();
    memory.addUser("u1", { timeZone: "Europe/Berlin" });
    memory.plans.set("u1", [planItem({ id: "a", title: "Lab report draft" })]);
    const push = new FakeChannel("push");
    push.devices.set("u1", 1);
    optedIn("u1");
    const result = await runNotificationDispatch({ store: memory, channels: [push, channel()], now: () => DAILY });
    expect(result).toMatchObject({ sent: 1 });
    expect(push.sent).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].subject).toBe(push.sent[0].message.title);
    expect(memory.logs).toEqual([expect.objectContaining({ kind: "daily", status: "sent", message: true })]);
  });

  it("still pushes when the address is refused, and stops emailing after that", async () => {
    const memory = new MemoryStore();
    memory.addUser("u1", { timeZone: "Europe/Berlin" });
    memory.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    const push = new FakeChannel("push");
    push.devices.set("u1", 1);
    optedIn("u1");
    nextOutcome = { kind: "rejected", code: 550 };
    const result = await runNotificationDispatch({ store: memory, channels: [push, channel()], now: () => DAILY });
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(bounced).toHaveLength(1);
    expect(memory.logs[0].status).toBe("sent");
  });

  it("never delays a push for a slow email: both go out at once", async () => {
    const memory = new MemoryStore();
    memory.addUser("u1", { timeZone: "Europe/Berlin" });
    memory.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    const push = new FakeChannel("push");
    push.devices.set("u1", 1);
    optedIn("u1");
    let releaseEmail: (() => void) | null = null;
    const slow = channel({
      send: () =>
        new Promise<MailOutcome>((resolve) => {
          releaseEmail = () => resolve({ kind: "sent", messageId: null });
        }),
    });
    // Email first in the list, and hanging: the push still goes out meanwhile.
    const run = runNotificationDispatch({ store: memory, channels: [slow, push], now: () => DAILY });
    await vi.waitFor(() => {
      expect(releaseEmail).not.toBeNull();
      expect(push.sent).toHaveLength(1);
    });
    releaseEmail!();
    await run;
    expect(memory.logs[0].status).toBe("sent");
  });

  it("keeps an email-only student scheduled, and drops them once the address is refused", async () => {
    const memory = new MemoryStore();
    memory.addUser("u1", { timeZone: "Europe/Berlin" });
    memory.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    optedIn("u1");
    nextOutcome = { kind: "rejected", code: 550 };
    const result = await runNotificationDispatch({ store: memory, channels: [channel()], now: () => DAILY });
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(memory.users.get("u1")!.nextCheckAt).toBeNull();
  });

  it("keeps email-only students on their schedule while email is not configured (the dormant stand-in)", async () => {
    const memory = new MemoryStore();
    memory.addUser("emailOnly", { timeZone: "Europe/Berlin" });
    memory.addUser("emailOff", { timeZone: "Europe/Berlin" });
    memory.addUser("refused", { timeZone: "Europe/Berlin" });
    memory.plans.set("emailOnly", [planItem({ id: "a", title: "x" })]);
    optedIn("emailOnly");
    prefs.set("emailOff", on({ emailEnabled: false }));
    refused("refused", "r@example.com");
    const push = new FakeChannel("push");
    const result = await runNotificationDispatch({
      store: memory,
      channels: [push, createDormantEmailChannel(store)],
      now: () => DAILY,
    });
    // Nothing is sent (or claimed) meanwhile...
    expect(result).toMatchObject({ sent: 0, failed: 0 });
    expect(memory.logs).toHaveLength(0);
    // ...but the student stays scheduled, at their next moment (18:00 Berlin).
    expect(memory.users.get("emailOnly")!.nextCheckAt?.toISOString()).toBe("2026-11-12T17:00:00.000Z");
    expect(memory.users.get("emailOff")!.nextCheckAt).toBeNull();
    expect(memory.users.get("refused")!.nextCheckAt).toBeNull();
  });
});
