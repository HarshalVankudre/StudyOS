"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Loader2, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  getPageShareAction,
  setPageShareAction,
  type PageShareError,
  type PageShareView,
} from "@/app/app/share-actions";
import { useI18n } from "@/lib/i18n/client";
import { MAX_ACTIVE_SHARES_PER_USER } from "@/lib/share/config";
import { cn } from "@/lib/utils";

/** Opens the share dialog for the open page (the phone header's "More" menu sends it). */
export const OPEN_SHARE_EVENT = "studyos:open-share";

/**
 * "Share" for the open page, in the workspace header: a dialog to turn a
 * public, read-only link on or off (off by default), copy it and see how
 * often it was opened. The link shows only this page; the dialog says so.
 */
export function ShareButton({ workspaceId, pageId }: { workspaceId: string; pageId: string | undefined }) {
  const { dict } = useI18n();
  const S = dict.share;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_SHARE_EVENT, show);
    return () => window.removeEventListener(OPEN_SHARE_EVENT, show);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!pageId}
        aria-label={S.title}
        title={S.title}
        className="hidden h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-ink-soft transition hover:bg-hover hover:text-ink disabled:opacity-40 sm:inline-flex lg:px-2.5"
      >
        <Share2 className="h-4 w-4" aria-hidden />
        <span className="hidden lg:inline">{S.button}</span>
      </button>
      {open && pageId && (
        <ShareDialog workspaceId={workspaceId} pageId={pageId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

type Status = "loading" | "ready" | "saving";

function ShareDialog({ workspaceId, pageId, onClose }: { workspaceId: string; pageId: string; onClose: () => void }) {
  const { dict, t, plural, locale } = useI18n();
  const S = dict.share;
  const [share, setShare] = useState<PageShareView | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<PageShareError | null>(null);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  const ids = useId();

  useEffect(() => {
    let live = true;
    getPageShareAction({ workspaceId, pageId })
      .then((result) => {
        if (!live) return;
        if (result.ok) setShare(result.share);
        else setError(result.error);
        setStatus("ready");
      })
      .catch(() => {
        if (!live) return;
        setError("failed");
        setStatus("ready");
      });
    return () => {
      live = false;
    };
  }, [workspaceId, pageId]);

  const errorText: Record<PageShareError, string> = {
    failed: S.errors.failed,
    invalid: S.errors.failed,
    limit: t(S.errors.limit, { max: MAX_ACTIVE_SHARES_PER_USER }),
    not_found: S.errors.notFound,
    unauthorized: S.errors.signedOut,
    rate_limited: S.errors.rateLimited,
    page_disabled: S.errors.pageDisabled,
    sharing_blocked: S.errors.accountBlocked,
  };

  const enabled = share?.enabled === true;
  // An operator turned this page (or this student's sharing) off after a report.
  const blocked = share?.enabled === false ? share.blocked : undefined;
  const url = share?.enabled && typeof window !== "undefined" ? `${window.location.origin}${share.path}` : "";

  const toggle = (next: boolean) => {
    setStatus("saving");
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        const result = await setPageShareAction({ workspaceId, pageId, enabled: next });
        if (result.ok) setShare(result.share);
        else if (result.error === "page_disabled") setShare({ enabled: false, blocked: "page" });
        else if (result.error === "sharing_blocked") setShare({ enabled: false, blocked: "account" });
        else setError(result.error);
      } catch {
        setError("failed");
      }
      setStatus("ready");
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the field is selectable as a fallback.
    }
  };

  const since = share?.enabled
    ? new Date(share.createdAt).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" })
    : "";

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-3xl border-line bg-card p-5 text-ink sm:max-w-lg sm:p-7">
        <div className="pe-8">
          <DialogTitle className="font-display text-2xl font-bold text-ink">{S.title}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-ink-soft">{S.intro}</DialogDescription>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-4 py-3">
          <label htmlFor={`${ids}-toggle`} className="text-sm font-semibold text-ink">
            {S.toggle}
          </label>
          {status === "loading" ? (
            <Loader2 className="h-5 w-5 animate-spin text-ink-soft" aria-label={S.loading} />
          ) : (
            <button
              id={`${ids}-toggle`}
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={status === "saving" || (share === null && error !== null) || blocked !== undefined}
              onClick={() => toggle(!enabled)}
              className={cn(
                "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition disabled:opacity-50",
                enabled ? "border-ink bg-ink" : "border-line-strong bg-hover",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-block h-5 w-5 rounded-full bg-paper shadow-sm transition-transform",
                  enabled ? "translate-x-6 rtl:-translate-x-6" : "translate-x-0.5 rtl:-translate-x-0.5",
                )}
              />
            </button>
          )}
        </div>

        {enabled && share?.enabled ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={`${ids}-link`} className="text-sm font-semibold text-ink">
              {S.linkLabel}
            </label>
            <div className="flex items-stretch gap-2">
              <input
                id={`${ids}-link`}
                readOnly
                value={url}
                dir="ltr"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-2xl border border-line-strong bg-paper px-3 py-2 font-mono text-xs text-ink-soft outline-none focus-visible:border-ink"
              />
              <button
                type="button"
                onClick={copy}
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-hover"
              >
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                {copied ? S.copied : S.copy}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
              <span>
                {plural(S.views, share.viewCount)} · {t(S.sharedSince, { date: since })}
              </span>
              <a
                href={share.path}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-9 items-center gap-1 font-semibold text-ink underline-offset-4 hover:underline"
              >
                {S.open}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          </div>
        ) : blocked ? (
          <p role="status" className="rounded-2xl bg-heather px-4 py-3 text-sm text-ink">
            {blocked === "page" ? S.errors.pageDisabled : S.errors.accountBlocked}
          </p>
        ) : (
          status !== "loading" && <p className="text-sm text-ink-soft">{S.offNote}</p>
        )}

        <div className="flex flex-col gap-1.5 rounded-2xl bg-cloud px-4 py-3 text-sm text-ink">
          <p>{S.visibleNote}</p>
          <p className="text-ink-soft">{S.columnsNote}</p>
          <p className="text-ink-soft">{S.trashNote}</p>
        </div>
        {enabled && <p className="text-xs text-ink-faint">{S.offHint}</p>}

        {error && (
          <p role="alert" className="rounded-2xl bg-heather px-4 py-3 text-sm text-ink">
            {errorText[error]}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
