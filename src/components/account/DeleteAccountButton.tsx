"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { deleteAccountAction } from "@/app/app/account-actions";

/**
 * The danger-zone control: confirms (destructive, irreversible), then deletes
 * the whole account. The action redirects to "/" on success, or returns an
 * error (e.g. Stripe couldn't be reached to cancel billing) — in which case
 * NOTHING was deleted and we tell the user to retry.
 */
export function DeleteAccountButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { dict } = useI18n();
  const S = dict.settings;

  const onClick = () => {
    if (!window.confirm(S.deleteAccountConfirm)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteAccountAction();
      if (result?.error) setError(S.deleteAccountError);
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-lg border border-rose-600/40 bg-rose-600/10 px-5 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? S.deleting : S.deleteAccountButton}
      </button>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
