/**
 * The agent chat's memory: persisted per workspace, per owner.
 *
 * The chat used to live only in component state, so closing the panel or
 * reloading lost the conversation and its Undo buttons, and the model could
 * not resolve follow-ups such as "make that one due Monday instead". Every
 * message is now stored (AgentChatMessage), redrawn when the panel opens, and
 * a bounded window of recent turns is given back to the model.
 *
 * Every query filters on the owner; a trashed workspace's chat is invisible.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { applyPatch, diff } from "@/lib/workspace/changes";
import { NOT_TRASHED, parseStoredWorkspace } from "@/lib/workspace/store";
import type { Workspace } from "@/lib/workspace/types";
import type {
  AgentArea,
  AgentChatHistoryItem,
  AgentChoice,
  AgentMessage,
  AgentUndoState,
} from "./agent-shared";

/** How much history the model sees, and how much the panel redraws. */
export const HISTORY_WINDOW = {
  /** Most recent messages given to the model. */
  maxMessages: 10,
  /** Total characters of history given to the model. */
  maxChars: 8_000,
  /** Each message is clipped to this many characters for the model. */
  perMessageChars: 1_500,
  /** Messages the panel redraws. */
  maxRestored: 60,
} as const;

/** A stored row, as read from the database. */
export interface StoredChatRow {
  id: string;
  role: string;
  content: string;
  modelContent: string | null;
  changeNote: string | null;
  changeId: string | null;
  meta: string | null;
  createdAt: Date;
}

export interface ChatMeta {
  changed?: boolean;
  choices?: AgentChoice[];
  affectedAreas?: AgentArea[];
  creditsCost?: number;
  stopReason?: "budget" | "time";
}

/** A message to store. */
export interface NewChatMessage {
  role: "user" | "assistant";
  content: string;
  modelContent?: string;
  changeNote?: string;
  changeId?: string;
  meta?: ChatMeta;
}

const MAX_STORED_CHARS = 6_000;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseMeta(meta: string | null): ChatMeta {
  if (!meta) return {};
  try {
    const value = JSON.parse(meta) as unknown;
    return value && typeof value === "object" ? (value as ChatMeta) : {};
  } catch {
    return {};
  }
}

/**
 * The model's window: the newest messages (oldest first) that fit the count
 * and character limits. An assistant turn that changed the workspace carries
 * its change note (ids included) so the model can find "that one" again;
 * a change the student undid is marked as such.
 */
export function windowHistory(
  rows: StoredChatRow[],
  undo: Record<string, AgentUndoState> = {},
  limits: { maxMessages: number; maxChars: number; perMessageChars: number } = HISTORY_WINDOW,
): AgentMessage[] {
  const picked: AgentMessage[] = [];
  let chars = 0;
  for (let i = rows.length - 1; i >= 0 && picked.length < limits.maxMessages; i -= 1) {
    const row = rows[i];
    if (row.role !== "user" && row.role !== "assistant") continue;
    const content = clip((row.modelContent ?? row.content).trim(), limits.perMessageChars);
    if (!content) continue;
    // The change note quotes workspace text (row labels, page titles), so it
    // travels separately and the agent loop fences it as data.
    let note: string | undefined;
    if (row.role === "assistant" && row.changeNote) {
      const undone = row.changeId && undo[row.changeId] === "undone" ? " (the student later undid this)" : "";
      note = `${clip(row.changeNote, 600)}${undone}`;
    }
    const size = content.length + (note?.length ?? 0);
    if (chars + size > limits.maxChars && picked.length > 0) break;
    chars += size;
    picked.unshift(note ? { role: row.role, content, note } : { role: row.role, content });
  }
  return picked;
}

/**
 * Whether the server would honour Undo for each change right now — the same
 * rule `undoAgentWorkspaceChange` enforces: an agent change, not yet undone,
 * and still the workspace's latest version (no edit saved on top of it).
 */
export function undoStates(
  changes: { id: string; kind: string; undoneAt: Date | null; afterVersion: number }[],
  workspaceVersion: number,
): Record<string, AgentUndoState> {
  const states: Record<string, AgentUndoState> = {};
  for (const change of changes) {
    if (change.kind !== "agent") continue;
    states[change.id] = change.undoneAt
      ? "undone"
      : change.afterVersion === workspaceVersion
        ? "available"
        : "unavailable";
  }
  return states;
}

/** A stored row as the panel draws it. Change ids with no record are unavailable. */
export function toHistoryItem(
  row: StoredChatRow,
  undo: Record<string, AgentUndoState>,
): AgentChatHistoryItem {
  const meta = parseMeta(row.meta);
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    ...(row.modelContent ? { modelContent: row.modelContent } : {}),
    ...(meta.changed ? { changed: true } : {}),
    ...(meta.choices?.length ? { choices: meta.choices } : {}),
    ...(meta.affectedAreas?.length ? { affectedAreas: meta.affectedAreas } : {}),
    ...(typeof meta.creditsCost === "number" ? { creditsCost: meta.creditsCost } : {}),
    ...(meta.stopReason ? { stopReason: meta.stopReason } : {}),
    ...(row.changeId
      ? { changeId: row.changeId, undo: undo[row.changeId] ?? "unavailable" }
      : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

const ROW_SELECT = {
  id: true,
  role: true,
  content: true,
  modelContent: true,
  changeNote: true,
  changeId: true,
  meta: true,
  createdAt: true,
} as const;

/** The workspace's version, or null when it is not this owner's or is in the trash. */
async function liveWorkspaceVersion(userId: string, workspaceId: string): Promise<number | null> {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId: userId, ...NOT_TRASHED },
    select: { version: true },
  });
  return workspace?.version ?? null;
}

