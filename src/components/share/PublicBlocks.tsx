"use client";

import { useI18n } from "@/lib/i18n/client";
import type { PublicBlock, PublicTextKind } from "@/lib/share/public-view";
import { cn } from "@/lib/utils";
import { PublicFlashcards } from "./PublicFlashcards";
import { PublicQuiz } from "./PublicQuiz";
import { ShareOriginsProvider, ShareRichText } from "./ShareRichText";

type TextBlock = Extract<PublicBlock, { type: "text" }>;
type Group =
  | { kind: "list"; type: "bulleted_list_item" | "numbered_list_item" | "todo"; items: TextBlock[]; start: number }
  | { kind: "block"; block: PublicBlock; index: number };

const LIST_KINDS = new Set<PublicTextKind>(["bulleted_list_item", "numbered_list_item", "todo"]);

/** Consecutive list items of one kind become one list (for screen readers too). */
export function groupBlocks(blocks: readonly PublicBlock[]): Group[] {
  const groups: Group[] = [];
  blocks.forEach((block, index) => {
    if (block.type === "text" && LIST_KINDS.has(block.kind)) {
      const last = groups[groups.length - 1];
      if (last?.kind === "list" && last.type === block.kind) {
        last.items.push(block);
        return;
      }
      groups.push({
        kind: "list",
        type: block.kind as "bulleted_list_item" | "numbered_list_item" | "todo",
        items: [block],
        start: block.number ?? 1,
      });
      return;
    }
    groups.push({ kind: "block", block, index });
  });
  return groups;
}

const TEXT = "text-[15px] leading-7 text-ink break-words [&_li]:whitespace-pre-line [&_p]:whitespace-pre-line";

const HEADING: Partial<Record<PublicTextKind, { level: number; wrap: string; text: string }>> = {
  heading1: { level: 2, wrap: "mt-7 mb-1", text: "font-display text-2xl font-bold leading-snug" },
  heading2: { level: 3, wrap: "mt-5 mb-1", text: "font-display text-xl font-bold leading-snug" },
  heading3: { level: 4, wrap: "mt-4 mb-0.5", text: "font-display text-lg font-bold leading-snug" },
};

const NO_ORIGINS: readonly string[] = [];

/**
 * The read-only blocks of a shared page. `origins`: StudyOS's own origins,
 * whose links into the app read as plain text (lib/share/rehype-share.ts).
 */
export function PublicBlocks({
  blocks,
  token,
  origins = NO_ORIGINS,
}: {
  blocks: PublicBlock[];
  token: string;
  origins?: readonly string[];
}) {
  const { dict } = useI18n();
  if (blocks.length === 0) {
    return <p className="mt-6 text-sm text-ink-soft">{dict.share.empty}</p>;
  }
  return (
    <ShareOriginsProvider origins={origins}>
      <div className="mt-6">
        {groupBlocks(blocks).map((group, i) =>
          group.kind === "list" ? (
            <ListGroup key={`l${i}`} group={group} token={token} />
          ) : (
            <BlockView key={`b${group.index}`} block={group.block} token={token} />
          ),
        )}
      </div>
    </ShareOriginsProvider>
  );
}

function ListGroup({ group, token }: { group: Extract<Group, { kind: "list" }>; token: string }) {
  const { dict } = useI18n();
  const Tag = group.type === "numbered_list_item" ? "ol" : "ul";
  return (
    <Tag role="list" className="my-1" start={group.type === "numbered_list_item" ? group.start : undefined}>
      {group.items.map((item, i) => (
        <li key={i} className="flex min-w-0 items-start gap-2 py-0.5">
          {group.type === "todo" ? (
            <span className="flex h-7 w-6 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                checked={item.checked === true}
                readOnly
                disabled
                aria-label={item.text.trim() || dict.page.blockTypes.todo}
                className="size-4 accent-lime"
              />
            </span>
          ) : group.type === "numbered_list_item" ? (
            <span aria-hidden className="h-7 min-w-6 shrink-0 text-end text-[15px] leading-7 tabular-nums text-ink-soft">
              {(item.number ?? group.start + i)}.
            </span>
          ) : (
            <span aria-hidden className="flex h-7 w-5 shrink-0 items-center justify-center text-ink-faint">
              •
            </span>
          )}
          <div className={cn("min-w-0 flex-1", TEXT, group.type === "todo" && item.checked && "text-ink-faint line-through")}>
            <ShareRichText text={item.text} token={token} />
          </div>
        </li>
      ))}
    </Tag>
  );
}

