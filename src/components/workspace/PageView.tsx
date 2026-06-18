"use client";

import { useState } from "react";
import type { Block, Database, Page } from "@/lib/workspace/types";
import { DatabaseView } from "./DatabaseView";
import { useWorkspace } from "./WorkspaceContext";

const BLOCK_TYPES = [
  { type: "paragraph", icon: "¶", label: "Text" },
  { type: "heading", icon: "H", label: "Heading" },
  { type: "todo", icon: "☑", label: "To-do" },
  { type: "bulleted_list_item", icon: "•", label: "List" },
  { type: "numbered_list_item", icon: "1.", label: "Numbered" },
  { type: "quote", icon: "❝", label: "Quote" },
  { type: "callout", icon: "★", label: "Callout" },
  { type: "divider", icon: "—", label: "Divider" },
  { type: "database", icon: "▦", label: "Table" },
];

export function PageView({ page }: { page: Page }) {
  const { update } = useWorkspace();
  const [addOpen, setAddOpen] = useState(false);

  const addBlock = (type: string) => {
    update((d) => {
      const p = d.pages.find((x) => x.id === page.id);
      if (!p) return;
      if (type === "database") {
        const dbId = crypto.randomUUID();
        const viewId = crypto.randomUUID();
        d.databases.push(newDatabase(dbId, viewId));
        p.blocks.push({
          id: crypto.randomUUID(),
          type: "database_view",
          databaseId: dbId,
          viewId,
        });
      } else {
        p.blocks.push(newBlock(type));
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
          aria-label="Page icon"
          maxLength={8}
          className="w-14 rounded bg-transparent px-1 text-center text-4xl outline-none hover:bg-paper focus:bg-paper"
        />
        <input
          value={page.title}
          onChange={(e) =>
            update((d) => {
              const p = d.pages.find((x) => x.id === page.id);
              if (p) p.title = e.target.value;
            })
          }
          className="w-full rounded px-1 font-display text-4xl font-bold tracking-tight text-ink outline-none hover:bg-paper focus:bg-paper"
        />
      </header>

      <div className="space-y-1">
        {page.blocks.map((block) => (
          <div key={block.id} className="group relative">
            <button
              onClick={() => deleteBlock(block.id)}
              title="Delete block"
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
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-ink/15 bg-paper p-2">
            {BLOCK_TYPES.map((bt) => (
              <button
                key={bt.type}
                onClick={() => addBlock(bt.type)}
                className="flex items-center gap-1.5 rounded border border-ink/10 bg-white px-2.5 py-1.5 text-sm text-ink transition hover:border-ink/40"
              >
                <span className="font-mono text-xs text-ink-soft">{bt.icon}</span>
                {bt.label}
              </button>
            ))}
            <button
              onClick={() => setAddOpen(false)}
              className="px-2 text-sm text-ink-soft transition hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-md px-1 py-1 text-sm text-ink-soft transition hover:text-ink"
          >
            + Add block
          </button>
        )}
      </div>
    </div>
  );
}

function newBlock(type: string): Block {
  const id = crypto.randomUUID();
  switch (type) {
    case "heading":
      return { id, type: "heading", level: 2, text: "Heading" };
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

function newDatabase(id: string, viewId: string): Database {
  return {
    id,
    name: "New table",
    icon: "▦",
    properties: [
      { id: crypto.randomUUID(), name: "Name", type: "text" },
      {
        id: crypto.randomUUID(),
        name: "Status",
        type: "status",
        options: [
          { id: crypto.randomUUID(), label: "To do", color: "zinc" },
          { id: crypto.randomUUID(), label: "In progress", color: "amber" },
          { id: crypto.randomUUID(), label: "Done", color: "green" },
        ],
      },
      { id: crypto.randomUUID(), name: "Due", type: "date" },
    ],
    rows: [
      { id: crypto.randomUUID(), cells: {} },
      { id: crypto.randomUUID(), cells: {} },
    ],
    views: [{ id: viewId, name: "Table", type: "table" }],
  };
}

function BlockView({ pageId, block }: { pageId: string; block: Block }) {
  const { update, rev } = useWorkspace();

  const commitText = (text: string) =>
    update((d) => {
      const b = d.pages.find((p) => p.id === pageId)?.blocks.find((x) => x.id === block.id);
      if (b && "text" in b) (b as { text: string }).text = text;
    });

  const textInputClass =
    "w-full rounded bg-transparent px-1 outline-none focus:bg-paper";

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
            aria-label="Heading level"
            className="rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[10px] text-ink-soft outline-none hover:border-ink/15 focus:border-ink/30"
          >
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            className={`font-display font-bold text-ink ${size} ${textInputClass}`}
          />
        </div>
      );
    }
    case "paragraph":
      return (
        <input
          key={k}
          defaultValue={block.text}
          onBlur={(e) => commitText(e.target.value)}
          placeholder="Type something…"
          className={`py-1 text-[15px] leading-7 text-zinc-700 placeholder:text-ink-soft/40 ${textInputClass}`}
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
            className="h-4 w-4 rounded border-zinc-300 text-indigo-600"
          />
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            placeholder="To-do"
            className={`flex-1 rounded bg-transparent px-1 outline-none focus:bg-paper ${
              block.checked ? "text-zinc-400 line-through" : "text-zinc-700"
            }`}
          />
        </div>
      );
    case "bulleted_list_item":
      return (
        <div className="flex items-center gap-2 py-0.5 text-[15px] text-zinc-700">
          <span className="text-zinc-400">•</span>
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            placeholder="List item"
            className={textInputClass}
          />
        </div>
      );
    case "numbered_list_item":
      return (
        <div className="flex items-center gap-2 py-0.5 text-[15px] text-zinc-700">
          <span className="font-mono text-xs text-zinc-400">1.</span>
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            className={textInputClass}
          />
        </div>
      );
    case "quote":
      return (
        <div className="border-l-2 border-zinc-300 py-1 pl-4 text-[15px] italic text-zinc-600">
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            className={`${textInputClass} italic`}
          />
        </div>
      );
    case "callout":
      return (
        <div className="my-3 flex gap-3 rounded-lg border border-ink/10 bg-paper p-4 text-[15px] text-zinc-700">
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
            aria-label="Callout icon"
            maxLength={8}
            className="w-8 shrink-0 bg-transparent text-center text-xl outline-none"
          />
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            placeholder="Callout"
            className={textInputClass}
          />
        </div>
      );
    case "divider":
      return <hr className="my-4 border-ink/10" />;
    case "database_view":
      return <DatabaseView databaseId={block.databaseId} viewId={block.viewId} />;
    default:
      return null;
  }
}
