"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarCheck, Link2, Loader2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  connectFeedAction,
  listFeedsAction,
  previewFeedAction,
  recordFeedSyncAction,
} from "@/app/app/feed-actions";
import { useI18n } from "@/lib/i18n/client";
import { detectMapping, reconcileMapping, type FeedMapping } from "@/lib/feeds/mapping";
import { eventDay, readFeed, type FeedEvent, type FeedSnapshot } from "@/lib/feeds/normalize";
import { applyFeedEvents, classifyEvents, FILE_FEED, isDefaultSelected, type EventStatus } from "@/lib/feeds/sync";
import { MAX_ICS_FILE_BYTES, type FeedErrorCode, type FeedInfo } from "@/lib/feeds/types";
import { normalizeFeedUrl } from "@/lib/feeds/url";
import type { Database } from "@/lib/workspace/types";
import { useWorkspace } from "../WorkspaceContext";
import { formatDay } from "../database/shared";
import { ConnectedFeeds } from "./ConnectedFeeds";
import { FeedHelp } from "./FeedHelp";
import { IMPORT_UPDATE, localTimeZone, localToday, newColumnSpecs, summarize } from "./feed-sync";
import { MappingEditor } from "./MappingEditor";

const GROUP_LIMIT = 150;

type Source = { kind: "link"; url: string; label: string; connectedFeedId: string | null } | { kind: "file"; name: string };
type Step = "start" | "loading" | "preview" | "done";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep disabled:cursor-not-allowed disabled:opacity-40";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";

const STATUS_STYLE: Record<Exclude<EventStatus, "new">, string> = {
  inTable: "bg-hover text-ink-soft ring-line-strong",
  echo: "bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:text-sky-300",
};

interface SeriesGroup {
  series: string;
  title: string;
  next: FeedEvent;
  count: number;
}

/**
 * Import deadlines into one table from a calendar feed link (Canvas, Moodle,
 * Blackboard, Brightspace, Google Calendar) or an .ics file: preview what was
 * found, choose what to bring in and which columns receive it, confirm. A
 * link can stay connected and keeps the table in sync.
 */
