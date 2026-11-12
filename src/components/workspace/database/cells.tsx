"use client";

import { useState } from "react";
import { Check, Circle, CircleCheck, ExternalLink, Pencil, X } from "lucide-react";
import type { CellValue, DatabaseProperty } from "@/lib/workspace/types";
import { DUE_TONE_CLASSES, pillClasses } from "@/lib/workspace/colors";
import { titleProperty } from "@/lib/workspace/helpers";
import { dueInfo, relativeUnit, safeHttpUrl } from "@/lib/workspace/view-logic";
import { useI18n } from "@/lib/i18n/client";
import { useWorkspace } from "../WorkspaceContext";
import { DraftInput } from "../editor/DraftInput";
import { formatDay, formatNumber, rowTitle, useToday } from "./shared";

/**
 * Multi-value cell (multi_select and relation) rendered as wrapping colored
 * pills with an inline add-menu. The menu expands INLINE (full-width row)
 * rather than as a popover, so a scrolling table can never clip it.
 */
export function ChipMultiSelect({
  label,
  items,
  selected,
  onChange,
  addLabel,
}: {
  label: string;
  items: { id: string; label: string; color?: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
}) {
  const { dict, t } = useI18n();
  const [open, setOpen] = useState(false);
  const byId = new Map(items.map((i) => [i.id, i]));
  const chosen = selected.filter((id) => byId.has(id));
  const available = items.filter((i) => !selected.includes(i.id));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="flex flex-wrap items-center gap-1 py-0.5" role="group" aria-label={label}>
      {chosen.map((id) => {
        const item = byId.get(id)!;
        return (
          <span
            key={id}
            className={`inline-flex max-w-full items-center gap-0.5 rounded-full py-0.5 ps-2 text-xs font-medium ring-1 ring-inset ${pillClasses(item.color)}`}
          >
            <span dir="auto" className="truncate">{item.label}</span>
            <button
              type="button"
              onClick={() => toggle(id)}
              aria-label={t(dict.dbViews.removeTag, { name: item.label })}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full opacity-60 transition hover:opacity-100"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        );
      })}
      {available.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? dict.dbViews.closeMenu : undefined}
          className="min-h-7 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-xs text-ink-faint transition hover:border-ink/40 hover:text-ink"
        >
          {open ? <X className="h-3 w-3" aria-hidden /> : `+ ${addLabel}`}
        </button>
      )}
      {open && available.length > 0 && (
        <div className="mt-1 flex w-full flex-wrap gap-1">
          {available.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => toggle(item.id)}
              className={`inline-flex min-h-7 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset transition hover:brightness-110 ${pillClasses(item.color)}`}
            >
              <span aria-hidden>+</span>
              <span dir="auto" className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Single-choice cell (select and status): one colored pill with an inline
 * choose-menu, consistent with ChipMultiSelect.
 */
export function SingleSelectCell({
  label,
  options,
  value,
  onChange,
  emptyLabel,
}: {
  label: string;
  options: { id: string; label: string; color?: string }[];
  value: string | null;
  onChange: (next: string | null) => void;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1 py-0.5" role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="min-h-7 max-w-full rounded-full text-start"
      >
        {current ? (
          <span
            dir="auto"
            className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${pillClasses(current.color)}`}
          >
            {current.label}
          </span>
        ) : (
          <span className="px-1 text-xs text-ink-faint">{emptyLabel}</span>
        )}
      </button>
      {open && (
        <div className="mt-1 flex w-full flex-wrap gap-1">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => choose(o.id)}
              aria-pressed={o.id === value}
              className={`inline-flex min-h-7 max-w-full items-center rounded-full px-2 py-0.5 text-xs ring-1 ring-inset transition hover:brightness-110 ${pillClasses(o.color)} ${o.id === value ? "outline outline-1 outline-ink/40" : ""}`}
            >
              <span dir="auto" className="truncate">{o.label}</span>
            </button>
          ))}
          {value !== null && (
            <button
              type="button"
              onClick={() => choose(null)}
              className="min-h-7 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-xs text-ink-faint transition hover:text-ink"
            >
              {emptyLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "Tomorrow", "in 3 days", "2 days ago": a deadline at a glance. */
export function DueBadge({
  value,
  complete = false,
}: {
  value: CellValue | undefined;
  complete?: boolean;
}) {
  const today = useToday();
  const { dict, locale } = useI18n();
  const info = today ? dueInfo(value, today, complete) : null;
  if (!info || typeof value !== "string") return null;
  const { value: amount, unit } = relativeUnit(info.days);
  const label = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(amount, unit);
  return (
    <span
      title={formatDay(value, locale, { dateStyle: "full" })}
      data-tone={info.tone}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[11px] font-medium ring-1 ring-inset ${DUE_TONE_CLASSES[info.tone]}`}
    >
      {info.tone === "overdue" && (
        <>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          <span className="sr-only">{dict.dbViews.overdue}: </span>
        </>
      )}
      {label}
    </span>
  );
}

/**
 * A URL cell: a real link (http/https only) with a pencil to edit, or a text
 * box while editing / when empty.
 */
export function UrlCell({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string | null) => void;
}) {
  const { dict } = useI18n();
  const [editing, setEditing] = useState(false);
  const href = safeHttpUrl(value);

  if (editing || !value) {
    return (
      <DraftInput
        type="url"
        inputMode="url"
        aria-label={label}
        autoFocus={editing}
        placeholder={dict.dbViews.linkPlaceholder}
        value={value}
        commitOnPause={false}
        revertOnEscape
        onCommit={(text) => {
          const next = text.trim();
          if (next !== value) onCommit(next || null);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-full min-w-0 rounded bg-transparent px-1 py-0.5 text-ink outline-none placeholder:text-ink-faint focus:bg-card focus:ring-1 focus:ring-ink/20"
      />
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={href}
          className="inline-flex min-w-0 items-center gap-1 truncate px-1 py-0.5 text-lime underline-offset-2 hover:underline"
        >
          <span dir="ltr" className="truncate">{displayUrl(value)}</span>
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          <span className="sr-only">({dict.dbViews.openLink})</span>
        </a>
      ) : (
        <span dir="auto" title={dict.dbViews.unsafeLink} className="min-w-0 truncate px-1 py-0.5 text-ink-soft">
          {value}
        </span>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`${dict.dbViews.editLink}: ${label}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-faint transition hover:bg-hover hover:text-ink"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

function displayUrl(value: string): string {
  return value.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** Round "mark done" button for rows that have a completion field. */
export function CompleteToggle({
  done,
  title,
  onToggle,
}: {
  done: boolean;
  title: string;
  onToggle: () => void;
}) {
  const { dict, t } = useI18n();
  const name = title || dict.db.untitled;
  return (
    <button
      type="button"
      data-print="keep"
      onClick={onToggle}
      aria-pressed={done}
      aria-label={t(done ? dict.dbViews.markOpen : dict.dbViews.markDone, { name })}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-hover ${done ? "text-lime" : "text-ink-faint hover:text-ink-soft"}`}
    >
      {done ? <CircleCheck className="h-5 w-5" aria-hidden /> : <Circle className="h-5 w-5" aria-hidden />}
    </button>
  );
}

const BASE_INPUT =
  "w-full min-w-0 rounded bg-transparent px-1 py-0.5 outline-none focus:bg-card focus:ring-1 focus:ring-ink/20";

/** An editable cell for any property type. Commits through `update()`. */
export function EditableCell({
  databaseId,
  rowId,
  prop,
  value,
  complete = false,
  label,
}: {
  databaseId: string;
  rowId: string;
  prop: DatabaseProperty;
  value: CellValue;
  /** The row is done: its date shows no overdue warning. */
  complete?: boolean;
  /** Accessible name; defaults to the property name. */
  label?: string;
}) {
  const { workspace, update } = useWorkspace();
  const { dict } = useI18n();
  const name = label ?? prop.name;

  const setCell = (v: CellValue) =>
    update((d) => {
      const row = d.databases.find((x) => x.id === databaseId)?.rows.find((r) => r.id === rowId);
      if (row) row.cells[prop.id] = v;
    });

  // Typed cells keep what is being typed in a draft registered with the sync
  // engine (written before the tab hides, before undo and before a merge) and
  // follow outside changes when nothing is being typed, so they never remount
  // and never lose a half-typed value.
  const k = `${rowId}:${prop.id}`;

  switch (prop.type) {
    case "checkbox":
      return (
        <label className="inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            aria-label={name}
            checked={value === true}
            onChange={(e) => setCell(e.target.checked)}
            className="h-4 w-4 rounded border-line-strong accent-[var(--accent)]"
          />
        </label>
      );
    case "number":
      return (
        <DraftInput
          key={k}
          type="number"
          inputMode="decimal"
          aria-label={name}
          value={value === null || value === undefined ? "" : String(value)}
          commitOnPause={false}
          onCommit={(text) => {
            const next = text === "" ? null : Number(text);
            if (next !== value && !(next !== null && Number.isNaN(next))) setCell(next);
          }}
          className={`${BASE_INPUT} tabular-nums text-ink`}
        />
      );
    case "date":
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <DraftInput
            key={k}
            type="date"
            aria-label={name}
            value={typeof value === "string" ? value : ""}
            commitOnPause={false}
            onCommit={(text) => {
              const next = text || null;
              if (next !== value) setCell(next);
            }}
            className={`${BASE_INPUT} w-auto text-ink-soft [color-scheme:dark] [.light_&]:[color-scheme:light]`}
          />
          <DueBadge value={value} complete={complete} />
        </div>
      );
    case "url":
      return (
        <UrlCell
          key={k}
          label={name}
          value={typeof value === "string" ? value : ""}
          onCommit={setCell}
        />
      );
    case "select":
    case "status":
      return (
        <SingleSelectCell
          label={name}
          options={prop.options ?? []}
          value={typeof value === "string" ? value : null}
          onChange={setCell}
          emptyLabel={dict.db.empty}
        />
      );
    case "multi_select":
      return (
        <ChipMultiSelect
          label={name}
          items={prop.options ?? []}
          selected={Array.isArray(value) ? value : []}
          onChange={setCell}
          addLabel={dict.db.addTag}
        />
      );
    case "relation": {
      const related = workspace.databases.find((database) => database.id === prop.relationDatabaseId);
      const relatedTitle = related ? titleProperty(related) : null;
      const items = (related?.rows ?? []).map((row) => ({
        id: row.id,
        label: relatedTitle ? rowTitle(related!, row) || dict.db.untitled : row.id,
      }));
      return (
        <ChipMultiSelect
          label={name}
          items={items}
          selected={Array.isArray(value) ? value : []}
          onChange={setCell}
          addLabel={dict.db.addLink}
        />
      );
    }
    case "text":
    default:
      return (
        <DraftInput
          key={k}
          aria-label={name}
          dir="auto"
          value={typeof value === "string" ? value : value == null ? "" : String(value)}
          onCommit={(text) => {
            if (text !== (value ?? "")) setCell(text);
          }}
          className={`${BASE_INPUT} text-ink`}
        />
      );
  }
}

/**
 * Read-only, compact rendering of a value (list rows, gallery cards, calendar
 * agenda). Returns null for empty values so callers can skip them.
 * `interactive` = false renders links as plain text (for use inside buttons).
 */
export function CellDisplay({
  prop,
  value,
  complete = false,
  interactive = true,
}: {
  prop: DatabaseProperty;
  value: CellValue | undefined;
  complete?: boolean;
  interactive?: boolean;
}) {
  const { workspace } = useWorkspace();
  const { dict, locale } = useI18n();
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return null;
  }
  const pill = (key: string, text: string, color?: string) => (
    <span
      key={key}
      dir="auto"
      className={`inline-block max-w-full truncate rounded-full px-2 py-px text-[11px] font-medium ring-1 ring-inset ${pillClasses(color)}`}
    >
      {text}
    </span>
  );
  switch (prop.type) {
    case "checkbox":
      return value === true ? (
        <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
          <Check className="h-3.5 w-3.5 text-lime" aria-hidden />
          {prop.name}
        </span>
      ) : null;
    case "number":
      return typeof value === "number" ? (
        <span className="text-xs tabular-nums text-ink-soft">{formatNumber(value, locale)}</span>
      ) : null;
    case "date":
      return typeof value === "string" ? (
        <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
          <span>{/^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDay(value, locale, { month: "short", day: "numeric" }) : value}</span>
          <DueBadge value={value} complete={complete} />
        </span>
      ) : null;
    case "select":
    case "status": {
      const option = prop.options?.find((o) => o.id === value);
      return option ? pill(option.id, option.label, option.color) : null;
    }
    case "multi_select": {
      const ids = Array.isArray(value) ? value : [];
      const options = ids
        .map((id) => prop.options?.find((o) => o.id === id))
        .filter((o): o is NonNullable<typeof o> => Boolean(o));
      return options.length ? (
        <span className="inline-flex flex-wrap gap-1">{options.map((o) => pill(o.id, o.label, o.color))}</span>
      ) : null;
    }
    case "relation": {
      const related = workspace.databases.find((d) => d.id === prop.relationDatabaseId);
      const ids = Array.isArray(value) ? value : [];
      const labels = ids
        .map((id) => related?.rows.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => ({ id: r.id, label: rowTitle(related!, r) || dict.db.untitled }));
      return labels.length ? (
        <span className="inline-flex flex-wrap gap-1">{labels.map((l) => pill(l.id, l.label))}</span>
      ) : null;
    }
    case "url": {
      const href = safeHttpUrl(value);
      const text = displayUrl(String(value));
      return href && interactive ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-lime underline-offset-2 hover:underline"
        >
          <span dir="ltr" className="truncate">{text}</span>
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
        </a>
      ) : (
        <span dir="ltr" className="truncate text-xs text-ink-soft">{text}</span>
      );
    }
    default:
      return <span dir="auto" className="line-clamp-2 text-xs text-ink-soft">{String(value)}</span>;
  }
}
