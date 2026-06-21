"use client";

import { useState } from "react";
import type { Block, Database, Page } from "@/lib/workspace/types";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { BlockText } from "./BlockText";
import { DatabaseView } from "./DatabaseView";
import { useWorkspace } from "./WorkspaceContext";

/** The authenticated, owner-checked source for a media asset. */
export function mediaImgSrc(assetId: string): string {
  return `/api/asset/${assetId}`;
}

const BLOCK_TYPES = [
  { type: "paragraph", icon: "¶" },
  { type: "heading", icon: "H" },
  { type: "todo", icon: "☑" },
  { type: "bulleted_list_item", icon: "•" },
  { type: "numbered_list_item", icon: "1." },
  { type: "quote", icon: "❝" },
  { type: "callout", icon: "★" },
  { type: "divider", icon: "—" },
  { type: "database", icon: "▦" },
];

export function PageView({ page }: { page: Page }) {
  const { update } = useWorkspace();
  const { dict } = useI18n();
  const [addOpen, setAddOpen] = useState(false);

  const addBlock = (type: string) => {
    update((d) => {
      const p = d.pages.find((x) => x.id === page.id);
      if (!p) return;
      if (type === "database") {
        const dbId = crypto.randomUUID();
        const viewId = crypto.randomUUID();
        d.databases.push(newDatabase(dbId, viewId, dict));
        p.blocks.push({
          id: crypto.randomUUID(),
          type: "database_view",
          databaseId: dbId,
          viewId,
        });
      } else {
        p.blocks.push(newBlock(type, dict));
      }
    });
    setAddOpen(false);
  };

  const deleteBlock = (blockId: string) =>
    update((d) => {
      const p = d.pages.find((x) => x.id === page.id);
      if (p) p.blocks = p.blocks.filter((b) => b.id !== blockId);
    });

  return (
    <div className="mx-auto max-w-4xl px-10 py-12">
      <header className="mb-8 flex items-center gap-3">
        <input
          value={page.icon ?? ""}
          onChange={(e) =>
            update((d) => {
              const p = d.pages.find((x) => x.id === page.id);
              if (p) p.icon = e.target.value;
            })
          }
          aria-label={dict.page.pageIcon}
          maxLength={8}
          className="w-14 rounded bg-transparent px-1 text-center text-4xl outline-none hover:bg-white/[0.04] focus:bg-white/[0.04]"
        />
        <input
          value={page.title}
          onChange={(e) =>
            update((d) => {
              const p = d.pages.find((x) => x.id === page.id);
              if (p) p.title = e.target.value;
            })
          }
          className="w-full rounded px-1 font-display text-4xl font-bold tracking-tight text-ink outline-none hover:bg-white/[0.04] focus:bg-white/[0.04]"
        />
      </header>

      <div className="space-y-1">
        {page.blocks.map((block) => (
          <div key={block.id} className="group relative">
            <button
              onClick={() => deleteBlock(block.id)}
              title={dict.page.deleteBlock}
              className="absolute -left-7 top-1.5 text-ink-soft/30 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
            >
              ✕
            </button>
            <BlockView pageId={page.id} block={block} />
          </div>
        ))}
      </div>

      {/* Add a block / widget */}
      <div className="mt-3">
        {addOpen ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-paper p-2">
            {BLOCK_TYPES.map((bt) => (
              <button
                key={bt.type}
                onClick={() => addBlock(bt.type)}
                className="flex items-center gap-1.5 rounded border border-line bg-card px-2.5 py-1.5 text-sm text-ink transition hover:border-ink/40"
              >
                <span className="font-mono text-xs text-ink-soft">{bt.icon}</span>
                {dict.page.blockTypes[bt.type as keyof typeof dict.page.blockTypes]}
              </button>
            ))}
            <button
              onClick={() => setAddOpen(false)}
              className="px-2 text-sm text-ink-soft transition hover:text-ink"
            >
              {dict.common.cancel}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-md px-1 py-1 text-sm text-ink-soft transition hover:text-ink"
          >
            {dict.page.addBlock}
          </button>
        )}
      </div>
    </div>
  );
}

function newBlock(type: string, dict: Dictionary): Block {
  const id = crypto.randomUUID();
  switch (type) {
    case "heading":
      return { id, type: "heading", level: 2, text: dict.page.headingDefault };
    case "todo":
      return { id, type: "todo", text: "", checked: false };
    case "bulleted_list_item":
      return { id, type: "bulleted_list_item", text: "" };
    case "numbered_list_item":
      return { id, type: "numbered_list_item", text: "" };
    case "quote":
      return { id, type: "quote", text: "" };
    case "callout":
      return { id, type: "callout", text: "", emoji: "💡" };
    case "divider":
      return { id, type: "divider" };
    case "paragraph":
    default:
      return { id, type: "paragraph", text: "" };
  }
}

