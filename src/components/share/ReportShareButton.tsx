"use client";

import { useId, useState, useTransition } from "react";
import { Check, Flag, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { reportShareAction, type ReportShareError } from "@/app/s/actions";
import { useI18n } from "@/lib/i18n/client";
import { SHARE_REPORT_MAX_MESSAGE, SHARE_REPORT_REASONS, type ShareReportReason } from "@/lib/share/config";
import { cn } from "@/lib/utils";

/**
 * "Report this page" on a shared page: a reason (pills) and an optional
 * message, sent to the operator console. Works signed out. The dialog is
 * mounted fresh each time it opens, so it always starts empty.
 */
export function ReportShareButton({ token }: { token: string }) {
  const { dict } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-ink-soft transition hover:bg-hover hover:text-ink"
      >
        <Flag className="h-3.5 w-3.5" aria-hidden />
        {dict.share.report.link}
      </button>
      {open && <ReportShareDialog token={token} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportShareDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const { dict, t, locale } = useI18n();
  const R = dict.share.report;
  const [reason, setReason] = useState<ShareReportReason | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<ReportShareError | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const ids = useId();
  const errorId = `${ids}-error`;

  const errorText: Record<ReportShareError, string> = {
    invalid: t(R.errors.invalid, { max: SHARE_REPORT_MAX_MESSAGE.toLocaleString(locale) }),
    rate_limited: R.errors.rateLimited,
    gone: R.errors.gone,
    failed: R.errors.failed,
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (!reason) {
      setError("invalid");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await reportShareAction({ token, reason, message: message.trim() || null });
        if (result.ok) setSent(true);
        else setError(result.error);
      } catch {
        // Offline, or the app was updated meanwhile.
        setError("failed");
      }
    });
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-3xl border-line bg-card p-5 text-ink sm:max-w-lg sm:p-7">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-matcha text-ink" aria-hidden>
              <Check className="h-5 w-5" />
            </span>
            <DialogTitle className="font-display text-2xl font-bold text-ink">{R.thanksTitle}</DialogTitle>
            <DialogDescription className="max-w-sm text-sm text-ink-soft">{R.thanksBody}</DialogDescription>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 min-h-11 rounded-full border border-line-strong bg-card px-6 text-sm font-semibold text-ink transition hover:bg-hover"
            >
              {R.close}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <div className="pe-8">
              <DialogTitle className="font-display text-2xl font-bold text-ink">{R.title}</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-ink-soft">{R.intro}</DialogDescription>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">{R.reasonLabel}</legend>
              <div className="flex flex-wrap gap-2">
                {SHARE_REPORT_REASONS.map((option) => {
                  const selected = option === reason;
                  return (
                    <label
                      key={option}
                      className={cn(
                        "inline-flex min-h-10 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink/40",
                        selected
                          ? "border-ink bg-ink text-paper"
                          : "border-line-strong bg-card text-ink-soft hover:bg-hover hover:text-ink",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${ids}-reason`}
                        value={option}
                        checked={selected}
                        onChange={() => {
                          setReason(option);
                          if (error === "invalid") setError(null);
                        }}
                        className="sr-only"
                      />
                      {R.reasons[option]}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-message`} className="text-sm font-semibold text-ink">
                {R.messageLabel}
              </label>
              <textarea
                id={`${ids}-message`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={SHARE_REPORT_MAX_MESSAGE}
                rows={4}
                placeholder={R.placeholder}
                dir="auto"
                className="min-h-28 w-full resize-y rounded-2xl border border-line-strong bg-paper px-4 py-3 text-base text-ink outline-none transition placeholder:text-ink-faint focus-visible:border-ink sm:text-sm"
              />
            </div>

            {error && (
              <p id={errorId} role="alert" className="rounded-2xl bg-heather px-4 py-3 text-sm text-ink">
                {errorText[error]}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="min-h-11 rounded-full border border-line-strong bg-card px-5 text-sm font-semibold text-ink transition hover:bg-hover disabled:opacity-50"
              >
                {R.cancel}
              </button>
              <button
                type="submit"
                disabled={pending}
                aria-describedby={error ? errorId : undefined}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-6 text-sm font-semibold text-paper transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {pending ? R.sending : R.send}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
