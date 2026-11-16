"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveSharedCopyAction, type SaveSharedCopyError } from "@/app/s/actions";
import { useI18n } from "@/lib/i18n/client";
import { sharePath } from "@/lib/share/config";
import { cn } from "@/lib/utils";

/** Where sign-up and sign-in send the visitor back to: this page, ready to save. */
export function returnToSave(token: string): string {
  return `${sharePath(token)}?save=1`;
}

/**
 * "Save a copy to my StudyOS". Signed out, it leads to sign-up (or sign-in)
 * and back here; signed in, it copies the page into a new workspace of the
 * visitor's and opens it.
 */
export function SaveCopyCard({
  token,
  signedIn,
  returning,
}: {
  token: string;
  signedIn: boolean;
  /** Back from signing up or in to save (?save=1). */
  returning: boolean;
}) {
  const { dict } = useI18n();
  const S = dict.share.save;
  const router = useRouter();
  const [error, setError] = useState<Exclude<SaveSharedCopyError, "signed_out" | "invalid"> | null>(null);
  const [pending, startTransition] = useTransition();
  const back = encodeURIComponent(returnToSave(token));

  const errorText = {
    limit: S.errors.limit,
    rate_limited: S.errors.rateLimited,
    gone: S.errors.gone,
    failed: S.errors.failed,
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await saveSharedCopyAction(token);
        if (result.ok) {
          router.push(`/app/${encodeURIComponent(result.workspaceId)}`);
          return;
        }
        if (result.error === "signed_out") {
          // Signed out in another tab meanwhile.
          window.location.assign(`/sign-in?redirect_url=${back}`);
          return;
        }
        setError(result.error === "invalid" ? "gone" : result.error);
      } catch {
        setError("failed");
      }
    });

  return (
    <section
      className={cn(
        "rounded-3xl border p-5 sm:p-6",
        returning && signedIn ? "border-ink/30 bg-matcha" : "border-line bg-matcha/70",
      )}
    >
      <h2 className="font-display text-xl font-bold text-ink">{S.title}</h2>
      <p className="mt-1 text-sm text-ink-soft">{returning && signedIn ? S.welcomeBack : S.body}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {signedIn ? (
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-lime px-6 text-sm font-semibold text-lime-on transition hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {pending ? S.saving : S.button}
          </button>
        ) : (
          <>
            <Link
              href={`/sign-up?redirect_url=${back}`}
              className="inline-flex min-h-11 items-center rounded-full bg-lime px-6 text-sm font-semibold text-lime-on transition hover:bg-lime-hover"
            >
              {S.signUp}
            </Link>
            <Link
              href={`/sign-in?redirect_url=${back}`}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-ink underline underline-offset-4 hover:text-ink-soft"
            >
              {S.signIn}
            </Link>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-2xl bg-heather px-4 py-3 text-sm text-ink">
          {errorText[error]}
        </p>
      )}
    </section>
  );
}
