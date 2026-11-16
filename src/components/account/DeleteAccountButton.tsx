"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { deleteAccountAction } from "@/app/app/account-actions";
import { clearPushBeforeSignOut } from "@/components/notifications/push-client";
import { DELETION_NOTE_MAX, DELETION_REASONS, type DeletionReason } from "@/lib/account/deletion-answer";

/**
 * The danger-zone control. "Delete my account" opens an in-page confirmation
 * (destructive, irreversible) with one optional question, why the student is
 * leaving (lib/account/deletion-answer; stored anonymously once the account
 * is gone). Confirming deletes the whole account: the action redirects to "/"
 * on success, or returns an error (e.g. Stripe couldn't be reached to cancel
 * billing), in which case NOTHING was deleted and we ask the user to retry.
 */
export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DeletionReason | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { dict } = useI18n();
  const S = dict.settings;
  const titleId = useId();
  const noteId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  // Move focus into the confirmation when it opens, so a keyboard or screen
  // reader user lands on what is being asked.
  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  const cancel = () => {
    setOpen(false);
    setError(null);
    // Back to the button that opened it (rendered again on the next frame).
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      // This device stops getting the student's notifications first (the
      // server erases every device record with the account, but the browser
      // subscription lives on the device). Bounded: deletion always proceeds.
      await clearPushBeforeSignOut();
      try {
        const answer = reason || note.trim() ? { reason, note } : undefined;
        const result = await deleteAccountAction(answer);
        if (result?.error) setError(S.deleteAccountError);
      } catch (error) {
        // The redirect after a successful deletion is Next's to handle.
        unstable_rethrow(error);
        // Offline, or the app was updated meanwhile: ask to try again.
        // Thrown inside this transition it would show the error screen.
        setError(dict.safety.actionFailed);
      }
    });
  };

  if (!open) {
    return (
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-rose-600/40 bg-rose-600/10 px-5 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-600 hover:text-white"
      >
        {S.deleteAccountButton}
      </button>
    );
  }

  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-rose-600/30 bg-rose-600/5 p-5">
      <h3 id={titleId} ref={titleRef} tabIndex={-1} className="font-display text-lg leading-snug text-ink outline-none">
        {S.deleteConfirmTitle}
      </h3>
      <p className="mt-1 text-sm leading-6 text-ink-soft">{S.deleteConfirmBody}</p>

      <fieldset className="mt-4" disabled={pending}>
        <legend className="text-sm font-semibold text-ink">{S.deleteReasonLegend}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {DELETION_REASONS.map((key) => (
            <label key={key} className="cursor-pointer">
              <input
                type="radio"
                name="leaving-reason"
                value={key}
                checked={reason === key}
                onChange={() => setReason(key)}
                className="peer sr-only"
              />
              <span className="inline-flex min-h-9 items-center rounded-full border border-line-strong bg-card px-3.5 text-sm text-ink transition hover:bg-hover peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:ring-2 peer-focus-visible:ring-ink/40">
                {S.deleteReasons[key]}
              </span>
            </label>
          ))}
        </div>
        <label htmlFor={noteId} className="mt-4 block text-sm font-semibold text-ink">
          {S.deleteNoteLabel}
        </label>
        <textarea
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={DELETION_NOTE_MAX}
          rows={3}
          className="mt-2 w-full resize-y rounded-2xl border border-line-strong bg-card px-4 py-3 text-sm text-ink outline-none transition focus:border-ink"
        />
        <p className="mt-1 text-xs text-ink-faint">{S.deleteReasonPrivacy}</p>
      </fieldset>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="rounded-full bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? S.deleting : S.deleteConfirmButton}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="rounded-full border border-line-strong bg-card px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-hover disabled:opacity-60"
        >
          {S.deleteCancel}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {error}
        </p>
      )}
    </section>
  );
}
