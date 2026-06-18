"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { deleteWorkspaceAction } from "./actions";

/**
 * Hover-revealed delete control for a workspace card. Confirms first (this is
 * destructive and can't be undone), then deletes and refreshes the list.
 */
export function DeleteWorkspaceButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { dict, t } = useI18n();

  const onClick = () => {
    const ok = window.confirm(t(dict.workspaceCard.deleteConfirm, { name }));
    if (!ok) return;
    startTransition(async () => {
      await deleteWorkspaceAction(id);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={t(dict.workspaceCard.deleteAria, { name })}
      title={dict.workspaceCard.delete}
      className="absolute right-2.5 top-2.5 z-10 grid h-8 w-8 place-items-center rounded-lg border border-transparent text-ink-soft/50 opacity-0 transition hover:border-ink/15 hover:bg-paper hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/20 border-t-rose-500"
          aria-hidden
        />
      ) : (
        <Trash2 className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
