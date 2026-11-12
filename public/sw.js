/*
 * StudyOS service worker: an offline fallback page, plus showing and opening
 * notifications (see the end of this file). It caches nothing else.
 *
 * - It precaches exactly two public, static files: /offline.html and its icon.
 * - Page navigations go to the network as normal; only when the network fails
 *   does it answer with the cached offline page.
 * - It never stores a page, an API response or anything authenticated, and it
 *   does not touch any other request (they go straight to the network).
 */
const CACHE = "studyos-offline-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // The offline page's own icon, so the page renders complete offline.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});

/*
 * Notifications (Web Push). The server sends a small JSON message
 * ({ title, body, url, tag, lang, dir }, see src/lib/notifications/content.ts);
 * this shows it, and a tap opens the place it names. Nothing is cached here.
 */
const NOTIFICATION_ICON = "/icons/icon-192.png";
const FALLBACK_PATH = "/app";

/** A same-origin path to open, or the app's home when the link is unusable. */
function safePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return FALLBACK_PATH;
  try {
    const target = new URL(value, self.location.origin);
    if (target.origin !== self.location.origin) return FALLBACK_PATH;
    return target.pathname + target.search + target.hash;
  } catch {
    return FALLBACK_PATH;
  }
}

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = {};
  }
  const title = typeof message.title === "string" && message.title ? message.title : "StudyOS";
  const options = {
    body: typeof message.body === "string" ? message.body : "",
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_ICON,
    data: { url: safePath(message.url) },
  };
  if (typeof message.tag === "string" && message.tag) options.tag = message.tag;
  if (typeof message.lang === "string") options.lang = message.lang;
  if (message.dir === "rtl" || message.dir === "ltr") options.dir = message.dir;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      // Reuse an open StudyOS window: bring it forward and take it there.
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        const focused = await open.focus().catch(() => open);
        if (typeof focused.navigate === "function") {
          const moved = await focused.navigate(target).catch(() => null);
          if (moved) return moved;
        }
      }
      // No window, or one this worker may not steer: open the place directly.
      return self.clients.openWindow(target);
    }),
  );
});
