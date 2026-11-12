"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Bell, BellOff, Send, Smartphone } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/interpolate";
import {
  LEAD_DAY_OPTIONS,
  minuteToTime,
  normalizeLeads,
  timeToMinute,
  type NotificationPreferences,
} from "@/lib/notifications/preferences";
import { afterQuietHours } from "@/lib/notifications/schedule";
import type { NotificationSettingsView } from "@/lib/notifications/service";
import { cn } from "@/lib/utils";
import { PermissionExplainer } from "./PermissionExplainer";
import { Switch } from "./Switch";
import {
  browserTimeZone,
  disableEverywhere,
  disablePush,
  enablePush,
  permission,
  pushSupport,
  sendTest,
  syncPush,
  type PermissionState,
  type PushSupport,
} from "./push-client";

type Copy = ReturnType<typeof useI18n>["dict"]["notifications"];

const noop = () => () => {};

/** "8:00 AM" / "08:00" in the student's language (a wall time, no zone). */
export function formatClock(minute: number, locale: string): string {
  return new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60)).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/**
 * The notifications section of the settings page: turn notifications on or
 * off for this device (with an explanation before the browser asks), send a
 * test, and choose what arrives and when. Hidden entirely by the page when
 * push is not configured.
 */
export function NotificationSettings({ initial }: { initial: NotificationSettingsView }) {
  const { dict, locale } = useI18n();
  const N = dict.notifications;
  // Browser facts, read after hydration (null / "default" on the server).
  const support = useSyncExternalStore<PushSupport | null>(noop, pushSupport, () => null);
  const browserPerm = useSyncExternalStore<PermissionState>(noop, permission, () => "default");
  const [permAfterAsking, setPerm] = useState<PermissionState | null>(null);
  const perm = permAfterAsking ?? browserPerm;
  const [hereOn, setHereOn] = useState(false);
  const [devices, setDevices] = useState(initial.devices);
  const [explaining, setExplaining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (support !== "supported" || !initial.publicKey) return;
    let cancelled = false;
    // Is this browser on? (Also refreshes the server's copy of it.)
    void syncPush(initial.publicKey, locale).then((on) => {
      if (!cancelled) setHereOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, [support, initial.publicKey, locale]);

  const turnOn = async () => {
    if (!initial.publicKey) return;
    setBusy(true);
    setStatus(null);
    const result = await enablePush(initial.publicKey, locale);
    setBusy(false);
    setExplaining(false);
    setPerm(permission());
    if (result.ok) {
      setHereOn(true);
      setDevices(result.devices);
      setStatus(N.enabledHere);
    } else if (result.reason !== "denied") {
      setStatus(result.reason === "failed" ? N.failed : null);
    }
  };

  const turnOff = async (everywhere: boolean) => {
    setBusy(true);
    setStatus(null);
    const result = everywhere ? await disableEverywhere() : await disablePush();
    setBusy(false);
    if (!result.ok) {
      setStatus(N.failed);
      return;
    }
    setHereOn(false);
    setDevices(result.devices ?? 0);
    setStatus(N.disabledHere);
  };

  const test = async () => {
    setBusy(true);
    const result = await sendTest();
    setBusy(false);
    setStatus(result === "sent" ? N.testSent : result === "limited" ? N.testLimited : N.testFailed);
  };

  const others = Math.max(0, devices - (hereOn ? 1 : 0));

  return (
    <div>
      <DeviceStatus
        N={N}
        support={support}
        perm={perm}
        hereOn={hereOn}
        others={others}
        busy={busy}
        explaining={explaining}
        cap={initial.dailyCap}
        onStart={() => {
          setStatus(null);
          setExplaining(true);
        }}
        onContinue={turnOn}
        onCancel={() => setExplaining(false)}
        onOff={() => turnOff(false)}
        onOffAll={() => turnOff(true)}
        onTest={test}
      />
      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-ink-soft">
        {status}
      </p>
      {devices > 0 && (
        <PreferencesForm
          N={N}
          locale={locale}
          initial={initial.preferences}
          agentEnabled={initial.agentEnabled}
          cap={initial.dailyCap}
        />
      )}
    </div>
  );
}

function DeviceStatus({
  N,
  support,
  perm,
  hereOn,
  others,
  busy,
  explaining,
  cap,
  onStart,
  onContinue,
  onCancel,
  onOff,
  onOffAll,
  onTest,
}: {
  N: Copy;
  support: PushSupport | null;
  perm: PermissionState;
  hereOn: boolean;
  others: number;
  busy: boolean;
  explaining: boolean;
  cap: number;
  onStart: () => void;
  onContinue: () => void;
  onCancel: () => void;
  onOff: () => void;
  onOffAll: () => void;
  onTest: () => void;
}) {
  const elsewhere =
    others > 0 ? (
      <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-soft">
        <Smartphone className="h-4 w-4 shrink-0" aria-hidden />
        {fmt(hereOn ? (others === 1 ? N.otherDevicesOne : N.otherDevicesOther) : others === 1 ? N.onElsewhereOne : N.onElsewhereOther, { count: others })}
      </p>
    ) : null;
  const offAll =
    others > 0 ? (
      <button
        type="button"
        onClick={onOffAll}
        disabled={busy}
        className="inline-flex min-h-11 items-center text-sm font-medium text-ink-soft transition hover:text-rose-600 disabled:opacity-50"
      >
        {N.turnOffAll}
      </button>
    ) : null;

  if (support === null) return <div className="min-h-11" aria-hidden />;

  if (support === "ios-needs-install") {
    return (
      <div>
        <Notice title={N.iosInstallTitle} body={N.iosInstallBody} />
        {elsewhere}
        {offAll}
      </div>
    );
  }
  if (support === "unsupported") {
    return (
      <div>
        <p className="text-sm text-ink-soft">{N.unsupported}</p>
        {elsewhere}
        {offAll}
      </div>
    );
  }
  if (perm === "denied" && !hereOn) {
    return (
      <div>
        <Notice title={N.deniedTitle} body={N.deniedBody} />
        {elsewhere}
        {offAll}
      </div>
    );
  }

  if (hereOn) {
    return (
      <div>
        <p className="inline-flex items-center gap-2 rounded-full bg-lime-faint px-3 py-1 text-sm font-semibold text-ink">
          <Bell className="h-4 w-4 text-lime-deep" aria-hidden />
          {N.onHere}
        </p>
        {elsewhere}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onTest}
            disabled={busy}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink/15 bg-card px-4 text-sm font-semibold text-ink transition hover:border-ink/40 disabled:opacity-50"
          >
            <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            {N.sendTest}
          </button>
          <button
            type="button"
            onClick={onOff}
            disabled={busy}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink/15 bg-card px-4 text-sm font-semibold text-ink transition hover:border-ink/40 disabled:opacity-50"
          >
            <BellOff className="h-4 w-4" aria-hidden />
            {busy ? N.turningOff : N.turnOff}
          </button>
          {offAll}
        </div>
      </div>
    );
  }

  return (
    <div>
      {explaining ? (
        <PermissionExplainer cap={cap} pending={busy} onContinue={onContinue} onCancel={onCancel} />
      ) : (
        <button
          type="button"
          onClick={onStart}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink px-5 text-sm font-semibold text-paper transition hover:bg-ink/90"
        >
          <Bell className="h-4 w-4" aria-hidden />
          {N.turnOn}
        </button>
      )}
      {elsewhere}
      {!explaining && offAll}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-line-strong bg-surface p-4">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm leading-6 text-ink-soft">{body}</p>
    </div>
  );
}

function PreferencesForm({
  N,
  locale,
  initial,
  agentEnabled,
  cap,
}: {
  N: Copy;
  locale: string;
  initial: NotificationPreferences;
  agentEnabled: boolean;
  cap: number;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const ids = {
    daily: useId(),
    dailyHint: useId(),
    deadline: useId(),
    deadlineHint: useId(),
    streak: useId(),
    streakHint: useId(),
    quiet: useId(),
    quietHint: useId(),
  };
  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);
  const set = (patch: Partial<NotificationPreferences>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    setState("idle");
  };

  const save = async () => {
    setState("saving");
    try {
      const res = await fetch("/api/notifications/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // The device's current zone and language: the student may have moved.
        body: JSON.stringify({ ...prefs, timeZone: browserTimeZone() ?? prefs.timeZone, locale }),
      });
      if (!res.ok) throw new Error("save failed");
      const json = (await res.json()) as { preferences: NotificationPreferences };
      setPrefs(json.preferences);
      setSaved(json.preferences);
      setState("saved");
    } catch {
      setState("failed");
    }
  };

  const quietNote = (minute: number): string | null => {
    const landed = afterQuietHours(minute, prefs, true);
    if (landed === minute) return null;
    return landed === null ? N.inQuietSkipped : fmt(N.inQuiet, { time: formatClock(landed, locale) });
  };

  return (
    <form
      className="mt-4 border-t border-ink/10 pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3 className="font-display text-base font-bold">{N.chooseTitle}</h3>

      <Row id={ids.daily} hintId={ids.dailyHint} label={N.dailyLabel} hint={N.dailyHint} checked={prefs.dailyEnabled} onChange={(v) => set({ dailyEnabled: v })}>
        {prefs.dailyEnabled && (
          <>
            <TimeField label={N.timeLabel} minute={prefs.dailyMinute} onChange={(m) => set({ dailyMinute: m })} />
            <Note text={quietNote(prefs.dailyMinute)} />
            {!agentEnabled && (
              <p className="mt-2 text-xs leading-5 text-ink-soft">
                {N.dailyAgentOff}{" "}
                <Link href="/app/agents#settings" className="font-semibold text-ink underline-offset-4 hover:underline">
                  {N.dailyAgentLink}
                </Link>
              </p>
            )}
          </>
        )}
      </Row>

      <Row id={ids.deadline} hintId={ids.deadlineHint} label={N.deadlineLabel} hint={N.deadlineHint} checked={prefs.deadlineEnabled} onChange={(v) => set({ deadlineEnabled: v })}>
        {prefs.deadlineEnabled && (
          <>
            <TimeField label={N.timeLabel} minute={prefs.deadlineMinute} onChange={(m) => set({ deadlineMinute: m })} />
            <Note text={quietNote(prefs.deadlineMinute)} />
            <LeadPicker N={N} label={N.leadLabel} value={prefs.deadlineLeads} onChange={(v) => set({ deadlineLeads: v })} />
            <LeadPicker N={N} label={N.examLeadLabel} value={prefs.examLeads} onChange={(v) => set({ examLeads: v })} />
          </>
        )}
      </Row>

      <Row id={ids.streak} hintId={ids.streakHint} label={N.streakLabel} hint={N.streakHint} checked={prefs.streakEnabled} onChange={(v) => set({ streakEnabled: v })} />

      <Row id={ids.quiet} hintId={ids.quietHint} label={N.quietLabel} hint={N.quietHint} checked={prefs.quietEnabled} onChange={(v) => set({ quietEnabled: v })}>
        {prefs.quietEnabled && (
          <div className="flex flex-wrap gap-3">
            <TimeField label={N.quietFrom} minute={prefs.quietStart} onChange={(m) => set({ quietStart: m })} />
            <TimeField label={N.quietTo} minute={prefs.quietEnd} onChange={(m) => set({ quietEnd: m })} />
          </div>
        )}
      </Row>

      <p className="mt-4 text-xs leading-5 text-ink-soft">
        {fmt(N.timeZoneNote, { zone: browserTimeZone() ?? prefs.timeZone })} {fmt(N.capNote, { cap })}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || state === "saving"}
          className="inline-flex min-h-11 items-center rounded-lg bg-ink px-5 text-sm font-semibold text-paper transition hover:bg-ink/90 disabled:opacity-50"
        >
          {state === "saving" ? N.saving : N.save}
        </button>
        <span role="status" aria-live="polite" className="text-sm text-ink-soft">
          {state === "saved" ? N.saved : state === "failed" ? N.failed : ""}
        </span>
      </div>
    </form>
  );
}