function BlockView({ block, token }: { block: PublicBlock; token: string }) {
  const { dict, plural } = useI18n();
  switch (block.type) {
    case "text": {
      const heading = HEADING[block.kind];
      if (heading) {
        return (
          <div role="heading" aria-level={heading.level} className={cn(heading.wrap, TEXT, heading.text)}>
            <ShareRichText text={block.text} token={token} />
          </div>
        );
      }
      if (block.kind === "quote") {
        return (
          <blockquote className={cn("my-1 border-s-2 border-line-strong py-0.5 ps-4 italic text-ink-soft", TEXT)}>
            <ShareRichText text={block.text} token={token} />
          </blockquote>
        );
      }
      if (block.kind === "callout") {
        return (
          <div className="my-3 flex min-w-0 items-start gap-2 rounded-2xl border border-line bg-oat p-3 sm:p-4">
            {block.emoji && (
              <span aria-hidden className="h-7 w-8 shrink-0 text-center text-xl leading-7">
                {block.emoji}
              </span>
            )}
            <div className={cn("min-w-0 flex-1", TEXT)}>
              <ShareRichText text={block.text} token={token} />
            </div>
          </div>
        );
      }
      return (
        <div className={cn("py-1", TEXT)}>
          <ShareRichText text={block.text} token={token} />
        </div>
      );
    }
    case "divider":
      return <hr className="my-4 border-line" />;
    case "image":
      return (
        <figure className="my-4">
          {/* Sent by the share's own route, never cached (the link can be turned off); SVG is inert in <img>. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={block.src}
            alt={block.alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="max-w-full rounded-2xl border border-line"
          />
          {block.caption && (
            <figcaption dir="auto" className="mt-1.5 text-center text-xs text-ink-soft">
              {block.caption}
            </figcaption>
          )}
        </figure>
      );
    case "table":
      return (
        <figure className="my-5">
          <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span dir="auto" className="font-display text-base font-bold text-ink">
              {block.icon ? `${block.icon} ` : ""}
              {block.name}
            </span>
            {block.viewName && (
              <span dir="auto" className="text-ink-soft">
                {block.viewName}
              </span>
            )}
          </figcaption>
          <div className="overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full min-w-max border-collapse text-start text-sm">
              <thead>
                <tr className="bg-oat/60">
                  {block.columns.map((column, i) => (
                    <th key={i} scope="col" dir="auto" className="px-3 py-2 text-start text-xs font-semibold text-ink-soft">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-t border-line">
                    {row.map((cell, c) => (
                      <td key={c} dir="auto" className="max-w-xs whitespace-pre-line break-words px-3 py-2 align-top text-ink">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.more > 0 && <p className="mt-2 text-xs text-ink-soft">{plural(dict.counts.moreRows, block.more)}</p>}
        </figure>
      );
    case "flashcards":
      return <PublicFlashcards title={block.title} cards={block.cards} token={token} />;
    case "quiz":
      return <PublicQuiz title={block.title} questions={block.questions} token={token} />;
    case "hidden":
      return (
        <p className="my-3 rounded-2xl border border-dashed border-line-strong px-4 py-3 text-sm text-ink-soft">
          {dict.share.hiddenComponent}
        </p>
      );
    default:
      return null;
  }
}
