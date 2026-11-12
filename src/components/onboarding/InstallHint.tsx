"use client";

import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

const DISMISS_KEY = "studyos:install-hint";
const VISITS_KEY = "studyos:visits";
const SESSION_KEY = "studyos:visit-counted";

/** The non-standard event Chromium fires when the app can be installed. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallMode = "prompt" | "ios" | null;

export interface InstallEnv {
  standalone: boolean;
  phone: boolean;
  ios: boolean;
  dismissed: boolean;
  visits: number;
  canPrompt: boolean;
}

/**
 * Whether to show the hint, and which kind. Gentle by design: only on
 * phones, not inside the installed app, never after "Not now", and only from
 * the student's second visit (a first visit is for getting set up).
 */
export function installHintMode(env: InstallEnv): InstallMode {
  if (env.standalone || !env.phone || env.dismissed || env.visits < 2) return null;
  if (env.canPrompt) return "prompt";
  if (env.ios) return "ios";
  return null;
}

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string) {
  try {
    storage().setItem(key, value);
  } catch {
    // Private mode or storage disabled: the hint simply shows again later.
  }
}

/** Count one visit per browser session. */
function countVisit(): number {
  const visits = Number(read(() => localStorage, VISITS_KEY) ?? "0") || 0;
  if (read(() => sessionStorage, SESSION_KEY)) return visits;
  write(() => sessionStorage, SESSION_KEY, "1");
  write(() => localStorage, VISITS_KEY, String(visits + 1));
  return visits + 1;
}

/** A small, dismissible "add to home screen" card on phones. */
export function InstallHint() {
  const { dict } = useI18n();
  const I = dict.install;
  const [mode, setMode] = useState<InstallMode>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const phone = window.matchMedia?.("(pointer: coarse) and (max-width: 820px)").matches ?? false;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    const dismissed = read(() => localStorage, DISMISS_KEY) === "dismissed";
    const visits = countVisit();
    const env = { standalone, phone, ios, dismissed, visits };

    const timer = setTimeout(() => setMode(installHintMode({ ...env, canPrompt: false })), 1500);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setMode(installHintMode({ ...env, canPrompt: true }));
    };
    const onInstalled = () => setMode(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!mode) return null;

  const dismiss = () => {
    write(() => localStorage, DISMISS_KEY, "dismissed");
    setMode(null);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt().catch(() => {});
    const choice = await deferred.userChoice.catch(() => null);
    setDeferred(null);
    if (choice?.outcome === "accepted") setMode(null);
    else dismiss();
  };

  return (
    <aside
      aria-label={I.title}
      data-print="hide"
      className="fixed inset-x-3 bottom-[calc(max(1rem,env(safe-area-inset-bottom))+3.75rem)] z-30 mx-auto flex max-w-md items-start gap-3 rounded-xl border border-line-strong bg-card p-3 text-ink shadow-pop"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{I.title}</p>
        <p className="mt-0.5 text-xs text-ink-soft">
          {mode === "ios" ? (
            <>
              <Share className="me-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
              {I.iosSteps}
            </>
          ) : (
            I.body
          )}
        </p>
        {mode === "prompt" && (
          <button
            type="button"
            onClick={install}
            className="mt-2 min-h-11 rounded-md bg-lime px-3.5 text-xs font-semibold text-lime-on transition hover:bg-lime-deep"
          >
            {I.install}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={I.dismiss}
        title={I.dismiss}
        className="-me-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </aside>
  );
}
