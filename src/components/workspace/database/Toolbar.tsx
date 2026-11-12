"use client";

import { useId, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Columns3,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import type {
  CellValue,
  Database,
  DatabaseProperty,
  DatabaseView as DBView,
  FilterOperator,
  ViewFilter,
  ViewSort,
} from "@/lib/workspace/types";
import {
  defaultFilter,
  FILTER_OPERATORS,
  isDayKey,
  isFilterActive,
  operatorTakesValue,
  upcomingViewSettings,
} from "@/lib/workspace/view-logic";
import { useI18n } from "@/lib/i18n/client";
import { useWorkspace } from "../WorkspaceContext";
import { ImportDeadlinesButton } from "../feeds/ImportDeadlinesButton";
import { DraftInput } from "../editor/DraftInput";
import type { DbActions } from "./actions";
import { ChipMultiSelect } from "./cells";
import { deadlineProp, orderedProps, rowTitle } from "./shared";

type Panel = "filter" | "sort" | "fields" | null;

const CONTROL =
  "h-9 rounded-md border border-line bg-card px-2 text-sm text-ink outline-none focus:border-ink/40";
const ICON_BUTTON =
  "grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-faint transition hover:bg-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";

/** Search box plus Filter / Sort / Fields panels for one view. */
export function ViewToolbar({
  db,
  view,
  actions,
  search,
  onSearch,
  onCreateView,
}: {
  db: Database;
  view: DBView;
  actions: DbActions;
  search: string;
  onSearch: (value: string) => void;
  onCreateView: (view: DBView) => void;
}) {
  const { dict } = useI18n();
  const [panel, setPanel] = useState<Panel>(null);
  const baseId = useId();
  const activeFilters = (view.filters ?? []).filter((f) => isFilterActive(db, f)).length;
  const sortCount = (view.sorts ?? []).filter((s) => db.properties.some((p) => p.id === s.propertyId)).length;
  const hiddenCount = db.properties.length - orderedProps(db, view).filter((x) => x.visible).length;

  const toggle = (next: Exclude<Panel, null>) => setPanel((p) => (p === next ? null : next));
  const tab = (key: Exclude<Panel, null>, label: string, Icon: typeof ListFilter, count: number) => (
    <button
      type="button"
      onClick={() => toggle(key)}
      aria-expanded={panel === key}
      aria-controls={`${baseId}-${key}`}
      aria-label={count ? `${label} (${count})` : label}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm transition ${
        panel === key || count ? "bg-lime-faint text-lime" : "text-ink-soft hover:bg-hover hover:text-ink"
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      {count > 0 && <span className="text-xs tabular-nums">{count}</span>}
    </button>
  );

  return (
    <div className="mb-3">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onSearch("");
            }}
            placeholder={dict.dbViews.searchPlaceholder}
            aria-label={dict.dbViews.search}
            className="h-9 w-full rounded-md border border-line bg-card ps-8 pe-8 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink/40 [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch("")}
              aria-label={dict.dbViews.clearSearch}
              className="absolute end-0.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-ink-faint hover:text-ink"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
        {tab("filter", dict.dbViews.filter, ListFilter, activeFilters)}
        {tab("sort", dict.dbViews.sort, ArrowUpDown, sortCount)}
        {tab("fields", dict.dbViews.fields, Columns3, hiddenCount)}
        <ImportDeadlinesButton db={db} />
      </div>

      {panel === "filter" && (
        <div id={`${baseId}-filter`} role="region" aria-label={dict.dbViews.filter} className="mt-2 rounded-md border border-line bg-surface p-3">
          <FilterPanel db={db} view={view} actions={actions} onCreateView={onCreateView} />
        </div>
      )}
      {panel === "sort" && (
        <div id={`${baseId}-sort`} role="region" aria-label={dict.dbViews.sort} className="mt-2 rounded-md border border-line bg-surface p-3">
          <SortPanel db={db} view={view} actions={actions} />
        </div>
      )}
      {panel === "fields" && (
        <div id={`${baseId}-fields`} role="region" aria-label={dict.dbViews.fields} className="mt-2 rounded-md border border-line bg-surface p-3">
          <FieldsPanel db={db} view={view} actions={actions} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters

function FilterPanel({
  db,
  view,
  actions,
  onCreateView,
}: {
  db: Database;
  view: DBView;
  actions: DbActions;
  onCreateView: (view: DBView) => void;
}) {
  const { dict } = useI18n();
  const filters = view.filters ?? [];
  const setFilters = (fn: (filters: ViewFilter[]) => ViewFilter[]) =>
    actions.updateView(view.id, (v) => {
      const next = fn(v.filters ?? []);
      v.filters = next.length ? next : undefined;
      if (next.length < 2) v.filterMatch = undefined;
    });
  const dateProp = deadlineProp(db, view);
  const upcoming = upcomingViewSettings(db, dateProp?.id);

  return (
    <div className="space-y-2">
      {filters.length > 1 && (
        <select
          value={view.filterMatch ?? "all"}
          onChange={(e) =>
            actions.updateView(view.id, (v) => {
              v.filterMatch = e.target.value === "any" ? "any" : undefined;
            })
          }
          aria-label={dict.dbViews.filterMatch}
          className={CONTROL}
        >
          <option value="all">{dict.dbViews.matchAll}</option>
          <option value="any">{dict.dbViews.matchAny}</option>
        </select>
      )}
      {filters.map((filter, index) => (
        <FilterRow
          key={index}
          db={db}
          filter={filter}
          onChange={(next) => setFilters((list) => list.map((f, i) => (i === index ? next : f)))}
          onRemove={() => setFilters((list) => list.filter((_, i) => i !== index))}
        />
      ))}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => setFilters((list) => [...list, defaultFilter(dateProp ?? db.properties[0])])}
          className="min-h-9 rounded-md px-2 text-sm font-medium text-ink-soft hover:bg-hover hover:text-ink"
        >
          {dict.dbViews.addFilter}
        </button>
        {upcoming && (
          // The preset always goes into its own view: the view the student is
          // looking at keeps its filters and sorts exactly as they were.
          <button
            type="button"
            onClick={() =>
              onCreateView({
                id: crypto.randomUUID(),
                name: dict.dbViews.thisWeekViewName,
                type: "list",
                ...upcoming,
              })
            }
            className="flex min-h-9 flex-col items-start rounded-md border border-line px-2 py-1 text-start text-sm text-ink-soft hover:bg-hover hover:text-ink"
          >
            <span>{dict.dbViews.createThisWeekView}</span>
            <span className="text-xs text-ink-faint">{dict.dbViews.thisWeekPreset}</span>
          </button>
        )}
        {filters.length > 0 && (
          <button
            type="button"
            onClick={() => setFilters(() => [])}
            className="min-h-9 rounded-md px-2 text-sm text-ink-faint hover:bg-hover hover:text-ink"
          >
            {dict.dbViews.clearFilters}
          </button>
        )}
      </div>
    </div>
  );
}

const DAY_OPS: FilterOperator[] = ["is", "before", "after", "on_or_before", "on_or_after"];
const COUNT_OPS: FilterOperator[] = ["next_days", "past_days"];

/** Keep a filter's value when its operator changes, if it still makes sense. */
function valueForOperator(prop: DatabaseProperty, op: FilterOperator, value: CellValue | undefined): CellValue {
  if (!operatorTakesValue(op)) return null;
  if (prop.type === "date") {
    if (COUNT_OPS.includes(op)) return typeof value === "number" ? value : 7;
    if (DAY_OPS.includes(op)) return typeof value === "string" ? value : "today";
  }
  return value ?? null;
}

function FilterRow({
  db,
  filter,
  onChange,
  onRemove,
}: {
  db: Database;
  filter: ViewFilter;
  onChange: (filter: ViewFilter) => void;
  onRemove: () => void;
}) {
  const { dict } = useI18n();
  const prop = db.properties.find((p) => p.id === filter.propertyId);
  const operators = prop ? FILTER_OPERATORS[prop.type] : [];

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-card p-1.5">
      <select
        value={filter.propertyId}
        onChange={(e) => {
          const next = db.properties.find((p) => p.id === e.target.value);
          if (next) onChange(defaultFilter(next));
        }}
        aria-label={dict.dbViews.filterField}
        className={`${CONTROL} min-w-0 max-w-[45%] flex-1 sm:flex-none`}
      >
        {!prop && <option value={filter.propertyId}>—</option>}
        {db.properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {prop && (
        <select
          value={operators.includes(filter.operator) ? filter.operator : operators[0]}
          onChange={(e) => {
            const op = e.target.value as FilterOperator;
            onChange({ ...filter, operator: op, value: valueForOperator(prop, op, filter.value) });
          }}
          aria-label={dict.dbViews.filterCondition}
          className={`${CONTROL} min-w-0 flex-1 sm:flex-none`}
        >
          {operators.map((op) => (
            <option key={op} value={op}>
              {dict.dbViews.operators[op]}
            </option>
          ))}
        </select>
      )}
      {prop && operatorTakesValue(filter.operator) && (
        <div className="min-w-0 flex-1 basis-40">
          <FilterValue prop={prop} filter={filter} onChange={(value) => onChange({ ...filter, value })} />
        </div>
      )}
      <button type="button" onClick={onRemove} aria-label={dict.dbViews.removeFilter} className={`${ICON_BUTTON} ms-auto`}>
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function FilterValue({
  prop,
  filter,
  onChange,
}: {
  prop: DatabaseProperty;
  filter: ViewFilter;
  onChange: (value: CellValue) => void;
}) {
  const { dict } = useI18n();
  const { workspace } = useWorkspace();
  const value = filter.value;
  const label = dict.dbViews.filterValue;

  // Text-like inputs buffer typing (commit after a pause for text, on blur /
  // Enter for numbers) so typing does not save a new version of the view on
  // every keystroke. Like cells, they register the buffered text with the
  // sync engine, so it is written before the tab is hidden or closed.
  const textInput = (type: "text" | "number", current: string, parse: (raw: string) => CellValue) => (
    <DraftInput
      type={type}
      inputMode={type === "number" ? "decimal" : undefined}
      value={current}
      commitOnPause={type === "text"}
      onCommit={(raw) => {
        const next = parse(raw);
        if (next !== value) onChange(next);
      }}
      aria-label={label}
      placeholder={label}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={`${CONTROL} w-full`}
    />
  );

  switch (prop.type) {
    case "checkbox":
      return (
        <select
          value={value === false || value === "false" ? "false" : "true"}
          onChange={(e) => onChange(e.target.value === "true")}
          aria-label={label}
          className={`${CONTROL} w-full`}
        >
          <option value="true">{dict.dbViews.checked}</option>
          <option value="false">{dict.dbViews.unchecked}</option>
        </select>
      );
    case "number":
      return textInput("number", typeof value === "number" ? String(value) : "", (raw) =>
        raw.trim() === "" ? null : Number(raw),
      );
    case "date":
      if (COUNT_OPS.includes(filter.operator)) {
        return (
          <span className="flex items-center gap-1.5">
            {textInput("number", typeof value === "number" ? String(value) : "", (raw) =>
              raw.trim() === "" ? null : Math.max(0, Math.floor(Number(raw))),
            )}
            <span className="shrink-0 text-sm text-ink-soft">{dict.dbViews.days}</span>
          </span>
        );
      }
      return <DayValue value={value} onChange={onChange} />;
    case "select":
    case "status":
    case "multi_select":
      return (
        <ChipMultiSelect
          label={label}
          items={prop.options ?? []}
          selected={toIds(value)}
          onChange={(ids) => onChange(ids.length === 1 && prop.type !== "multi_select" ? ids[0] : ids)}
          addLabel={dict.dbViews.choose}
        />
      );
    case "relation": {
      const related = workspace.databases.find((d) => d.id === prop.relationDatabaseId);
      const items = (related?.rows ?? []).map((row) => ({
        id: row.id,
        label: rowTitle(related!, row) || dict.db.untitled,
      }));
      return (
        <ChipMultiSelect label={label} items={items} selected={toIds(value)} onChange={onChange} addLabel={dict.dbViews.choose} />
      );
    }
    default:
      return textInput("text", typeof value === "string" ? value : "", (raw) => raw);
  }
}

function toIds(value: CellValue | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value ? [value] : [];
}

/** A day for a date filter: today / tomorrow / yesterday (they move) or a fixed date. */
function DayValue({ value, onChange }: { value: CellValue | undefined; onChange: (value: CellValue) => void }) {
  const { dict } = useI18n();
  const relative = typeof value === "string" && ["today", "tomorrow", "yesterday"].includes(value);
  const mode = relative ? (value as string) : "exact";
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <select
        value={mode}
        onChange={(e) => onChange(e.target.value === "exact" ? (isDayKey(value) ? value : null) : e.target.value)}
        aria-label={dict.dbViews.filterValue}
        className={`${CONTROL} min-w-0 flex-1`}
      >
        <option value="today">{dict.dbViews.today}</option>
        <option value="tomorrow">{dict.dbViews.tomorrow}</option>
        <option value="yesterday">{dict.dbViews.yesterday}</option>
        <option value="exact">{dict.dbViews.exactDate}</option>
      </select>
      {mode === "exact" && (
        <input
          type="date"
          value={isDayKey(value) ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
          aria-label={dict.dbViews.exactDate}
          className={`${CONTROL} min-w-0 flex-1 [color-scheme:dark] [.light_&]:[color-scheme:light]`}
        />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sorts

function SortPanel({ db, view, actions }: { db: Database; view: DBView; actions: DbActions }) {
  const { dict, t } = useI18n();
  const sorts = view.sorts ?? [];
  const setSorts = (fn: (sorts: ViewSort[]) => ViewSort[]) =>
    actions.updateView(view.id, (v) => {
      const next = fn(v.sorts ?? []);
      v.sorts = next.length ? next : undefined;
    });
  const move = (index: number, delta: number) =>
    setSorts((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });
  const unused = db.properties.find((p) => !sorts.some((s) => s.propertyId === p.id));

  return (
    <div className="space-y-2">
      {sorts.map((sort, index) => {
        const name = db.properties.find((p) => p.id === sort.propertyId)?.name ?? "—";
        return (
          <div key={`${sort.propertyId}:${index}`} className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-card p-1.5">
            <select
              value={sort.propertyId}
              onChange={(e) =>
                setSorts((list) => list.map((s, i) => (i === index ? { ...s, propertyId: e.target.value } : s)))
              }
              aria-label={dict.dbViews.sortField}
              className={`${CONTROL} min-w-0 flex-1 sm:flex-none`}
            >
              {db.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              value={sort.direction}
              onChange={(e) =>
                setSorts((list) =>
                  list.map((s, i) => (i === index ? { ...s, direction: e.target.value === "desc" ? "desc" : "asc" } : s)),
                )
              }
              aria-label={dict.dbViews.sortDirection}
              className={`${CONTROL} min-w-0 flex-1 sm:flex-none`}
            >
              <option value="asc">{dict.dbViews.ascending}</option>
              <option value="desc">{dict.dbViews.descending}</option>
            </select>
            <span className="ms-auto flex">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={t(dict.dbViews.moveUp, { name })}
                className={ICON_BUTTON}
              >
                <ChevronUp className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === sorts.length - 1}
                aria-label={t(dict.dbViews.moveDown, { name })}
                className={ICON_BUTTON}
              >
                <ChevronDown className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setSorts((list) => list.filter((_, i) => i !== index))}
                aria-label={dict.dbViews.removeSort}
                className={ICON_BUTTON}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </span>
          </div>
        );
      })}
      {unused && (
        <button
          type="button"
          onClick={() => setSorts((list) => [...list, { propertyId: unused.id, direction: "asc" }])}
          className="min-h-9 rounded-md px-2 text-sm font-medium text-ink-soft hover:bg-hover hover:text-ink"
        >
          {dict.dbViews.addSort}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fields (show / hide / reorder columns)

function FieldsPanel({ db, view, actions }: { db: Database; view: DBView; actions: DbActions }) {
  const { dict, t } = useI18n();
  const items = orderedProps(db, view);
  const visibleIds = items.filter((x) => x.visible).map((x) => x.prop.id);

  const save = (ids: string[]) =>
    actions.updateView(view.id, (v, target) => {
      // Showing every field in stored order is the same as having no list.
      const all = target.properties.map((p) => p.id);
      v.visiblePropertyIds =
        ids.length === all.length && ids.every((id, i) => id === all[i]) ? undefined : ids;
    });

  const toggle = (id: string, show: boolean) => {
    if (show) save([...visibleIds, id]);
    else if (visibleIds.length > 1) save(visibleIds.filter((x) => x !== id));
  };
  const move = (index: number, delta: number) => {
    const next = [...visibleIds];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    save(next);
  };

  return (
    <ul className="space-y-1">
      {items.map(({ prop, visible }) => {
        const index = visibleIds.indexOf(prop.id);
        return (
          <li key={prop.id} className="flex items-center gap-1 rounded-md bg-card px-2 py-0.5">
            <label className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={visible}
                disabled={visible && visibleIds.length <= 1}
                onChange={(e) => toggle(prop.id, e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span className={`truncate ${visible ? "" : "text-ink-faint"}`}>{prop.name}</span>
            </label>
            {visible && (
              <>
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={t(dict.dbViews.moveUp, { name: prop.name })}
                  className={ICON_BUTTON}
                >
                  <ChevronUp className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === visibleIds.length - 1}
                  aria-label={t(dict.dbViews.moveDown, { name: prop.name })}
                  className={ICON_BUTTON}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </button>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
