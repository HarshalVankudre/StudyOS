// @vitest-environment node
import { createECDH } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "user_1" as string | null,
  configured: true,
  add: vi.fn(),
  remove: vi.fn(),
  save: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("@/lib/notifications/config", () => ({ pushConfigured: () => m.configured }));
vi.mock("@/lib/notifications/service", () => ({
  addPushSubscription: m.add,
  removePushSubscriptions: m.remove,
  saveNotificationPreferences: m.save,
  getNotificationSettings: m.settings,
}));
vi.mock("@/lib/ops/report-error", () => ({ reportError: vi.fn() }));

import * as subscriptions from "./subscriptions/route";
import * as settings from "./settings/route";

const key = () => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return ecdh.getPublicKey("base64url");
};
const json = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://studyos.app/api/notifications/x", {
    method,
    headers: { "content-type": "application/json", host: "studyos.app", ...headers },
    body: JSON.stringify(body),
  });
const subscription = (endpoint = "https://fcm.googleapis.com/fcm/send/abc") => ({
  endpoint,
  keys: { p256dh: key(), auth: Buffer.alloc(16, 3).toString("base64url") },
});

beforeEach(() => {
  m.userId = "user_1";
  m.configured = true;
  m.settings.mockResolvedValue({ configured: true, devices: 1, preferences: { dailyEnabled: true } });
  m.remove.mockResolvedValue(1);
  m.save.mockResolvedValue({ ok: true, preferences: { dailyEnabled: false } });
});

describe("POST /api/notifications/subscriptions", () => {
  it("adds this device for the signed-in student with its zone and language", async () => {
    const res = await subscriptions.POST(
      json("POST", { subscription: subscription(), timeZone: "Europe/Berlin", locale: "de" }, { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }),
    );
    expect(res.status).toBe(200);
    expect(m.add).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ ok: true, endpoint: "https://fcm.googleapis.com/fcm/send/abc" }),
      { timeZone: "Europe/Berlin", locale: "de", label: "iPhone" },
    );
    // The endpoint never goes back to the browser.
    expect(JSON.stringify(await res.json())).not.toContain("fcm.googleapis.com");
  });

  it("refuses endpoints that are not a push service", async () => {
    const res = await subscriptions.POST(json("POST", { subscription: subscription("https://10.0.0.5/admin") }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "endpoint_not_allowed" });
    expect(m.add).not.toHaveBeenCalled();
  });

  it("needs a signed-in student, the same origin, and push configured", async () => {
    m.userId = null;
    expect((await subscriptions.POST(json("POST", { subscription: subscription() }))).status).toBe(401);
    m.userId = "user_1";
    expect((await subscriptions.POST(json("POST", { subscription: subscription() }, { origin: "https://evil.example" }))).status).toBe(403);
    m.configured = false;
    expect((await subscriptions.POST(json("POST", { subscription: subscription() }))).status).toBe(404);
    expect(m.add).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/notifications/subscriptions", () => {
  it("turns off one device or all of them, only for the signed-in student", async () => {
    await subscriptions.DELETE(json("DELETE", { endpoint: "https://fcm.googleapis.com/fcm/send/abc" }));
    expect(m.remove).toHaveBeenLastCalledWith("user_1", { endpoint: "https://fcm.googleapis.com/fcm/send/abc" });
    await subscriptions.DELETE(json("DELETE", { all: true }));
    expect(m.remove).toHaveBeenLastCalledWith("user_1", { all: true });
    expect((await subscriptions.DELETE(json("DELETE", { userId: "someone_else", all: true }))).status).toBe(400);
  });

  it("still works after push was switched off in configuration", async () => {
    m.configured = false;
    expect((await subscriptions.DELETE(json("DELETE", { all: true }))).status).toBe(200);
  });
});

describe("/api/notifications/settings", () => {
  it("reads and saves the signed-in student's choices", async () => {
    expect(await (await settings.GET()).json()).toMatchObject({ configured: true, devices: 1 });
    const res = await settings.PUT(json("PUT", { dailyEnabled: false }));
    expect(res.status).toBe(200);
    expect(m.save).toHaveBeenCalledWith("user_1", { dailyEnabled: false });
  });

  it("rejects an invalid update", async () => {
    m.save.mockResolvedValue({ ok: false });
    expect((await settings.PUT(json("PUT", { dailyMinute: 5000 }))).status).toBe(400);
  });
});
