// @vitest-environment node
import { createECDH } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ops/report-error", () => ({ reportError }));

import { MAX_REJECTIONS, createPushChannel, type StoredSubscription, type SubscriptionStore } from "./channels";
import { testMessage } from "./content";
import { runNotificationDispatch } from "./dispatch";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { MemoryStore, planItem } from "./test-fakes";
import { b64url, generateVapidKeys } from "./webpush";

/** The push service's answer per device path. */
const answers = new Map<string, number>();
const hits: string[] = [];
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      hits.push(req.url ?? "");
      res.statusCode = answers.get(req.url ?? "") ?? 201;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

class MemorySubscriptions implements SubscriptionStore {
  rows: (StoredSubscription & { userId: string; failures: number; lastSuccessAt?: Date })[] = [];
  add(userId: string, id: string, endpoint: string) {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    this.rows.push({ id, userId, endpoint, p256dh: b64url(ecdh.getPublicKey()), auth: b64url(Buffer.alloc(16, 7)), failures: 0 });
  }
  async list(userId: string) {
    return this.rows.filter((r) => r.userId === userId);
  }
  async count(userId: string) {
    return this.rows.filter((r) => r.userId === userId).length;
  }
  async remove(id: string) {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  async succeeded(id: string, at: Date) {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, { failures: 0, lastSuccessAt: at });
  }
  async rejected(id: string) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return MAX_REJECTIONS;
    row.failures += 1;
    return row.failures;
  }
}

const vapid = { ...generateVapidKeys(), subject: "mailto:ops@example.com" };
const message = testMessage(getDictionary("en"), "en");
let subs: MemorySubscriptions;

beforeEach(() => {
  subs = new MemorySubscriptions();
  answers.clear();
  hits.length = 0;
  reportError.mockClear();
});

const localChannel = () => createPushChannel({ subscriptions: subs, vapid, allowEndpoint: () => true });

describe("push channel", () => {
  it("delivers to every device and records the success", async () => {
    subs.add("u1", "phone", `${base}/phone`);
    subs.add("u1", "laptop", `${base}/laptop`);
    const result = await localChannel().deliver("u1", message);
    expect(result.delivered).toBe(2);
    expect(hits.sort()).toEqual(["/laptop", "/phone"]);
    expect(subs.rows.every((r) => r.lastSuccessAt instanceof Date)).toBe(true);
  });

  it("deletes a subscription the push service reports gone, and keeps the others", async () => {
    subs.add("u1", "old-phone", `${base}/old-phone`);
    subs.add("u1", "laptop", `${base}/laptop`);
    answers.set("/old-phone", 410);
    const result = await localChannel().deliver("u1", message);
    expect(result.delivered).toBe(1);
    expect(subs.rows.map((r) => r.id)).toEqual(["laptop"]);

    answers.set("/laptop", 404);
    await localChannel().deliver("u1", message);
    expect(subs.rows).toEqual([]);
    expect(await localChannel().reachable("u1")).toBe(false);
  });

  it("drops a subscription only after repeated rejections; temporary failures keep it", async () => {
    subs.add("u1", "s", `${base}/s`);
    answers.set("/s", 503);
    await localChannel().deliver("u1", message);
    expect(subs.rows).toHaveLength(1);
    answers.set("/s", 403);
    for (let i = 1; i < MAX_REJECTIONS; i++) await localChannel().deliver("u1", message);
    expect(subs.rows).toHaveLength(1);
    await localChannel().deliver("u1", message);
    expect(subs.rows).toHaveLength(0);
  });

  it("a message with a huge deep link still arrives, opening the app's home", async () => {
    subs.add("u1", "s", `${base}/s`);
    const huge = { ...message, url: `/app/ws?page=${"p".repeat(5_000)}&db=${"d".repeat(5_000)}` };
    const bodies: string[] = [];
    const channel = createPushChannel({
      subscriptions: subs,
      vapid,
      allowEndpoint: () => true,
      send: async (_sub, payload) => {
        bodies.push(payload);
        return { kind: "sent", status: 201 };
      },
    });
    const result = await channel.deliver("u1", huge);
    expect(result.delivered).toBe(1);
    expect(JSON.parse(bodies[0])).toMatchObject({ title: message.title, url: "/app" });
  });

  it("never counts a too-large message as a rejection of the device", async () => {
    subs.add("u1", "s", `${base}/s`);
    answers.set("/s", 413);
    for (let i = 0; i < MAX_REJECTIONS + 2; i++) await localChannel().deliver("u1", message);
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0].failures).toBe(0);
  });

  it("never logs the endpoint", async () => {
    subs.add("u1", "s", `${base}/secret-capability-token`);
    answers.set("/secret-capability-token", 400);
    await localChannel().deliver("u1", message);
    expect(reportError).toHaveBeenCalled();
    expect(JSON.stringify(reportError.mock.calls)).not.toContain("secret-capability-token");
  });

  it("never contacts an endpoint outside the push-service allowlist", async () => {
    subs.add("u1", "evil", `${base}/internal`);
    const channel = createPushChannel({ subscriptions: subs, vapid }); // default allowlist
    const result = await channel.deliver("u1", message);
    expect(result.delivered).toBe(0);
    expect(hits).toEqual([]);
    expect(subs.rows).toEqual([]);
  });
});

describe("dispatch with the push channel", () => {
  it("stops scheduling a student whose only device is gone", async () => {
    const store = new MemoryStore();
    store.addUser("u1", { timeZone: "UTC" });
    store.plans.set("u1", [planItem({ id: "a", title: "Read" })]);
    subs.add("u1", "gone", `${base}/gone`);
    answers.set("/gone", 410);
    await runNotificationDispatch({ store, channels: [localChannel()], now: () => new Date("2026-11-12T08:00:00Z") });
    expect(hits).toEqual(["/gone"]);
    expect(subs.rows).toEqual([]);
    expect(store.users.get("u1")!.nextCheckAt).toBeNull();
    expect(store.logs[0].status).toBe("failed");
  });
});
