// @vitest-environment node
/**
 * The email switch (PUT /api/notifications/email) and the test email
 * (POST /api/notifications/test with { channel: "email" }).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "user_1" as string | null,
  emailConfigured: true,
  setEmail: vi.fn(),
  settings: vi.fn(),
  channels: [] as { name: string; reachable: ReturnType<typeof vi.fn>; deliver: ReturnType<typeof vi.fn> }[],
  claim: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("@/lib/email/config", () => ({ emailConfigured: () => m.emailConfigured }));
vi.mock("@/lib/notifications/service", () => ({
  setEmailReminders: m.setEmail,
  getNotificationSettings: m.settings,
}));
vi.mock("@/lib/notifications/channels", () => ({ defaultChannels: () => m.channels }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/usage-limits", () => ({ claimWithinLimit: m.claim }));

import * as emailRoute from "./email/route";
import * as testRoute from "./test/route";
import { DEFAULT_PREFERENCES } from "@/lib/notifications/preferences";

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("https://studyos.app/api/notifications/x", {
    method,
    headers: { "content-type": "application/json", host: "studyos.app", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const view = { enabled: true, address: "me@example.com", verified: true, bounced: false, unavailable: false };
const fakeChannel = (name: string) => ({
  name,
  reachable: vi.fn(async () => true),
  deliver: vi.fn(async () => ({ delivered: 1 })),
});

beforeEach(() => {
  m.userId = "user_1";
  m.emailConfigured = true;
  m.setEmail.mockReset();
  m.setEmail.mockResolvedValue({ ok: true, email: view });
  m.settings.mockResolvedValue({ preferences: { ...DEFAULT_PREFERENCES, locale: "de" } });
  m.channels = [fakeChannel("push"), fakeChannel("email")];
  m.claim.mockReset();
  m.claim.mockResolvedValue({ allowed: true, remaining: 4 });
});

describe("PUT /api/notifications/email", () => {
  it("turns email on for the signed-in student, with the device's zone and language", async () => {
    const res = await emailRoute.PUT(json("PUT", { enabled: true, timeZone: "Europe/Berlin", locale: "de" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: view });
    expect(m.setEmail).toHaveBeenCalledWith("user_1", true, { timeZone: "Europe/Berlin", locale: "de" });
  });

  it("refuses to turn on without a verified address, and says why", async () => {
    m.setEmail.mockResolvedValueOnce({ ok: false, reason: "unverified" });
    const res = await emailRoute.PUT(json("PUT", { enabled: true }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "unverified" });
    m.setEmail.mockResolvedValueOnce({ ok: false, reason: "no_address" });
    expect(await (await emailRoute.PUT(json("PUT", { enabled: true }))).json()).toEqual({ error: "no_address" });
    m.setEmail.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    expect((await emailRoute.PUT(json("PUT", { enabled: true }))).status).toBe(503);
  });

  it("needs a signed-in student, the same origin, a valid body and email configured", async () => {
    expect((await emailRoute.PUT(json("PUT", { enabled: true }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await emailRoute.PUT(json("PUT", { enabled: "yes" }))).status).toBe(400);
    expect((await emailRoute.PUT(json("PUT", { enabled: true, userId: "someone_else" }))).status).toBe(400);
    m.userId = null;
    expect((await emailRoute.PUT(json("PUT", { enabled: true }))).status).toBe(401);
    m.userId = "user_1";
    m.emailConfigured = false;
    expect((await emailRoute.PUT(json("PUT", { enabled: true }))).status).toBe(404);
    expect(m.setEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/notifications/test", () => {
  it("sends a test email on the email channel only, in the student's language", async () => {
    const res = await testRoute.POST(json("POST", { channel: "email" }));
    expect(await res.json()).toEqual({ ok: true, delivered: 1 });
    const [push, email] = m.channels;
    expect(push.deliver).not.toHaveBeenCalled();
    expect(email.deliver).toHaveBeenCalledWith("user_1", expect.objectContaining({ kind: "test", lang: "de", tag: "test-email" }));
  });

  it("keeps the push test on push only (no body, as the push client sends it)", async () => {
    const res = await testRoute.POST(new Request("https://studyos.app/api/notifications/test", { method: "POST", headers: { host: "studyos.app" } }));
    expect(await res.json()).toEqual({ ok: true, delivered: 1 });
    const [push, email] = m.channels;
    expect(push.deliver).toHaveBeenCalledTimes(1);
    expect(email.deliver).not.toHaveBeenCalled();
  });

  it("answers not found for a channel that is not set up, and ok: false when it cannot reach the student", async () => {
    m.channels = [fakeChannel("push")];
    expect((await testRoute.POST(json("POST", { channel: "email" }))).status).toBe(404);
    m.channels = [fakeChannel("email")];
    m.channels[0].reachable.mockResolvedValue(false);
    expect(await (await testRoute.POST(json("POST", { channel: "email" }))).json()).toEqual({ ok: false, delivered: 0 });
    expect((await testRoute.POST(json("POST", { channel: "sms" }))).status).toBe(400);
  });

  it("caps test emails per student and day in the database, across server instances", async () => {
    m.userId = "user_daily_cap";
    expect((await testRoute.POST(json("POST", { channel: "email" }))).status).toBe(200);
    expect(m.claim).toHaveBeenCalledWith("user_daily_cap", "notification_test_email", 5, 24 * 60 * 60 * 1000);
    m.claim.mockResolvedValue({ allowed: false, remaining: 0 });
    const res = await testRoute.POST(json("POST", { channel: "email" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(m.channels[1].deliver).toHaveBeenCalledTimes(1);
  });

  it("does not count a push test against the email cap", async () => {
    m.userId = "user_push_only";
    await testRoute.POST(json("POST", { channel: "push" }));
    expect(m.claim).not.toHaveBeenCalled();
  });

  it("limits tests per student and channel", async () => {
    m.userId = "user_limits";
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await testRoute.POST(json("POST", { channel: "email" }))).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    // Push has its own allowance.
    expect((await testRoute.POST(json("POST", { channel: "push" }))).status).toBe(200);
  });
});
