"use client";

import { useState } from "react";
import { CalendarSync, Columns3, Loader2, Trash2 } from "lucide-react";
import { disconnectFeedAction, updateFeedSettingsAction } from "@/app/app/feed-actions";
import { useI18n } from "@/lib/i18n/client";
import { reconcileMapping, type FeedMapping } from "@/lib/feeds/mapping";
import type { FeedErrorCode, FeedInfo } from "@/lib/feeds/types";
import type { Database } from "@/lib/workspace/types";
import { useWorkspace } from "../WorkspaceContext";
import { rowTitle } from "../database/shared";
import { summaryText, syncConnectedFeed, syncMapping } from "./feed-sync";
import { MappingEditor } from "./MappingEditor";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9";

export function relativeTime(iso: string, locale: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 3_600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3_600), "hour");
  return rtf.format(Math.round(seconds / 86_400), "day");
}

/**
 * The calendars connected to this table: when each last synced and what
 * changed, Sync now, column mapping, Disconnect (confirmed), plus the rows
 * whose event vanished from the calendar, to keep or delete.
 */
export function ConnectedFeeds({
  db,
  feeds,
  onFeedChange,
  onFeedRemoved,
}: {
  db: Database;
  feeds: FeedInfo[];
  onFeedChange: (feed: FeedInfo) => void;
  onFeedRemoved: (feedId: string) => void;
}) {
  const { dict, t, locale } = useI18n();
  const F = dict.feeds;
  const { workspace, update } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, FeedErrorCode>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const flagged = db.rows.filter((r) => r.source?.missingSince);

  const syncNow = async (feed: FeedInfo) => {
    setBusy(feed.id);
    setErrors((e) => {
      const next = { ...e };
      delete next[feed.id];
      return next;
    });
    try {
      const outcome = await syncConnectedFeed(feed.id, false, {
        getWorkspace: () => workspace,
        update,
        dict,
      });
      if (outcome.ok) {
        if (outcome.feed) onFeedChange(outcome.feed);
      } else if (outcome.error !== "fresh") {
        setErrors((e) => ({ ...e, [feed.id]: outcome.error as FeedErrorCode }));
      }
    } catch {
      setErrors((e) => ({ ...e, [feed.id]: "failed" }));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (feed: FeedInfo) => {
    setBusy(feed.id);
    try {
      if (await disconnectFeedAction(feed.id)) onFeedRemoved(feed.id);
      else setErrors((e) => ({ ...e, [feed.id]: "failed" }));
    } catch {
      setErrors((e) => ({ ...e, [feed.id]: "failed" }));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const saveMapping = async (feed: FeedInfo, mapping: FeedMapping) => {
    const saved = await updateFeedSettingsAction(feed.id, { mapping: syncMapping(mapping) }).catch(() => null);
    if (saved) onFeedChange(saved);
  };

  return (
    <div className="flex flex-col gap-3">
      {feeds.length > 0 && (
        <section aria-labelledby="feeds-connected" className="flex flex-col gap-2">
          <h3 id="feeds-connected" className="text-sm font-semibold text-ink">
            {F.connectedTitle}
          </h3>
          <ul className="flex flex-col gap-2">
            {feeds.map((feed) => {
              const error = errors[feed.id] ?? feed.lastError;
              const changes = feed.lastSummary ? summaryText(feed.lastSummary, dict, t) : "";
              return (
                <li key={feed.id} className="rounded-lg border border-line bg-card p-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink" dir="ltr">
                        {F.platform[feed.platform]} · {feed.label}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {feed.lastSyncedAt ? t(F.lastSynced, { when: relativeTime(feed.lastSyncedAt, locale) }) : F.neverSynced}
                        {feed.lastSummary && <> · {t(F.lastChanges, { summary: changes || F.noChanges })}</>}
                      </p>
                      {error && (
                        <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                          {F.errors[error] ?? F.errors.failed}
                        </p>
                      )}
                      {feed.lastSummary && feed.lastSummary.titles.added.length + feed.lastSummary.titles.updated.length > 0 && (
                        <details className="mt-1 text-xs text-ink-soft">
                          <summary className="cursor-pointer py-1 text-ink-soft hover:text-ink">{F.whatChanged}</summary>
                          <ul className="ms-4 list-disc space-y-0.5" dir="auto">
                            {feed.lastSummary.titles.added.map((title, i) => (
                              <li key={`a${i}`}>
                                {F.changeAdded}: {title}
                              </li>
                            ))}
                            {feed.lastSummary.titles.updated.map((title, i) => (
                              <li key={`u${i}`}>
                                {F.changeUpdated}: {title}
                              </li>
                            ))}
                            {feed.lastSummary.titles.flagged.map((title, i) => (
                              <li key={`f${i}`}>
                                {F.changeFlagged}: {title}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={BUTTON} onClick={() => void syncNow(feed)} disabled={busy !== null}>
                        {busy === feed.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <CalendarSync className="size-4" aria-hidden />
                        )}
                        {busy === feed.id ? F.syncing : F.syncNow}
                      </button>
                      <button
                        type="button"
                        className={BUTTON}
                        aria-expanded={editing === feed.id}
                        aria-label={F.columnsTitle}
                        onClick={() => setEditing((v) => (v === feed.id ? null : feed.id))}
                      >
                        <Columns3 className="size-4" aria-hidden />
                        <span className="hidden sm:inline">{F.columnsTitle}</span>
                      </button>
                      <button
                        type="button"
                        className={BUTTON}
                        onClick={() => setConfirming(feed.id)}
                        disabled={busy !== null}
                      >
                        {F.disconnect}
                      </button>
                    </div>
                  </div>
                  {editing === feed.id && (
                    <div className="mt-3 border-t border-line pt-3">
                      <MappingEditor
                        db={db}
                        allowNew={false}
                        mapping={syncMapping(reconcileMapping(db, feed.mapping ?? undefined))}
                        onChange={(mapping) => void saveMapping(feed, mapping)}
                      />
                    </div>
                  )}
                  {confirming === feed.id && (
                    <div role="alertdialog" aria-label={F.disconnect} className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface p-2">
                      <p className="min-w-0 flex-1 text-sm text-ink">{t(F.confirmDisconnect, { source: feed.label })}</p>
                      <button type="button" className={BUTTON} onClick={() => setConfirming(null)}>
                        {dict.common.cancel}
                      </button>
                      <button
                        type="button"
                        onClick={() => void disconnect(feed)}
                        className="inline-flex min-h-11 items-center rounded-lg bg-rose-600 px-3 text-sm font-semibold text-white transition hover:bg-rose-700 sm:min-h-9"
                      >
                        {F.confirm}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {flagged.length > 0 && (
        <section aria-labelledby="feeds-flagged" className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-400/10 p-3">
          <h3 id="feeds-flagged" className="text-sm font-semibold text-ink">
            {F.flaggedTitle}
          </h3>
          <p className="text-xs text-ink-soft">{F.flaggedHint}</p>
          <ul className="divide-y divide-line">
            {flagged.map((row) => {
              const title = rowTitle(db, row) || dict.db.untitled;
              return (
                <li key={row.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink" dir="auto">
                    {title}
                  </span>
                  <button
                    type="button"
                    className={BUTTON}
                    aria-label={t(F.keepLabel, { title })}
                    onClick={() =>
                      update((d) => {
                        const r = d.databases.find((x) => x.id === db.id)?.rows.find((x) => x.id === row.id);
                        if (r) delete r.source;
                      })
                    }
                  >
                    {F.keep}
                  </button>
                  <button
                    type="button"
                    className={`${BUTTON} text-rose-600 dark:text-rose-400`}
                    aria-label={t(F.removeLabel, { title })}
                    onClick={() =>
                      update((d) => {
                        const target = d.databases.find((x) => x.id === db.id);
                        if (target) target.rows = target.rows.filter((x) => x.id !== row.id);
                      })
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                    <span className="hidden sm:inline">{F.remove}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
