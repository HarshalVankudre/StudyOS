"use client";

import { useId, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { sendFeedbackAction, type SendFeedbackError } from "@/app/app/feedback-actions";
import {
  FEEDBACK_KINDS,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_MIN_LENGTH,
  type FeedbackKind,
} from "@/lib/feedback";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type ErrorCode = SendFeedbackError | "tooShort";

/**
 * "Send feedback": a kind (pills), a message, and whether we may email the
 * student about it. Sends the page path they are on (never its query string)
 * and their language. Opened from the account menu and the command palette
 * through FeedbackHost; mounted fresh each time, so it always starts empty.
 */
export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { dict, t, locale } = useI18n();
  const F = dict.feedback;
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [sent, setSent] = useState<{ contactOk: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = useId();
  const messageId = `${ids}-message`;
  const errorId = `${ids}-error`;

  const limits = { min: FEEDBACK_MIN_LENGTH, max: FEEDBACK_MAX_LENGTH.toLocaleString(locale) };
  const errorText: Record<ErrorCode, string> = {
    tooShort: t(F.errors.tooShort, limits),
    invalid: t(F.errors.invalid, limits),
    rate_limited: F.errors.rateLimited,
    failed: F.errors.failed,
    unauthorized: F.errors.signedOut,
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const text = message.trim();
    if (text.length < FEEDBACK_MIN_LENGTH) {
      setError("tooShort");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendFeedbackAction({
          kind,
          message: text,
          pagePath: window.location.pathname,
          locale,
          contactOk,
        });
        if (result.ok) setSent({ contactOk });
        else setError(result.error);
      } catch {
        // Offline, or the app was updated meanwhile: thrown inside this
        // transition it would replace the page with the error screen.
        setError("failed");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-3xl border-line bg-card p-5 text-ink sm:max-w-lg sm:p-7">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-matcha text-ink" aria-hidden>
              <Check className="h-5 w-5" />
            </span>
            <DialogTitle className="font-display text-2xl font-bold text-ink">{F.thanksTitle}</DialogTitle>
            <DialogDescription className="max-w-sm text-sm text-ink-soft">
              {sent.contactOk ? `${F.thanksBody} ${F.thanksContact}` : F.thanksBody}
            </DialogDescription>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="mt-2 min-h-11 rounded-full bg-lime px-6 text-sm font-semibold text-lime-on transition hover:bg-lime-hover"
            >
              {F.close}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <div className="pe-8">
              <DialogTitle className="font-display text-2xl font-bold text-ink">{F.title}</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-ink-soft">{F.intro}</DialogDescription>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">{F.kindLabel}</legend>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK_KINDS.map((option) => {
                  const selected = option === kind;
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
                        name={`${ids}-kind`}
                        value={option}
                        checked={selected}
                        onChange={() => setKind(option)}
                        className="sr-only"
                      />
                      {F.kinds[option]}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={messageId} className="text-sm font-semibold text-ink">
                {F.messageLabel}
              </label>
              <textarea
                id={messageId}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (error === "tooShort" || error === "invalid") setError(null);
                }}
                maxLength={FEEDBACK_MAX_LENGTH}
                rows={5}
                placeholder={F.placeholder}
                aria-invalid={error === "tooShort" || error === "invalid" || undefined}
                aria-describedby={error ? errorId : undefined}
                dir="auto"
                className="min-h-32 w-full resize-y rounded-2xl border border-line-strong bg-paper px-4 py-3 text-base text-ink outline-none transition placeholder:text-ink-faint focus-visible:border-ink sm:text-sm"
              />
              <div className="flex items-start justify-between gap-3 text-xs text-ink-faint">
                <span>{F.pageNote}</span>
                <span className="shrink-0 tabular-nums" dir="ltr">
                  {t(F.counter, {
                    count: message.length.toLocaleString(locale),
                    max: FEEDBACK_MAX_LENGTH.toLocaleString(locale),
                  })}
                </span>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={contactOk}
                onChange={(e) => setContactOk(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-ink"
              />
              {F.contactOk}
            </label>

            {error && (
              <p id={errorId} role="alert" className="rounded-2xl bg-heather px-4 py-3 text-sm text-ink">
                {errorText[error]}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={pending}
                className="min-h-11 rounded-full border border-line-strong bg-card px-5 text-sm font-semibold text-ink transition hover:bg-hover disabled:opacity-50"
              >
                {F.cancel}
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-lime px-6 text-sm font-semibold text-lime-on transition hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {pending ? F.sending : F.send}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
