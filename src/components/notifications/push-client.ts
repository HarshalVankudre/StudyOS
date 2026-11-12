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

async function send(
  method: "POST" | "DELETE",
  body: unknown,
  signal?: AbortSignal,
): Promise<{ ok: boolean; devices?: number; taken?: boolean }> {
  const res = await fetch(SUBSCRIPTIONS_URL, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) return { ok: false, taken: res.status === 409 };
  const json = (await res.json().catch(() => ({}))) as { devices?: number };
  return { ok: true, devices: json.devices };
}

/**
 * Register `subscription` with the server. When the server says the endpoint
 * is another student's device (409: this browser was used by someone else
 * who never signed out cleanly), drop it and subscribe afresh: a new endpoint
 * is the proof that this browser is the device, and the old record dies when
 * the push service reports the old endpoint gone.
 */
async function register(
  reg: ServiceWorkerRegistration,
  subscription: PushSubscription,
  publicKey: string,
  locale: string,
): Promise<{ ok: boolean; devices?: number }> {
  const body = (s: PushSubscription) => ({ subscription: s.toJSON(), timeZone: browserTimeZone(), locale });
  const saved = await send("POST", body(subscription));
  if (saved.ok || !saved.taken) return saved;
  await subscription.unsubscribe().catch(() => false);
  const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  return send("POST", body(fresh));
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
    const saved = await register(reg, subscription, publicKey, locale);
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

/** Longest a sign-out waits for push cleanup before going ahead anyway. */
export const SIGN_OUT_CLEANUP_MS = 3_000;

/**
 * Before signing out (or deleting the account): stop this device receiving
 * the student's notifications, so the next person on a shared device does not
 * see assignment and exam titles on the lock screen. The browser
 * subscription is dropped first (that alone stops delivery: the push service
 * then reports the endpoint gone), then the server forgets the endpoint while
 * the session still exists. Never throws and never takes longer than
 * `timeoutMs`, so signing out always proceeds.
 */
export async function clearPushBeforeSignOut(timeoutMs = SIGN_OUT_CLEANUP_MS): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const subscription = await currentSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => false);
    await send("DELETE", { endpoint }, controller.signal).catch(() => undefined);
  })().catch(() => undefined);
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve();
    }, timeoutMs);
  });
  await Promise.race([work, timeout]);
  if (timer) clearTimeout(timer);
}

/**
 * Safety net for sign-outs that do not pass through our buttons (Clerk's own
 * user menu, a session ended in another tab or by the server): a browser that
 * is signed out keeps no StudyOS push subscription. Browser side only; the
 * server record goes when the push service reports the endpoint gone.
 */
export async function dropPushWhenSignedOut(): Promise<boolean> {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return false;
    await subscription.unsubscribe();
    return true;
  } catch {
    return false;
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
    const reg = await registration();
    if (!sameKey(subscription, publicKey)) {
      await subscription.unsubscribe().catch(() => false);
      subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    }
    const saved = await register(reg, subscription, publicKey, locale);
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