function Row({
  id,
  hintId,
  label,
  hint,
  checked,
  onChange,
  children,
}: {
  id: string;
  hintId: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-4 border-b border-ink/5 pb-4 last-of-type:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id={id} className="text-sm font-semibold text-ink">
            {label}
          </p>
          <p id={hintId} className="mt-0.5 text-sm leading-6 text-ink-soft">
            {hint}
          </p>
        </div>
        <Switch checked={checked} onChange={onChange} labelledBy={id} describedBy={hintId} />
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function TimeField({ label, minute, onChange }: { label: string; minute: number; onChange: (minute: number) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-ink-soft">
        {label}
      </label>
      <input
        id={id}
        type="time"
        step={300}
        value={minuteToTime(minute)}
        onChange={(e) => {
          const next = timeToMinute(e.target.value);
          if (next !== null) onChange(next);
        }}
        className="min-h-11 rounded-lg border border-ink/15 bg-paper px-3 text-sm text-ink outline-none focus:border-ink/40"
      />
    </div>
  );
}

function Note({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-400">{text}</p>;
}

function LeadPicker({
  N,
  label,
  value,
  onChange,
}: {
  N: Copy;
  label: string;
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const labelId = useId();
  return (
    <div className="mt-3">
      <p id={labelId} className="text-sm text-ink-soft">
        {label}
      </p>
      <div role="group" aria-labelledby={labelId} className="mt-2 flex flex-wrap gap-2">
        {[...LEAD_DAY_OPTIONS].reverse().map((days) => {
          const on = value.includes(days);
          return (
            <button
              key={days}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(normalizeLeads(on ? value.filter((d) => d !== days) : [...value, days]))}
              className={cn(
                "min-h-10 rounded-full border px-3.5 text-sm transition",
                on
                  ? "border-lime bg-lime-faint font-semibold text-ink"
                  : "border-line-strong bg-surface text-ink-soft hover:bg-hover hover:text-ink",
              )}
            >
              {fmt(days === 1 ? N.leadOne : N.leadOther, { count: days })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
