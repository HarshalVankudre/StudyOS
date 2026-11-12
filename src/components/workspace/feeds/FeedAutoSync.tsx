"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { listFeedsAction } from "@/app/app/feed-actions";
import { useI18n } from "@/lib/i18n/client";
import { useWorkspace } from "../WorkspaceContext";
import { isTextEntry } from "../useWorkspaceSync";
import { hasChanges, summaryText, syncConnectedFeed } from "./feed-sync";

const SETTLE_POLL_MS = 1_500;
const MAX_WAIT_MS = 60_000;

/**
 * Syncs the workspace's connected calendar feeds once when it is opened, if
 * their last sync is old. It waits until the editor is settled (saved, no AI
 * task running, no conflict, not mid-typing) so the import never fights the
 * student's edits or the autosave: the changes go through `update()` like any
 * edit and are saved with the version check. The server lets one tab at a
 * time sync a feed, so two open tabs never import the same changes twice.
 */
export function FeedAutoSync() {
  const { workspace, update, status, agentBusy } = useWorkspace();
  const { dict, t } = useI18n();
  const latest = useRef({ workspace, update, status, agentBusy, dict, t });
  useEffect(() => {
    latest.current = { workspace, update, status, agentBusy, dict, t };
  });
  const workspaceId = workspace.id;

  useEffect(() => {
    let cancelled = false;
    const settled = async () => {
      const started = Date.now();
      for (;;) {
        if (cancelled) return false;
        const { status, agentBusy } = latest.current;
        const typing = typeof document !== "undefined" && isTextEntry(document.activeElement);
        if (status === "saved" && !agentBusy && !typing) return true;
        if (Date.now() - started > MAX_WAIT_MS) return status === "saved" && !agentBusy;
        await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
      }
    };
    const run = async () => {
      let feeds;
      try {
        feeds = await listFeedsAction(workspaceId);
      } catch {
        return; // offline or signed out: try next time
      }
      for (const feed of feeds.filter((f) => f.stale)) {
        if (!(await settled())) return;
        try {
          const outcome = await syncConnectedFeed(feed.id, true, {
            getWorkspace: () => latest.current.workspace,
            update: (mutator, options) => latest.current.update(mutator, options),
            dict: latest.current.dict,
          });
          if (cancelled || !outcome.ok || !hasChanges(outcome.summary)) continue;
          const { dict: d, t: tr } = latest.current;
          toast(tr(d.feeds.autoSynced, { source: feed.label, summary: summaryText(outcome.summary, d, tr) }), {
            duration: 8_000,
          });
        } catch {
          // A failed background sync is retried on the next open; the
          // dialog shows the stored error.
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return null;
}
