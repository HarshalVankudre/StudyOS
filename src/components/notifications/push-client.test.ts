/**
 * The browser permission flow with fake Notification / service worker / push
 * manager objects: permission is asked once, the subscription uses the
 * server's key, and the server gets the device with its zone and language.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPushBeforeSignOut,
  disablePush,
  dropPushWhenSignedOut,
  enablePush,
  pushSupport,
  syncPush,
} from "./push-client";

const KEY = "BOVvZP3DuGCyCDuV0sRrG_oKqDuUBr2XtDGXGRLhJB8fm0ES5jc1X0bM0zS5CbDjW9bQsGrlkXcVjRnApGHnwEU";

function keyFromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function fakeSubscription(endpoint: string, key: Uint8Array) {
  return {
    endpoint,
    options: { applicationServerKey: key.buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

let current: ReturnType<typeof fakeSubscription> | null;
const subscribe = vi.fn(async (options: { applicationServerKey: Uint8Array }) => {
  current = fakeSubscription("https://fcm.googleapis.com/fcm/send/new", options.applicationServerKey);
  return current;
});
const registration = { pushManager: { getSubscription: vi.fn(async () => current), subscribe } };
const requestPermission = vi.fn(async () => "granted");
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, devices: 1 }), { status: 200 }));

beforeEach(() => {
  current = null;
  subscribe.mockClear();
  requestPermission.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("Notification", Object.assign(function Notification() {}, { permission: "default", requestPermission }));
  vi.stubGlobal("PushManager", function PushManager() {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => registration),
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    },
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("push-client", () => {
  it("reports support on a desktop browser", () => {
    expect(pushSupport()).toBe("supported");
  });

  it("asks for permission, subscribes with the server key and registers the device", async () => {
    const result = await enablePush(KEY, "fr");
    expect(result).toEqual({ ok: true, devices: 1 });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    const options = subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toHaveLength(65);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/notifications/subscriptions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/new" },
      locale: "fr",
    });
  });

  it("does not subscribe when permission is refused or the prompt is dismissed", async () => {
    requestPermission.mockResolvedValueOnce("denied");
    expect(await enablePush(KEY, "en")).toEqual({ ok: false, reason: "denied" });
    requestPermission.mockResolvedValueOnce("default");
    expect(await enablePush(KEY, "en")).toEqual({ ok: false, reason: "dismissed" });
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replaces a subscription made with an old server key", async () => {
    const old = fakeSubscription("https://fcm.googleapis.com/fcm/send/old", new Uint8Array(65).fill(9));
    current = old;
    (Notification as unknown as { permission: string }).permission = "granted";
    expect(await syncPush(KEY, "en")).toBe(true);
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("turns off: unsubscribes in the browser and tells the server", async () => {
    current = fakeSubscription("https://fcm.googleapis.com/fcm/send/mine", new Uint8Array(65));
    const sub = current;
    await disablePush();
    expect(sub.unsubscribe).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ endpoint: "https://fcm.googleapis.com/fcm/send/mine" });
  });

  it("re-subscribes once when the server says the endpoint is another student's", async () => {
    const old = fakeSubscription("https://fcm.googleapis.com/fcm/send/left-behind", new Uint8Array(65));
    // Same key as the server's, so only the 409 can cause a fresh subscription.
    old.options.applicationServerKey = keyFromBase64(KEY).buffer as ArrayBuffer;
    current = old;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "endpoint_taken" }), { status: 409 }));
    const result = await enablePush(KEY, "en");
    expect(result).toEqual({ ok: true, devices: 1 });
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));
    expect(bodies.map((b) => b.subscription.endpoint)).toEqual([
      "https://fcm.googleapis.com/fcm/send/left-behind",
      "https://fcm.googleapis.com/fcm/send/new",
    ]);
  });

  it("before signing out: unsubscribes this browser and deletes the endpoint on the server", async () => {
    current = fakeSubscription("https://fcm.googleapis.com/fcm/send/mine", new Uint8Array(65));
    const sub = current;
    await clearPushBeforeSignOut();
    expect(sub.unsubscribe).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/notifications/subscriptions");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ endpoint: "https://fcm.googleapis.com/fcm/send/mine" });
  });

  it("before signing out: gives up after the time bound when the server does not answer", async () => {
    current = fakeSubscription("https://fcm.googleapis.com/fcm/send/mine", new Uint8Array(65));
    fetchMock.mockImplementationOnce(() => new Promise(() => {}) as never);
    const t0 = Date.now();
    await clearPushBeforeSignOut(50);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(current.unsubscribe).toHaveBeenCalled();
  });

  it("before signing out: never throws, also without push support", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    current = fakeSubscription("https://fcm.googleapis.com/fcm/send/mine", new Uint8Array(65));
    await expect(clearPushBeforeSignOut()).resolves.toBeUndefined();
    vi.stubGlobal("PushManager", undefined);
    // @ts-expect-error simulate a browser without push
    delete window.PushManager;
    await expect(clearPushBeforeSignOut()).resolves.toBeUndefined();
  });

  it("a signed-out browser drops a subscription left behind", async () => {
    current = fakeSubscription("https://fcm.googleapis.com/fcm/send/left", new Uint8Array(65));
    expect(await dropPushWhenSignedOut()).toBe(true);
    expect(current.unsubscribe).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    current = null;
    expect(await dropPushWhenSignedOut()).toBe(false);
  });

  it("needs the home screen on an iPhone", () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    );
    expect(pushSupport()).toBe("ios-needs-install");
    ua.mockRestore();
  });
});
