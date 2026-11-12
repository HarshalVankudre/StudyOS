// @vitest-environment node
/**
 * public/sw.js run in a sandbox with a fake service-worker global: showing a
 * pushed notification and opening the right place when it is tapped.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
const ORIGIN = "https://studyos.app";

type Listener = (event: unknown) => void;

function loadWorker(windows: { url: string; navigate?: (url: string) => Promise<unknown> }[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async (url: string) => ({ url }));
  const clientList = windows.map((w) => ({
    url: w.url,
    focus: vi.fn(async function (this: unknown) {
      return this;
    }),
    navigate: w.navigate ? vi.fn(w.navigate) : undefined,
  }));
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => clientList), openWindow, claim: async () => undefined },
    skipWaiting: async () => undefined,
  };
  runInNewContext(SOURCE, { self, URL, caches: {}, fetch: () => Promise.reject(new Error("no network")), Request });
  const fire = async (type: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    return Promise.all(waits);
  };
  return { listeners, fire, showNotification, openWindow, clientList };
}

const pushEvent = (payload: unknown) => ({
  data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) },
});
const clickEvent = (url: unknown) => ({ notification: { close: vi.fn(), data: { url } } });

describe("service worker notifications", () => {
  it("keeps its offline-only fetch handling and adds push handlers", () => {
    const { listeners } = loadWorker();
    expect([...listeners.keys()].sort()).toEqual(["activate", "fetch", "install", "notificationclick", "push"]);
  });

  it("shows a pushed message with its text, language, direction and link", async () => {
    const { fire, showNotification } = loadWorker();
    await fire(
      "push",
      pushEvent({ title: "Today’s plan · about 1 h", body: "Start here", url: "/app/ws1?page=p1&block=b1", tag: "daily-2026-11-12", lang: "ar", dir: "rtl" }),
    );
    expect(showNotification).toHaveBeenCalledWith("Today’s plan · about 1 h", {
      body: "Start here",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: "/app/ws1?page=p1&block=b1" },
      tag: "daily-2026-11-12",
      lang: "ar",
      dir: "rtl",
    });
  });

  it("still shows something for an unreadable message and never keeps a foreign link", async () => {
    const { fire, showNotification } = loadWorker();
    await fire("push", { data: { json: () => { throw new Error("bad"); } } });
    expect(showNotification).toHaveBeenLastCalledWith("StudyOS", expect.objectContaining({ data: { url: "/app" } }));
    await fire("push", pushEvent({ title: "x", url: "https://evil.example/phish" }));
    expect(showNotification).toHaveBeenLastCalledWith("x", expect.objectContaining({ data: { url: "/app" } }));
    await fire("push", pushEvent({ title: "x", url: "//evil.example/phish" }));
    expect(showNotification).toHaveBeenLastCalledWith("x", expect.objectContaining({ data: { url: "/app" } }));
  });

  it("opens the deep link in a new window when StudyOS is not open", async () => {
    const { fire, openWindow } = loadWorker([{ url: "https://other.example/" }]);
    const event = clickEvent("/app/ws1?page=p1&db=d1&row=r1");
    await fire("notificationclick", event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/app/ws1?page=p1&db=d1&row=r1`);
  });

  it("focuses an open StudyOS window and takes it to the deep link", async () => {
    const navigate = vi.fn(async (url: string) => ({ url }));
    const { fire, openWindow, clientList } = loadWorker([{ url: `${ORIGIN}/app`, navigate }]);
    await fire("notificationclick", clickEvent("/app/ws1?page=p1&block=b1"));
    expect(clientList[0].focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/app/ws1?page=p1&block=b1`);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("falls back to opening a window when the open one cannot be steered", async () => {
    const { fire, openWindow } = loadWorker([
      { url: `${ORIGIN}/app`, navigate: () => Promise.reject(new TypeError("not controlled")) },
    ]);
    await fire("notificationclick", clickEvent("/app/ws1?page=p1"));
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/app/ws1?page=p1`);
  });

  it("never opens a foreign address from a tampered notification", async () => {
    const { fire, openWindow } = loadWorker();
    await fire("notificationclick", clickEvent("https://evil.example/"));
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/app`);
  });
});