async function recentRows(userId: string, workspaceId: string, take: number): Promise<StoredChatRow[]> {
  const rows = await prisma.agentChatMessage.findMany({
    where: { userId, workspaceId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: ROW_SELECT,
  });
  return rows.reverse();
}

/**
 * Whether undoing an agent change (before -> after) still applies on top of
 * `current`: the same strict revert the Undo itself runs
 * (lib/workspace/version-service.ts undoAgentWorkspaceChange), as a dry run.
 * True when what was saved since does not touch what the change did.
 */
export function revertStillApplies(before: Workspace, after: Workspace, current: Workspace): boolean {
  try {
    return applyPatch(current, diff(after, before), { mode: "strict" }).report.conflicts === 0;
  } catch {
    return false;
  }
}

async function undoStatesForRows(
  userId: string,
  workspaceId: string,
  rows: StoredChatRow[],
  version: number,
): Promise<Record<string, AgentUndoState>> {
  const ids = rows.map((r) => r.changeId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return {};
  const changes = await prisma.workspaceChange.findMany({
    where: { id: { in: ids }, ownerId: userId, workspaceId },
    select: { id: true, kind: true, undoneAt: true, afterVersion: true },
  });
  const states = undoStates(changes, version);

  // The newest agent change stays undoable after later saves (the student's
  // own typing, the editor's merge) as long as the Undo can still revert it
  // on top of them: say so, instead of hiding an Undo the server would honour.
  const newest = changes
    .filter((c) => c.kind === "agent" && !c.undoneAt)
    .sort((a, b) => b.afterVersion - a.afterVersion)[0];
  if (newest && newest.afterVersion < version && states[newest.id] === "unavailable") {
    try {
      const [change, current] = await Promise.all([
        prisma.workspaceChange.findFirst({
          where: { id: newest.id, ownerId: userId, workspaceId },
          select: { beforeData: true, afterData: true },
        }),
        prisma.workspace.findFirst({
          where: { id: workspaceId, ownerId: userId, ...NOT_TRASHED },
          select: { data: true },
        }),
      ]);
      const before = change && parseStoredWorkspace({ id: workspaceId, data: change.beforeData });
      const after = change && parseStoredWorkspace({ id: workspaceId, data: change.afterData });
      const now = current && parseStoredWorkspace({ id: workspaceId, data: current.data });
      if (before && after && now && revertStillApplies(before, after, now)) states[newest.id] = "available";
    } catch {
      // Keep "unavailable": a refused Undo explains itself anyway.
    }
  }
  return states;
}

/** The chat to redraw, or null when the workspace is missing or trashed. */
export async function loadChat(
  userId: string,
  workspaceId: string,
): Promise<AgentChatHistoryItem[] | null> {
  const version = await liveWorkspaceVersion(userId, workspaceId);
  if (version === null) return null;
  const rows = await recentRows(userId, workspaceId, HISTORY_WINDOW.maxRestored);
  const undo = await undoStatesForRows(userId, workspaceId, rows, version);
  return rows.map((row) => toHistoryItem(row, undo));
}

/** Current undo state of every change in the redrawn chat (cheap re-check). */
export async function loadUndoStates(
  userId: string,
  workspaceId: string,
): Promise<Record<string, AgentUndoState> | null> {
  const version = await liveWorkspaceVersion(userId, workspaceId);
  if (version === null) return null;
  const rows = await recentRows(userId, workspaceId, HISTORY_WINDOW.maxRestored);
  return undoStatesForRows(userId, workspaceId, rows, version);
}

/** The bounded window of recent turns for the model (oldest first). */
export async function loadModelHistory(userId: string, workspaceId: string): Promise<AgentMessage[]> {
  const version = await liveWorkspaceVersion(userId, workspaceId);
  if (version === null) return [];
  const rows = await recentRows(userId, workspaceId, HISTORY_WINDOW.maxMessages);
  const undo = await undoStatesForRows(userId, workspaceId, rows, version);
  return windowHistory(rows, undo);
}

/** Store messages in order (best effort is the caller's choice). */
export async function appendChatMessages(
  userId: string,
  workspaceId: string,
  messages: NewChatMessage[],
): Promise<void> {
  // Sequential creates keep createdAt ordering stable within one turn.
  for (const message of messages) {
    await prisma.agentChatMessage.create({
      data: {
        userId,
        workspaceId,
        role: message.role,
        content: clip(message.content, MAX_STORED_CHARS),
        modelContent:
          message.modelContent && message.modelContent !== message.content
            ? clip(message.modelContent, MAX_STORED_CHARS)
            : null,
        changeNote: message.changeNote ? clip(message.changeNote, 2_000) : null,
        changeId: message.changeId ?? null,
        meta: message.meta ? JSON.stringify(message.meta) : null,
      },
    });
  }
}

/** Forget the conversation (the workspace itself is untouched). */
export async function clearChat(userId: string, workspaceId: string): Promise<number> {
  const result = await prisma.agentChatMessage.deleteMany({ where: { userId, workspaceId } });
  return result.count;
}
