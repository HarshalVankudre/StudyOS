/**
 * How the focus timer gets the student's attention when a block ends: a short
 * two-note chime made with the Web Audio API (no audio files), and a system
 * notification, but only where the student has already allowed notifications.
 * Nothing here ever asks for permission on its own.
 */

type AudioContextCtor = typeof AudioContext;

let context: AudioContext | null = null;

function audioContextClass(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Create or wake the audio context. Browsers only allow sound after a user
 * gesture, so this runs on Start/Resume clicks; the chime at the end of the
 * block can then play even if the tab is in the background.
 */
export function unlockAudio(): void {
  try {
    const Ctor = audioContextClass();
    if (!Ctor) return;
    context ??= new Ctor();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {
    context = null;
  }
}

/** Two soft rising notes, about half a second in all. */
export function playChime(): void {
  try {
    const Ctor = audioContextClass();
    if (!Ctor) return;
    context ??= new Ctor();
    const ctx = context;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const start = ctx.currentTime + 0.02;
    [
      { freq: 659.25, at: 0 },
      { freq: 987.77, at: 0.18 },
    ].forEach(({ freq, at }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(0.18, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.42);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + at);
      osc.stop(start + at + 0.45);
    });
  } catch {
    // No audio on this device: the screen and the title still say it.
  }
}

export type NotificationState = "unsupported" | "default" | "granted" | "denied";

export function notificationState(): NotificationState {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") return "unsupported";
  return window.Notification.permission;
}

/** Ask for permission. Only ever called from the student's own click. */
export async function requestNotifications(): Promise<NotificationState> {
  if (notificationState() === "unsupported") return "unsupported";
  try {
    return await window.Notification.requestPermission();
  } catch {
    return notificationState();
  }
}

/**
 * Show a system notification when allowed and the student is looking
 * elsewhere (in the tab, the panel and the chime already say it).
 */
export async function notifyBlockEnd(title: string, body: string): Promise<void> {
  if (notificationState() !== "granted") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  const options: NotificationOptions = { body, tag: "studyos-focus", icon: "/icons/icon-192.png" };
  try {
    const shown = new window.Notification(title, options);
    shown.onclick = () => {
      window.focus();
      shown.close();
    };
    return;
  } catch {
    // Android Chrome only allows notifications through the service worker.
  }
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.showNotification(title, {
      ...options,
      data: { url: `${window.location.pathname}${window.location.search}` },
    });
  } catch {
    // Not available here: the chime and the panel still tell the student.
  }
}