export function ImportDeadlinesDialog({ db, onClose }: { db: Database; onClose: () => void }) {
  const { dict, t, locale } = useI18n();
  const F = dict.feeds;
  const { workspace, update } = useWorkspace();
  const [feeds, setFeeds] = useState<FeedInfo[]>([]);
  const [step, setStep] = useState<Step>("start");
  const [link, setLink] = useState("");
  const [error, setError] = useState<FeedErrorCode | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [snapshot, setSnapshot] = useState<FeedSnapshot | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [mapping, setMapping] = useState<FeedMapping>(() => detectMapping(db));
  const [keepSynced, setKeepSynced] = useState(true);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<{ added: number; synced: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);

  const today = localToday();
  const timeZone = localTimeZone();
  const workspaceId = workspace.id;

  useEffect(() => {
    let live = true;
    listFeedsAction(workspaceId)
      .then((list) => live && setFeeds(list.filter((f) => f.databaseId === db.id)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [workspaceId, db.id]);

  const events = useMemo(() => snapshot?.events ?? [], [snapshot]);
  const statuses = useMemo(
    () => classifyEvents(workspace, db.id, events, mapping, timeZone),
    [workspace, db.id, events, mapping, timeZone],
  );

  const groups = useMemo(() => {
    const upcoming: FeedEvent[] = [];
    const earlier: FeedEvent[] = [];
    const openings: FeedEvent[] = [];
    const series = new Map<string, SeriesGroup>();
    for (const e of events) {
      const day = eventDay(e.when, timeZone);
      if (e.series) {
        const g = series.get(e.series);
        if (!g) series.set(e.series, { series: e.series, title: e.title, next: e, count: 1 });
        else {
          g.count += 1;
          if (eventDay(g.next.when, timeZone) < today && day >= today) g.next = e;
        }
      } else if (e.role === "opening") openings.push(e);
      else if (day >= today) upcoming.push(e);
      else earlier.push(e);
    }
    return { upcoming, earlier, openings, series: [...series.values()] };
  }, [events, timeZone, today]);

  const startPreview = (snap: FeedSnapshot, src: Source, savedMapping?: Partial<FeedMapping> | null) => {
    setSnapshot(snap);
    setSource(src);
    const nextMapping = reconcileMapping(db, savedMapping ?? undefined);
    setMapping(nextMapping);
    const status = classifyEvents(workspace, db.id, snap.events, nextMapping, timeZone);
    setSelected(
      new Set(snap.events.filter((e) => isDefaultSelected(e, today, timeZone) && status.get(e.key) === "new").map((e) => e.key)),
    );
    setFollowed(new Set());
    setError(null);
    setStep("preview");
  };

  const previewLink = async () => {
    const normalized = normalizeFeedUrl(link);
    if (!normalized.ok) {
      setError(normalized.error);
      linkInput.current?.focus();
      return;
    }
    setError(null);
    setStep("loading");
    try {
      const result = await previewFeedAction(workspaceId, normalized.url);
      if (!result.ok) {
        setError(result.error);
        setStep("start");
        return;
      }
      const connected = feeds.find((f) => f.id === result.connectedFeedId);
      startPreview(
        result.feed,
        { kind: "link", url: normalized.url, label: result.label, connectedFeedId: result.connectedFeedId },
        connected?.mapping,
      );
    } catch {
      setError("failed");
      setStep("start");
    }
  };

  const previewFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_ICS_FILE_BYTES) {
      setError("file_too_large");
      return;
    }
    setError(null);
    setStep("loading");
    try {
      const read = readFeed(await file.text());
      if (!read.ok) {
        setError(read.error);
        setStep("start");
        return;
      }
      startPreview(read.feed, { kind: "file", name: file.name });
    } catch {
      setError("not_calendar");
      setStep("start");
    }
  };

  const toggle = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };

  const followedKeys = useMemo(
    () => events.filter((e) => e.series && followed.has(e.series) && eventDay(e.when, timeZone) >= today).map((e) => e.key),
    [events, followed, timeZone, today],
  );
  const importCount = [...selected].filter((k) => statuses.get(k) === "new").length + followedKeys.length;
  const willConnect = source?.kind === "link" && keepSynced;

  const doImport = async () => {
    if (!snapshot || !source) return;
    setWorking(true);
    setError(null);
    try {
      let feedId = FILE_FEED;
      if (source.kind === "link" && keepSynced) {
        if (source.connectedFeedId) feedId = source.connectedFeedId;
        else {
          const connected = await connectFeedAction({
            workspaceId,
            databaseId: db.id,
            url: source.url,
            platform: snapshot.platform,
            mapping,
            series: [...followed],
          });
          if (!connected.ok) {
            setError(connected.error);
            return;
          }
          feedId = connected.feed.id;
          setFeeds((list) => [...list, connected.feed]);
        }
      }
      const options = {
        databaseId: db.id,
        feedId,
        mapping,
        today,
        timeZone,
        mode: "import" as const,
        selected: new Set([...selected, ...followedKeys]),
        horizonDay: snapshot.horizonDay,
        newColumns: newColumnSpecs(dict),
      };
      const dry = applyFeedEvents(structuredClone(workspace), snapshot.events, options);
      if (dry.changes.length > 0) {
        update((draft) => {
          applyFeedEvents(draft, snapshot.events, options);
        }, IMPORT_UPDATE);
      }
      if (feedId !== FILE_FEED) {
        const info = await recordFeedSyncAction(feedId, {
          summary: summarize(dry),
          considered: dry.considered,
          mapping: dry.mapping,
          series: [...followed],
        }).catch(() => null);
        if (info) setFeeds((list) => list.map((f) => (f.id === info.id ? info : f)));
      }
      setDone({ added: dry.changes.filter((c) => c.kind === "added").length, synced: feedId !== FILE_FEED });
      setLink("");
      setSource(null);
      setStep("done");
    } catch {
      setError("failed");
    } finally {
      setWorking(false);
    }
  };

  const dateLabel = (e: FeedEvent) =>
    formatDay(eventDay(e.when, timeZone), locale, { weekday: "short", month: "short", day: "numeric" });

  const eventRow = (e: FeedEvent) => {
    const status = statuses.get(e.key) ?? "new";
    const disabled = status !== "new";
    return (
      <li key={e.key}>
        <label className={`flex min-h-11 items-start gap-3 px-3 py-2 ${disabled ? "opacity-70" : "cursor-pointer hover:bg-hover"}`}>
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
            checked={!disabled && selected.has(e.key)}
            disabled={disabled}
            onChange={(ev) => setSelected((s) => toggle(s, e.key, ev.target.checked))}
          />
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-medium text-ink" dir="auto">
              {e.title || dict.db.untitled}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
              <span>{dateLabel(e)}</span>
              {e.course && (
                <span className="rounded-full bg-hover px-2 py-0.5" dir="auto">
                  {e.course}
                </span>
              )}
            </span>
          </span>
          {status !== "new" && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_STYLE[status]}`}>
              {status === "echo" ? F.statusEcho : F.statusInTable}
            </span>
          )}
        </label>
      </li>
    );
  };

  const eventGroup = (id: string, title: string, list: FeedEvent[], bulk = false) =>
    list.length > 0 && (
      <section aria-labelledby={id} className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 id={id} className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {title} · {list.length}
          </h4>
          {bulk && (
            <span className="ms-auto flex gap-1">
              <button
                type="button"
                className="min-h-9 rounded-md px-2 text-xs font-semibold text-ink-soft hover:bg-hover hover:text-ink"
                onClick={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    for (const e of list) if (statuses.get(e.key) === "new") next.add(e.key);
                    return next;
                  })
                }
              >
                {F.selectAll}
              </button>
              <button
                type="button"
                className="min-h-9 rounded-md px-2 text-xs font-semibold text-ink-soft hover:bg-hover hover:text-ink"
                onClick={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    for (const e of list) next.delete(e.key);
                    return next;
                  })
                }
              >
                {F.selectNone}
              </button>
            </span>
          )}
        </div>
        <ul className="divide-y divide-line rounded-lg border border-line">{list.slice(0, GROUP_LIMIT).map(eventRow)}</ul>
        {list.length > GROUP_LIMIT && <p className="text-xs text-ink-soft">{t(F.more, { count: list.length - GROUP_LIMIT })}</p>}
      </section>
    );

  const sourceName = source?.kind === "link" ? source.label : source?.name ?? "";

  return (
    <Dialog open onOpenChange={(open) => !open && !working && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-3 overflow-hidden p-4 sm:max-w-2xl sm:p-6">
        <DialogTitle className="pe-8 font-display text-lg font-bold text-ink">{F.title}</DialogTitle>
        <DialogDescription className="text-sm text-ink-soft">{F.description}</DialogDescription>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain">
          {step === "start" && (
            <>
              <ConnectedFeeds
                db={db}
                feeds={feeds}
                onFeedChange={(feed) => setFeeds((list) => list.map((f) => (f.id === feed.id ? feed : f)))}
                onFeedRemoved={(id) => setFeeds((list) => list.filter((f) => f.id !== id))}
              />
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void previewLink();
                }}
              >
                <label htmlFor="feed-link" className="text-sm font-semibold text-ink">
                  {feeds.length > 0 ? F.another : F.linkLabel}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <Link2 className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
                    <input
                      ref={linkInput}
                      id="feed-link"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      dir="ltr"
                      value={link}
                      onChange={(e) => {
                        setLink(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder={F.linkPlaceholder}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? "feed-error" : "feed-privacy"}
                      className="min-h-11 w-full rounded-lg border border-line-strong bg-card ps-9 pe-3 text-base text-ink outline-none placeholder:text-ink-faint focus:border-ink/40 sm:text-sm"
                    />
                  </div>
                  <button type="submit" className={PRIMARY} disabled={!link.trim()}>
                    {F.preview}
                  </button>
                </div>
              </form>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                <span>{F.or}</span>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".ics,text/calendar"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    void previewFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button type="button" className={SECONDARY} onClick={() => fileInput.current?.click()}>
                  <Upload className="size-4" aria-hidden />
                  {F.uploadFile}
                </button>
              </div>
              {error && (
                <p id="feed-error" role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                  {F.errors[error] ?? F.errors.failed}
                </p>
              )}
              <FeedHelp />
              <p id="feed-privacy" className="text-xs text-ink-soft">
                {F.privacy}
              </p>
            </>
          )}

          {step === "loading" && (
            <p role="status" className="flex min-h-32 items-center justify-center gap-2 text-sm text-ink-soft">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {F.loading}
            </p>
          )}

          {step === "preview" && snapshot && (
            <>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-ink">
                  {t(F.foundEvents, { count: events.length, source: snapshot.name || sourceName })}
                  <span className="ms-2 rounded-full bg-hover px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                    {F.platform[snapshot.platform]}
                  </span>
                </p>
                {events.length === 0 && <p className="text-sm text-ink-soft">{F.emptyFeed}</p>}
                {snapshot.echoes > 0 && <p className="text-xs text-ink-soft">{t(F.echoesSkipped, { count: snapshot.echoes })}</p>}
                {snapshot.warnings.includes("unsupported_recurrence") && <p className="text-xs text-ink-soft">{F.repeatNote}</p>}
              </div>

              <section aria-labelledby="feed-columns" className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
                <div>
                  <h3 id="feed-columns" className="text-sm font-semibold text-ink">
                    {F.columnsTitle}
                  </h3>
                  <p className="text-xs text-ink-soft">{F.columnsHint}</p>
                </div>
                <MappingEditor db={db} mapping={mapping} onChange={setMapping} />
              </section>

              {eventGroup("feed-upcoming", F.groups.upcoming, groups.upcoming, true)}
              {groups.series.length > 0 && (
                <section aria-labelledby="feed-series" className="flex flex-col gap-1">
                  <h4 id="feed-series" className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    {F.groups.repeating} · {groups.series.length}
                  </h4>
                  <p className="text-xs text-ink-soft">{F.repeatingHint}</p>
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {groups.series.slice(0, GROUP_LIMIT).map((g) => (
                      <li key={g.series}>
                        <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2 hover:bg-hover">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                            checked={followed.has(g.series)}
                            onChange={(ev) => setFollowed((s) => toggle(s, g.series, ev.target.checked))}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-sm font-medium text-ink" dir="auto">
                              {g.title || dict.db.untitled}
                            </span>
                            <span className="text-xs text-ink-soft">
                              {t(F.repeats, { count: g.count })} · {dateLabel(g.next)}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {eventGroup("feed-earlier", F.groups.earlier, groups.earlier, true)}
              {eventGroup("feed-openings", F.groups.openings, groups.openings, true)}

              {source?.kind === "link" && !source.connectedFeedId && (
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line p-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                    checked={keepSynced}
                    onChange={(e) => setKeepSynced(e.target.checked)}
                  />
                  <span>{F.keepInSync}</span>
                </label>
              )}
              {error && (
                <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                  {F.errors[error] ?? F.errors.failed}
                </p>
              )}
            </>
          )}

          {step === "done" && done && (
            <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
              <CalendarCheck className="size-8 text-lime" aria-hidden />
              <p className="font-display text-base font-bold text-ink">{F.doneTitle}</p>
              <p className="text-sm text-ink-soft">{t(F.doneAdded, { count: done.added, table: db.name || dict.db.untitled })}</p>
              {done.synced && <p className="text-sm text-ink-soft">{F.doneSynced}</p>}
              {done.added > 0 && <p className="text-xs text-ink-faint">{F.doneUndo}</p>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
          {step === "preview" && (
            <>
              <button type="button" className={`${SECONDARY} me-auto`} onClick={() => setStep("start")} disabled={working}>
                <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
                {F.back}
              </button>
              <button
                type="button"
                className={PRIMARY}
                disabled={working || (importCount === 0 && !willConnect) || !mapping.title}
                onClick={() => void doImport()}
              >
                {working && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {importCount > 0 ? t(F.importButton, { count: importCount }) : willConnect ? F.connectOnly : F.nothingSelected}
              </button>
            </>
          )}
          {step !== "preview" && (
            <button type="button" className={SECONDARY} onClick={onClose}>
              {F.close}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