function newDatabase(id: string, viewId: string, dict: Dictionary): Database {
  return {
    id,
    name: dict.page.newTable.name,
    icon: "▦",
    properties: [
      { id: crypto.randomUUID(), name: dict.page.newTable.propName, type: "text" },
      {
        id: crypto.randomUUID(),
        name: dict.page.newTable.propStatus,
        type: "status",
        options: [
          { id: crypto.randomUUID(), label: dict.page.newTable.statusTodo, color: "zinc" },
          { id: crypto.randomUUID(), label: dict.page.newTable.statusInProgress, color: "amber" },
          { id: crypto.randomUUID(), label: dict.page.newTable.statusDone, color: "green" },
        ],
      },
      { id: crypto.randomUUID(), name: dict.page.newTable.propDue, type: "date" },
    ],
    rows: [
      { id: crypto.randomUUID(), cells: {} },
      { id: crypto.randomUUID(), cells: {} },
    ],
    views: [{ id: viewId, name: dict.page.newTable.viewTable, type: "table" }],
  };
}

function BlockView({ pageId, block }: { pageId: string; block: Block }) {
  const { update, rev } = useWorkspace();
  const { dict } = useI18n();

  const commitText = (text: string) =>
    update((d) => {
      const b = d.pages.find((p) => p.id === pageId)?.blocks.find((x) => x.id === block.id);
      if (b && "text" in b) (b as { text: string }).text = text;
    });

  const textInputClass =
    "w-full rounded bg-transparent px-1 outline-none focus:bg-white/[0.04]";

  // Fold the AI revision into each uncontrolled input's key so an AI edit
  // remounts it onto the new text (manual typing leaves `rev` untouched).
  const k = `${block.id}:${rev}`;

  switch (block.type) {
    case "heading": {
      const size =
        block.level === 1 ? "text-2xl" : block.level === 2 ? "text-xl" : "text-lg";
      return (
        <div className="mt-6 mb-1 flex items-center gap-2">
          <select
            value={block.level}
            onChange={(e) =>
              update((d) => {
                const b = d.pages
                  .find((p) => p.id === pageId)
                  ?.blocks.find((x) => x.id === block.id);
                if (b?.type === "heading") {
                  b.level = Number(e.target.value) as 1 | 2 | 3;
                }
              })
            }
            aria-label={dict.page.headingLevel}
            className="rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[10px] text-ink-soft outline-none hover:border-line-strong focus:border-ink/30"
          >
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            className={`font-display font-bold text-ink ${size} ${textInputClass}`}
          />
        </div>
      );
    }
    case "paragraph":
      return (
        <BlockText
          key={k}
          value={block.text}
          onCommit={commitText}
          placeholder={dict.page.placeholders.paragraph}
          className={`py-1 text-[15px] leading-7 text-ink placeholder:text-ink-soft/40 ${textInputClass}`}
        />
      );
    case "todo":
      return (
        <div className="flex items-center gap-2 py-1 text-[15px]">
          <input
            type="checkbox"
            checked={block.checked}
            onChange={(e) =>
              update((d) => {
                const b = d.pages
                  .find((p) => p.id === pageId)
                  ?.blocks.find((x) => x.id === block.id);
                if (b && b.type === "todo") b.checked = e.target.checked;
              })
            }
            className="h-4 w-4 rounded border-line-strong text-lime"
          />
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            placeholder={dict.page.placeholders.todo}
            className={`flex-1 rounded bg-transparent px-1 outline-none focus:bg-white/[0.04] ${
              block.checked ? "text-ink-faint line-through" : "text-ink"
            }`}
          />
        </div>
      );
    case "bulleted_list_item":
      return (
        <div className="flex items-center gap-2 py-0.5 text-[15px] text-ink">
          <span className="text-ink-faint">•</span>
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            placeholder={dict.page.placeholders.listItem}
            className={textInputClass}
          />
        </div>
      );
    case "numbered_list_item":
      return (
        <div className="flex items-center gap-2 py-0.5 text-[15px] text-ink">
          <span className="font-mono text-xs text-ink-faint">1.</span>
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            className={textInputClass}
          />
        </div>
      );
    case "quote":
      return (
        <div className="border-l-2 border-line-strong py-1 pl-4 text-[15px] italic text-ink-soft">
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            className={`${textInputClass} italic`}
          />
        </div>
      );
    case "callout":
      return (
        <div className="my-3 flex gap-3 rounded-md border border-line bg-paper p-4 text-[15px] text-ink">
          <input
            value={block.emoji ?? ""}
            onChange={(e) =>
              update((d) => {
                const b = d.pages
                  .find((p) => p.id === pageId)
                  ?.blocks.find((x) => x.id === block.id);
                if (b?.type === "callout") b.emoji = e.target.value;
              })
            }
            aria-label={dict.page.calloutIcon}
            maxLength={8}
            className="w-8 shrink-0 bg-transparent text-center text-xl outline-none"
          />
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            placeholder={dict.page.placeholders.callout}
            className={textInputClass}
          />
        </div>
      );
    case "divider":
      return <hr className="my-4 border-line" />;
    case "database_view":
      return <DatabaseView databaseId={block.databaseId} viewId={block.viewId} />;
    case "media":
      return (
        <figure className="my-3">
          {/* SVG is inert when loaded via <img>; never inline it. */}
          <img
            src={mediaImgSrc(block.assetId)}
            alt={block.alt ?? block.caption ?? ""}
            className="max-w-full rounded-md border border-line"
          />
          {block.caption ? (
            <figcaption className="mt-1 text-center text-xs text-ink-soft">
              {block.caption}
            </figcaption>
          ) : null}
        </figure>
      );
    default:
      return null;
  }
}
