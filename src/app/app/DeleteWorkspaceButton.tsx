"use client";

import { Copy, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n/client";
import {
  duplicateWorkspaceAction,
  restoreWorkspaceAction,
  trashWorkspaceAction,
} from "./actions";

const TOAST_MS = 8000;

/**
 * Actions for a workspace card: Duplicate and Move to trash. Always visible
 * (phones have no hover). Trashing is undoable from the toast and restorable
 * from the Trash section for 30 days, so it does not ask for confirmation.
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
  const S = dict.safety;

  const moveToTrash = () => {
    startTransition(async () => {
      const ok = await trashWorkspaceAction(id).catch(() => false);
      if (!ok) {
        toast.error(S.actionFailed);
        return;
      }
      router.refresh();
      toast(t(S.movedToTrash, { name }), {
        duration: TOAST_MS,
        action: {
          label: S.undo,
          onClick: async () => {
            const restored = await restoreWorkspaceAction(id).catch(() => false);
            if (!restored) toast.error(S.actionFailed);
            router.refresh();
          },
        },
      });
    });
  };

  const duplicate = () => {
    startTransition(async () => {
      const result = await duplicateWorkspaceAction(id).catch(() => null);
      if (!result?.ok) {
        // The cap and rate-limit messages say what to do next.
        toast.error(result?.message ?? S.actionFailed);
        return;
      }
      router.refresh();
      toast(S.duplicated, { duration: TOAST_MS });
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={t(S.actionsAria, { name })}
          className="absolute end-1.5 top-1.5 z-10 grid h-11 w-11 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? (
            <span
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/20 border-t-ink"
              aria-hidden
            />
          ) : (
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={duplicate} className="min-h-11 sm:min-h-0">
          <Copy aria-hidden />
          {S.duplicate}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={moveToTrash}
          variant="destructive"
          className="min-h-11 sm:min-h-0"
        >
          <Trash2 aria-hidden />
          {S.moveToTrash}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
