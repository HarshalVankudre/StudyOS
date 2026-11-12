"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { DAILY_CAP } from "@/lib/notifications/preferences";
import { PermissionExplainer } from "./PermissionExplainer";
import { enablePush, fetchSettings, permission, pushSupport, syncPush } from "./push-client";

const DISMISS_KEY = "studyos:notify-prompt-dismissed";
const SYNC_KEY = "studyos:notify-synced";
/** "Not now" hides the suggestion for this long. */
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
const SYNC_MS = 24 * 60 * 60 * 1000;

function readTime(key: string): number {
  try {
    return Number(window.localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeTime(key: string, value = Date.now()): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // private mode: the suggestion may come back, which is harmless
  }
}

type View =
  | { kind: "hidden" }
  | { kind: "offer"; publicKey: string }
  | { kind: "explain"; publicKey: string }
  | { kind: "ios" }
  | { kind: "done"; ok: boolean; denied?: boolean };

/**
 * A small, dismissible suggestion on the Today view to turn notifications on.
 * Shown only when push is configured, this device can receive it (or, on an
 * iPhone, explains the home-screen step), no device is on yet, the browser
 * has not been told to block it, and the student has not said "Not now"
 * recently. Also keeps an already-on device's subscription current.
 */
export function NotificationPrompt() {
  const { dict, locale } = useI18n();
  const N = dict.notifications;
  const [view, setView] = useState<View>({ kind: "hidden" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const support = pushSupport();
    if (support === "unsupported") return;
    let cancelled = false;
    void (async () => {
      const dismissed = Date.now() - readTime(DISMISS_KEY) < DISMISS_MS;
      const granted = support === "supported" && permission() === "granted";
      if (dismissed && !granted) return;
      if (granted && Date.now() - readTime(SYNC_KEY) < SYNC_MS) return;
      const settings = await fetchSettings();
      if (cancelled || !settings?.configured || !settings.publicKey) return;
      if (granted && (await syncPush(settings.publicKey, locale))) {
        writeTime(SYNC_KEY);
        return;
      }
      if (cancelled || dismissed || settings.devices > 0) return;
      if (support === "ios-needs-install") setView({ kind: "ios" });
      else if (permission() !== "denied") setView({ kind: "offer", publicKey: settings.publicKey });
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (view.kind === "hidden") return null;

  const dismiss = () => {
    writeTime(DISMISS_KEY);
    setView({ kind: "hidden" });
  };

  const turnOn = async (publicKey: string) => {
    setBusy(true);
    const result = await enablePush(publicKey, locale);
    setBusy(false);
    if (result.ok) writeTime(SYNC_KEY);
    if (!result.ok && result.reason === "dismissed") {
      setView({ kind: "offer", publicKey });
      return;
    }
    setView({ kind: "done", ok: result.ok, denied: !result.ok && result.reason === "denied" });
  };

  return (
    <div className="border-t border-line bg-surface px-4 py-4 sm:px-6" aria-labelledby="notify-prompt-title" role="region">
      {view.kind === "explain" ? (
        <PermissionExplainer
          cap={DAILY_CAP}
          pending={busy}
          onContinue={() => void turnOn(view.publicKey)}
          onCancel={dismiss}
        />
      ) : view.kind === "done" ? (
        <p role="status" className="text-sm leading-6 text-ink-soft" id="notify-prompt-title">
          {view.ok ? N.enabledHere : view.denied ? N.deniedBody : N.failed}{" "}
          <Link href="/app/settings#notifications" className="font-semibold text-ink underline-offset-4 hover:underline">
            {N.settingsLink}
          </Link>
        </p>
      ) : (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-lime-faint text-lime-deep">
            <Bell className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p id="notify-prompt-title" className="text-sm font-semibold text-ink">
              {N.promptTitle}
            </p>
            <p className="mt-0.5 text-sm leading-6 text-ink-soft">{view.kind === "ios" ? N.promptIos : N.promptBody}</p>
            {view.kind === "offer" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setView({ kind: "explain", publicKey: view.publicKey })}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-paper transition hover:opacity-90"
                >
                  {N.turnOn}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-card px-4 text-sm font-semibold text-ink-soft transition hover:text-ink"
                >
                  {N.promptDismiss}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={N.promptDismissAria}
            className="-me-2 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-faint transition hover:bg-hover hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
