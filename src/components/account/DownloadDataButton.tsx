"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

/**
 * "Download my data": fetches the JSON export and saves it as a file. A fetch
 * (rather than a plain link) lets us show a friendly message when the daily
 * limit is reached instead of a raw error page.
 */
export function DownloadDataButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { dict } = useI18n();
  const S = dict.settings;

  const onClick = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/account/export", { cache: "no-store" });
      if (res.status === 429) {
        setError(S.downloadDataLimit);
        return;
      }
      if (!res.ok) {
        setError(S.downloadDataError);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "studyos-data.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      setError(S.downloadDataError);
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink/15 bg-card px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="h-4 w-4" aria-hidden />
        {pending ? S.preparingData : S.downloadData}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
