/**
 * Did the editor's merge set an agent turn's edit aside? When the student
 * typed into a paragraph while the AI agent changed the same words, the sync
 * engine keeps the student's text in place and puts the agent's version in a
 * marked copy right below it (a block with `keptFrom`, see
 * lib/workspace/changes.ts keepBothBlocks). The agent wrote its reply before
 * that merge, so the chat checks the document it now holds against the
 * agent's result and says so under the turn. Read-only, pure.
 */
import type { Block, Workspace } from "@/lib/workspace/types";

function textOf(block: Block | undefined): string | null {
  const text = block ? (block as { text?: unknown }).text : undefined;
  return typeof text === "string" ? text : null;
}

/** Ids of the marked copies in a document (to tell the new ones apart). */
export function keptCopyIds(workspace: Workspace | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const page of workspace?.pages ?? []) {
    for (const block of page.blocks) if (block.keptFrom) ids.add(block.id);
  }
  return ids;
}

/**
 * How many of the agent's paragraph edits ended up as marked copies, with the
 * student's version kept in place: copies not in `before`, holding exactly the
 * agent's text for the block they were kept next to, while that block now
 * holds something else.
 */
export function agentEditsSetAside(
  before: ReadonlySet<string>,
  agent: Workspace,
  now: Workspace,
): number {
  const agentText = new Map<string, string | null>();
  for (const page of agent.pages) for (const block of page.blocks) agentText.set(block.id, textOf(block));
  let count = 0;
  for (const page of now.pages) {
    for (const block of page.blocks) {
      if (!block.keptFrom || before.has(block.id)) continue;
      const theirs = agentText.get(block.keptFrom);
      if (theirs == null || textOf(block) !== theirs) continue;
      const original = page.blocks.find((b) => b.id === block.keptFrom);
      if (original && textOf(original) !== theirs) count += 1;
    }
  }
  return count;
}
