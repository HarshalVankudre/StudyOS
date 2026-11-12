/**
 * Browser side of Web Push: what this device supports, asking permission,
 * subscribing through the service worker (public/sw.js) and telling the
 * server. No React here, so the settings section and the Today prompt share it.
 */

export type PushSupport = "supported" | "ios-needs-install" | "unsupported";
export type PermissionState = "default" | "granted" | "denied";

const SETTINGS_URL = "/api/notifications/settings";
const SUBSCRIPTIONS_URL = "/api/notifications/subscriptions";

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    // matchMedia unavailable
  }
  return nav.standalone === true;
}

/**
 * Can this device receive StudyOS notifications? On iPhone and iPad web push
 * works only in a home-screen app, so Safari in a tab gets "ios-needs-install".
 */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  const api = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !isStandalone()) return "ios-needs-install";
  return api ? "supported" : "unsupported";
}

export function permission(): PermissionState {
  if (typeof Notification === "undefined") return "default";
  return Notification.permission as PermissionState;
}

export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** The service worker registration (registering /sw.js when it is not yet). */
async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  }
  return navigator.serviceWorker.ready;
}

/** This browser's subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

async function send(method: "POST" | "DELETE", body: unknown): Promise<{ ok: boolean; devices?: number }> {
  const res = await fetch(SUBSCRIPTIONS_URL, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false };
  const json = (await res.json().catch(() => ({}))) as { devices?: number };
  return { ok: true, devices: json.devices };
}

export type EnableResult =
  | { ok: true; devices: number }
  | { ok: false; reason: "denied" | "dismissed" | "failed" };

/**
 * Ask the browser for permission (call only after the student chose to turn
 * notifications on), subscribe, and register the device with the server.
 */
export async function enablePush(publicKey: string, locale: string): Promise<EnableResult> {
  try {
    const answer = await Notification.requestPermission();
    if (answer !== "granted") return { ok: false, reason: answer === "denied" ? "denied" : "dismissed" };
    const reg = await registration();
    let subscription = await reg.pushManager.getSubscription();
    if (subscription && !sameKey(subscription, publicKey)) {
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }
    subscription ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    });
    const saved = await send("POST", { subscription: subscription.toJSON(), timeZone: browserTimeZone(), locale });
    if (!saved.ok) return { ok: false, reason: "failed" };
    return { ok: true, devices: saved.devices ?? 1 };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Turn notifications off on this device (the browser and the server). */
export async function disablePush(): Promise<{ ok: boolean; devices?: number }> {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return { ok: true };
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => false);
    return await send("DELETE", { endpoint });
  } catch {
    return { ok: false };
  }
}

/** Turn notifications off on every device of the student. */
export async function disableEverywhere(): Promise<{ ok: boolean; devices?: number }> {
  try {
    const subscription = await currentSubscription();
    await subscription?.unsubscribe().catch(() => false);
    return await send("DELETE", { all: true });
  } catch {
    return { ok: false };
  }
}

/**
 * Keep the server's copy of this device current: browsers rotate
 * subscriptions, and the student may have moved time zone. Re-subscribes when
 * the server's key changed. Returns whether this device is on.
 */
export async function syncPush(publicKey: string, locale: string): Promise<boolean> {
  if (permission() !== "granted") return false;
  let subscription = await currentSubscription();
  if (!subscription) return false;
  try {
    if (!sameKey(subscription, publicKey)) {
      await subscription.unsubscribe().catch(() => false);
      const reg = await registration();
      subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    }
    const saved = await send("POST", { subscription: subscription.toJSON(), timeZone: browserTimeZone(), locale });
    return saved.ok;
  } catch {
    return false;
  }
}

export interface ServerSettings {
  configured: boolean;
  publicKey: string | null;
  devices: number;
}

export async function fetchSettings(): Promise<ServerSettings | null> {
  try {
    const res = await fetch(SETTINGS_URL, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ServerSettings;
  } catch {
    return null;
  }
}

export async function sendTest(): Promise<"sent" | "failed" | "limited"> {
  try {
    const res = await fetch("/api/notifications/test", { method: "POST" });
    if (res.status === 429) return "limited";
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return res.ok && json.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
