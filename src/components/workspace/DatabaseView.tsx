"use client";

import { useRef, useState } from "react";
import type {
  CellValue,
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView as DBView,
  PropertyType,
} from "@/lib/workspace/types";
import { pillClasses } from "@/lib/workspace/colors";
import { getOption, titleProperty } from "@/lib/workspace/helpers";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { useWorkspace } from "./WorkspaceContext";

const VIEW_ICON: Record<DBView["type"], string> = {
  table: "▦",
  board: "▥",
  calendar: "▤",
  list: "≣",
  gallery: "▢",
};

const PROPERTY_TYPES: Array<{ value: PropertyType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "status", label: "Status" },
  { value: "url", label: "URL" },
  { value: "relation", label: "Relation" },
];

export function DatabaseView({
  databaseId,
  viewId,
}: {
  databaseId: string;
  viewId: string;
}) {
  const { workspace, update } = useWorkspace();
  const { dict } = useI18n();
  const [activeViewId, setActiveViewId] = useState(viewId);

  const database = workspace.databases.find((d) => d.id === databaseId);
  if (!database) return null;
  const view =
    database.views.find((v) => v.id === activeViewId) ?? database.views[0];

  return (
    <section className="my-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 border-b border-line">
        <div className="flex items-center gap-1.5 pb-2 text-sm font-medium text-ink-soft">
          <input
            value={database.icon ?? ""}
            onChange={(e) =>
              update((d) => {
                const target = d.databases.find((x) => x.id === database.id);
                if (target) target.icon = e.target.value;
              })
            }
            aria-label={dict.db.databaseIcon}
            maxLength={8}
            className="w-7 rounded bg-transparent text-center outline-none hover:bg-hover focus:bg-card focus:ring-1 focus:ring-ink/20"
          />
          <input
            value={database.name}
            onChange={(e) =>
              update((d) => {
                const t = d.databases.find((x) => x.id === database.id);
                if (t) t.name = e.target.value;
              })
            }
            aria-label={dict.db.nameAria}
            className="w-40 rounded bg-transparent px-1 text-sm font-medium text-ink-soft outline-none hover:bg-hover focus:bg-card focus:ring-1 focus:ring-ink/20"
          />
        </div>
        <div className="flex items-center gap-0.5">
          {database.views.map((v) => (
            <button
              key={v.id}
              onClick={() => setActiveViewId(v.id)}
              className={`-mb-px border-b-2 px-2 pb-2 text-sm transition ${
                v.id === view.id
                  ? "border-lime font-medium text-ink"
                  : "border-transparent text-ink-faint hover:text-ink-soft"
              }`}
            >
              <span className="mr-1 text-xs">{VIEW_ICON[v.type]}</span>
              {v.name}
            </button>
          ))}
        </div>
      </div>

      <DatabaseSettings
        database={database}
        activeViewId={view.id}
        setActiveViewId={setActiveViewId}
      />

      {view.type === "board" ? (
        <BoardView db={database} view={view} />
      ) : view.type === "calendar" ? (
        <CalendarView db={database} view={view} />
      ) : (
        <TableView db={database} view={view} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function DatabaseSettings({
  database,
  activeViewId,
  setActiveViewId,
}: {
  database: Database;
  activeViewId: string;
  setActiveViewId: (id: string) => void;
}) {
  const { workspace, update } = useWorkspace();
  const { dict, t } = useI18n();

  const addProperty = () => {
    const id = crypto.randomUUID();
    update((draft) => {
      draft.databases
        .find((item) => item.id === database.id)
        ?.properties.push({ id, name: dict.dbSettings.newField, type: "text" });
    });
  };

  const deleteProperty = (propertyId: string) => {
    if (database.properties.length <= 1) return;
    update((draft) => {
      const target = draft.databases.find((item) => item.id === database.id);
      if (!target) return;
      target.properties = target.properties.filter(
        (property) => property.id !== propertyId,
      );
      for (const row of target.rows) delete row.cells[propertyId];
      for (const view of target.views) {
        if (view.groupByPropertyId === propertyId) {
          view.groupByPropertyId = undefined;
        }
        if (view.datePropertyId === propertyId) {
          view.datePropertyId = undefined;
        }
        view.visiblePropertyIds = view.visiblePropertyIds?.filter(
          (id) => id !== propertyId,
        );
      }
    });
  };

  const changePropertyType = (
    propertyId: string,
    type: PropertyType,
  ) => {
    update((draft) => {
      const target = draft.databases.find((item) => item.id === database.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (!target || !property) return;
      property.type = type;
      property.options =
        type === "select" || type === "multi_select" || type === "status"
          ? defaultOptions(type, dict)
          : undefined;
      property.relationDatabaseId =
        type === "relation"
          ? draft.databases.find((item) => item.id !== database.id)?.id
          : undefined;
      for (const row of target.rows) row.cells[propertyId] = null;
      for (const view of target.views) {
        if (view.groupByPropertyId === propertyId) {
          view.groupByPropertyId = undefined;
        }
        if (view.datePropertyId === propertyId) {
          view.datePropertyId = undefined;
        }
      }
    });
  };

  const addOption = (propertyId: string) =>
    update((draft) => {
      const property = draft.databases
        .find((item) => item.id === database.id)
        ?.properties.find((item) => item.id === propertyId);
      property?.options?.push({
        id: crypto.randomUUID(),
        label: dict.dbSettings.newOption,
        color: "zinc",
      });
    });

  const deleteOption = (propertyId: string, optionId: string) =>
    update((draft) => {
      const target = draft.databases.find((item) => item.id === database.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (!target || !property) return;
      property.options = property.options?.filter(
        (option) => option.id !== optionId,
      );
      for (const row of target.rows) {
        const value = row.cells[propertyId];
        if (Array.isArray(value)) {
          row.cells[propertyId] = value.filter((id) => id !== optionId);
        } else if (value === optionId) {
          row.cells[propertyId] = null;
        }
      }
    });

  const addView = () => {
    const id = crypto.randomUUID();
    update((draft) => {
      draft.databases
        .find((item) => item.id === database.id)
        ?.views.push({ id, name: dict.dbSettings.newView, type: "table" });
    });
    setActiveViewId(id);
  };

  const deleteView = (viewId: string) => {
    if (database.views.length <= 1) return;
    const replacement = database.views.find((view) => view.id !== viewId);
    if (!replacement) return;
    update((draft) => {
      const target = draft.databases.find((item) => item.id === database.id);
      if (!target) return;
      target.views = target.views.filter((view) => view.id !== viewId);
      for (const page of draft.pages) {
        for (const block of page.blocks) {
          if (
            block.type === "database_view" &&
            block.databaseId === database.id &&
            block.viewId === viewId
          ) {
            block.viewId = replacement.id;
          }
        }
      }
    });
    if (activeViewId === viewId) setActiveViewId(replacement.id);
  };

  const deleteDatabase = () => {
    if (
      !window.confirm(
        t(dict.dbSettings.deleteConfirm, { name: database.name }),
      )
    ) {
      return;
    }
    update((draft) => {
      draft.databases = draft.databases.filter(
        (item) => item.id !== database.id,
      );
      for (const page of draft.pages) {
        page.blocks = page.blocks.filter(
          (block) =>
            block.type !== "database_view" ||
            block.databaseId !== database.id,
        );
      }
    });
  };

  return (
    <details className="mb-3 rounded-md border border-line bg-surface">
      <summary className="cursor-pointer select-none px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-soft hover:text-ink">
        {dict.dbSettings.customize}
      </summary>
      <div className="border-t border-line p-3">
        <label className="block text-xs font-medium text-ink-soft">
          {dict.dbSettings.description}
          <input
            value={database.description ?? ""}
            onChange={(e) =>
              update((draft) => {
                const target = draft.databases.find(
                  (item) => item.id === database.id,
                );
                if (target) target.description = e.target.value;
              })
            }
            placeholder={dict.dbSettings.descriptionPlaceholder}
            className="mt-1 w-full rounded border border-line bg-card px-2.5 py-1.5 text-sm font-normal text-ink outline-none focus:border-ink/40"
          />
        </label>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
              {dict.dbSettings.fields}
            </span>
            <button
              onClick={addProperty}
              className="text-xs font-medium text-ink-soft hover:text-ink"
            >
              {dict.dbSettings.addField}
            </button>
          </div>
          <div className="space-y-2">
            {database.properties.map((property) => (
              <div
                key={property.id}
                className="border border-line bg-card p-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={property.name}
                    onChange={(e) =>
                      update((draft) => {
                        const target = draft.databases
                          .find((item) => item.id === database.id)
                          ?.properties.find((item) => item.id === property.id);
                        if (target) target.name = e.target.value;
                      })
                    }
                    aria-label={dict.dbSettings.fieldName}
                    className="min-w-32 flex-1 rounded border border-line px-2 py-1 text-sm text-ink outline-none focus:border-ink/40"
                  />
                  <select
                    value={property.type}
                    onChange={(e) =>
                      changePropertyType(
                        property.id,
                        e.target.value as PropertyType,
                      )
                    }
                    aria-label={dict.dbSettings.fieldType}
                    className="rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft outline-none focus:border-ink/40"
                  >
                    {PROPERTY_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {dict.dbSettings.propertyTypes[type.value]}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => deleteProperty(property.id)}
                    disabled={database.properties.length <= 1}
                    title={dict.dbSettings.deleteField}
                    className="px-1 text-ink-faint/60 transition enabled:hover:text-rose-500 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>

                {property.type === "relation" && (
                  <select
                    value={property.relationDatabaseId ?? ""}
                    onChange={(e) =>
                      update((draft) => {
                        const target = draft.databases
                          .find((item) => item.id === database.id)
                          ?.properties.find((item) => item.id === property.id);
                        if (target) {
                          target.relationDatabaseId =
                            e.target.value || undefined;
                        }
                      })
                    }
                    className="mt-2 w-full rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft"
                  >
                    <option value="">{dict.dbSettings.chooseRelatedDatabase}</option>
                    {workspace.databases
                      .filter((item) => item.id !== database.id)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.icon} {item.name}
                        </option>
                      ))}
                  </select>
                )}

                {(property.type === "select" ||
                  property.type === "multi_select" ||
                  property.type === "status") && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {property.options?.map((option) => (
                      <span
                        key={option.id}
                        className="flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-1"
                      >
                        <input
                          value={option.label}
                          onChange={(e) =>
                            update((draft) => {
                              const target = draft.databases
                                .find((item) => item.id === database.id)
                                ?.properties.find(
                                  (item) => item.id === property.id,
                                )
                                ?.options?.find(
                                  (item) => item.id === option.id,
                                );
                              if (target) target.label = e.target.value;
                            })
                          }
                          aria-label={dict.dbSettings.optionLabel}
                          className="w-24 bg-transparent text-xs text-ink-soft outline-none"
                        />
                        <button
                          onClick={() =>
                            deleteOption(property.id, option.id)
                          }
                          className="text-[10px] text-ink-faint/60 hover:text-rose-500"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() => addOption(property.id)}
                      className="rounded-full border border-dashed border-line-strong px-2 py-1 text-xs text-ink-faint hover:text-ink"
                    >
                      {dict.dbSettings.addOption}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
              {dict.dbSettings.views}
            </span>
            <button
              onClick={addView}
              className="text-xs font-medium text-ink-soft hover:text-ink"
            >
              {dict.dbSettings.addView}
            </button>
          </div>
          <div className="space-y-2">
            {database.views.map((view) => (
              <div
                key={view.id}
                className="flex flex-wrap items-center gap-2 border border-line bg-card p-2"
              >
                <input
                  value={view.name}
                  onFocus={() => setActiveViewId(view.id)}
                  onChange={(e) =>
                    update((draft) => {
                      const target = draft.databases
                        .find((item) => item.id === database.id)
                        ?.views.find((item) => item.id === view.id);
                      if (target) target.name = e.target.value;
                    })
                  }
                  aria-label={dict.dbSettings.viewName}
                  className="min-w-28 flex-1 rounded border border-line px-2 py-1 text-sm text-ink outline-none focus:border-ink/40"
                />
                <select
                  value={view.type}
                  onChange={(e) =>
                    update((draft) => {
                      const target = draft.databases
                        .find((item) => item.id === database.id)
                        ?.views.find((item) => item.id === view.id);
                      if (!target) return;
                      target.type = e.target.value as DBView["type"];
                      target.groupByPropertyId =
                        target.type === "board"
                          ? database.properties.find(
                              (property) =>
                                property.type === "select" ||
                                property.type === "status",
                            )?.id
                          : undefined;
                      target.datePropertyId =
                        target.type === "calendar"
                          ? database.properties.find(
                              (property) => property.type === "date",
                            )?.id
                          : undefined;
                    })
                  }
                  className="rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft"
                >
                  {Object.keys(VIEW_ICON).map((type) => (
                    <option key={type} value={type}>
                      {dict.dbSettings.viewTypes[type as DBView["type"]]}
                    </option>
                  ))}
                </select>
                {view.type === "board" && (
                  <select
                    value={view.groupByPropertyId ?? ""}
                    onChange={(e) =>
                      update((draft) => {
                        const target = draft.databases
                          .find((item) => item.id === database.id)
                          ?.views.find((item) => item.id === view.id);
                        if (target) {
                          target.groupByPropertyId =
                            e.target.value || undefined;
                        }
                      })
                    }
                    className="rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft"
                  >
                    <option value="">{dict.dbSettings.groupBy}</option>
                    {database.properties
                      .filter(
                        (property) =>
                          property.type === "select" ||
                          property.type === "status",
                      )
                      .map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.name}
                        </option>
                      ))}
                  </select>
                )}
                {view.type === "calendar" && (
                  <select
                    value={view.datePropertyId ?? ""}
                    onChange={(e) =>
                      update((draft) => {
                        const target = draft.databases
                          .find((item) => item.id === database.id)
                          ?.views.find((item) => item.id === view.id);
                        if (target) {
                          target.datePropertyId =
                            e.target.value || undefined;
                        }
                      })
                    }
                    className="rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft"
                  >
                    <option value="">{dict.dbSettings.dateField}</option>
                    {database.properties
                      .filter((property) => property.type === "date")
                      .map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.name}
                        </option>
                      ))}
                  </select>
                )}
                <button
                  onClick={() => deleteView(view.id)}
                  disabled={database.views.length <= 1}
                  title={dict.dbSettings.deleteView}
                  className="px-1 text-ink-faint/60 transition enabled:hover:text-rose-500 disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={deleteDatabase}
          className="mt-5 text-xs font-medium text-rose-500 hover:text-rose-700"
        >
          {dict.dbSettings.deleteDatabase}
        </button>
      </div>
    </details>
  );
}

function defaultOptions(type: PropertyType, dict: Dictionary) {
  if (type === "status") {
    return [
      { id: crypto.randomUUID(), label: dict.dbSettings.defaults.statusTodo, color: "zinc" },
      { id: crypto.randomUUID(), label: dict.dbSettings.defaults.statusInProgress, color: "amber" },
      { id: crypto.randomUUID(), label: dict.dbSettings.defaults.statusDone, color: "green" },
    ];
  }
  return [
    { id: crypto.randomUUID(), label: dict.dbSettings.defaults.option1, color: "zinc" },
    { id: crypto.randomUUID(), label: dict.dbSettings.defaults.option2, color: "blue" },
  ];
}

// ---------------------------------------------------------------------------

function visibleProps(db: Database, view: DBView): DatabaseProperty[] {
  if (view.visiblePropertyIds) {
    return view.visiblePropertyIds
      .map((id) => db.properties.find((p) => p.id === id))
      .filter((p): p is DatabaseProperty => Boolean(p));
  }
  return db.properties;
}

function rowAccent(db: Database, row: DatabaseRow): string | undefined {
  const sel = db.properties.find((p) => p.type === "select");
  if (!sel) return undefined;
  const v = row.cells[sel.id];
  return getOption(sel, typeof v === "string" ? v : "")?.color;
}

// ---------------------------------------------------------------------------
// Shared row mutations used by every editable view.

function useDbActions(databaseId: string) {
  const { update } = useWorkspace();
  return {
    setCell: (rowId: string, propId: string, value: CellValue) =>
      update((d) => {
        const row = d.databases
          .find((x) => x.id === databaseId)
          ?.rows.find((r) => r.id === rowId);
        if (row) row.cells[propId] = value;
      }),
    addRow: (cells: Record<string, CellValue> = {}) => {
      const id = crypto.randomUUID();
      update((d) => {
        d.databases.find((x) => x.id === databaseId)?.rows.push({ id, cells });
      });
      return id;
    },
    deleteRow: (rowId: string) =>
      update((d) => {
        const target = d.databases.find((x) => x.id === databaseId);
        if (target) target.rows = target.rows.filter((r) => r.id !== rowId);
      }),
  };
}

// ---------------------------------------------------------------------------
// Table (editable)

function TableView({ db, view }: { db: Database; view: DBView }) {
  const { addRow, deleteRow } = useDbActions(db.id);
  const { dict } = useI18n();
  const props = visibleProps(db, view);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">
              {props.map((p) => (
                <th key={p.id} className="px-3 py-2 font-medium">
                  {p.name}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {db.rows.map((row) => (
              <tr
                key={row.id}
                className="group border-b border-line last:border-0 hover:bg-hover"
              >
                {props.map((p) => (
                  <td key={p.id} className="px-2 py-1 align-top">
                    <EditableCell
                      databaseId={db.id}
                      rowId={row.id}
                      prop={p}
                      value={row.cells[p.id] ?? null}
                    />
                  </td>
                ))}
                <td className="w-8 px-1 text-center align-middle">
                  <button
                    onClick={() => deleteRow(row.id)}
                    title={dict.db.deleteRow}
                    className="text-ink-faint/60 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={() => addRow()}
        className="w-full border-t border-line px-3 py-2 text-left text-sm text-ink-faint transition hover:bg-hover hover:text-ink-soft"
      >
        {dict.db.newRow}
      </button>
    </div>
  );
}

/**
 * Multi-value cell (multi_select and relation) rendered as wrapping colored
 * pills with an inline add-menu — replacing the native <select multiple>, which
 * browsers draw as a clipped, unstyled listbox that ignores the design. The
 * add-menu expands INLINE (full-width flex row) rather than as an absolutely
 * positioned popover, so the table's overflow-hidden can never clip it.
 */
function ChipMultiSelect({
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
  const [open, setOpen] = useState(false);
  const byId = new Map(items.map((i) => [i.id, i]));
  const chosen = selected.filter((id) => byId.has(id));
  const available = items.filter((i) => !selected.includes(i.id));
  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );

  return (
    <div className="flex flex-wrap items-center gap-1 py-0.5" role="group" aria-label={label}>
      {chosen.map((id) => {
        const item = byId.get(id)!;
        return (
          <span
            key={id}
            className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${pillClasses(item.color)}`}
          >
            <span className="truncate">{item.label}</span>
            <button
              type="button"
              onClick={() => toggle(id)}
              aria-label={`Remove ${item.label}`}
              className="shrink-0 opacity-60 transition hover:opacity-100"
            >
              ✕
            </button>
          </span>
        );
      })}
      {available.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-full border border-dashed border-line-strong px-2 py-0.5 text-xs text-ink-faint transition hover:border-ink/40 hover:text-ink"
        >
          {open ? "×" : `+ ${addLabel}`}
        </button>
      )}
      {open && available.length > 0 && (
        <div className="mt-1 flex w-full flex-wrap gap-1">
          {available.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => toggle(item.id)}
              className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset transition hover:brightness-110 ${pillClasses(item.color)}`}
            >
              <span aria-hidden>+</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Single-choice cell (select and status) rendered as one colored pill with an
 * inline choose-menu — consistent with ChipMultiSelect and matching the pill
 * styling used in the board/calendar views (the native <select> showed neither
 * the option colors nor the design). Inline menu (not a popover) so the table's
 * overflow can't clip it.
 */
function SingleSelectCell({
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
        className="max-w-full rounded-full text-left"
      >
        {current ? (
          <span
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
              className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs ring-1 ring-inset transition hover:brightness-110 ${pillClasses(o.color)} ${o.id === value ? "outline outline-1 outline-ink/40" : ""}`}
            >
              <span className="truncate">{o.label}</span>
            </button>
          ))}
          {value !== null && (
            <button
              type="button"
              onClick={() => choose(null)}
              className="rounded-full border border-dashed border-line-strong px-2 py-0.5 text-xs text-ink-faint transition hover:text-ink"
            >
              {emptyLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EditableCell({
  databaseId,
  rowId,
  prop,
  value,
}: {
  databaseId: string;
  rowId: string;
  prop: DatabaseProperty;
  value: CellValue;
}) {
  const { workspace, update, rev } = useWorkspace();
  const { dict } = useI18n();

  const setCell = (v: CellValue) =>
    update((d) => {
      const row = d.databases
        .find((x) => x.id === databaseId)
        ?.rows.find((r) => r.id === rowId);
      if (row) row.cells[prop.id] = v;
    });

  const base =
    "w-full rounded bg-transparent px-1 py-0.5 outline-none focus:bg-card focus:ring-1 focus:ring-ink/20";

  // Remount uncontrolled cells onto AI-supplied values after an AI edit; manual
  // typing leaves `rev` unchanged, so the caret stays put. (See WorkspaceCtx.rev.)
  const k = `${rowId}:${prop.id}:${rev}`;

  switch (prop.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => setCell(e.target.checked)}
          className="h-4 w-4 rounded border-line-strong text-lime"
        />
      );
    case "number":
      return (
        <input
          key={k}
          type="number"
          defaultValue={value === null || value === undefined ? "" : String(value)}
          onBlur={(e) => setCell(e.target.value === "" ? null : Number(e.target.value))}
          className={`${base} tabular-nums text-ink`}
        />
      );
    case "date":
      return (
        <input
          key={k}
          type="date"
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(e) => setCell(e.target.value || null)}
          className={`${base} text-ink-soft`}
        />
      );
    case "url":
      return (
        <input
          key={k}
          type="url"
          placeholder={dict.db.empty}
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(e) => setCell(e.target.value || null)}
          className={`${base} text-lime`}
        />
      );
    case "select":
    case "status":
      return (
        <SingleSelectCell
          label={prop.name}
          options={prop.options ?? []}
          value={typeof value === "string" ? value : null}
          onChange={setCell}
          emptyLabel={dict.db.empty}
        />
      );
    case "multi_select": {
      const selected = Array.isArray(value) ? value : [];
      const items = (prop.options ?? []).map((o) => ({
        id: o.id,
        label: o.label,
        color: o.color,
      }));
      return (
        <ChipMultiSelect
          label={prop.name}
          items={items}
          selected={selected}
          onChange={setCell}
          addLabel={dict.db.addTag}
        />
      );
    }
    case "relation": {
      const selected = Array.isArray(value) ? value : [];
      const related = workspace.databases.find(
        (database) => database.id === prop.relationDatabaseId,
      );
      const relatedTitle = related ? titleProperty(related) : null;
      const items = (related?.rows ?? []).map((row) => ({
        id: row.id,
        label: relatedTitle
          ? String(row.cells[relatedTitle.id] ?? dict.db.untitled)
          : row.id,
      }));
      return (
        <ChipMultiSelect
          label={prop.name}
          items={items}
          selected={selected}
          onChange={setCell}
          addLabel={dict.db.addLink}
        />
      );
    }
    case "text":
    default:
      return (
        <input
          key={k}
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(e) => setCell(e.target.value)}
          className={`${base} text-ink`}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Board (editable: inline fields, drag a card to another column, add, delete)

function BoardView({ db, view }: { db: Database; view: DBView }) {
  const { rev } = useWorkspace();
  const { dict } = useI18n();
  const { setCell, addRow, deleteRow } = useDbActions(db.id);
  const [overOpt, setOverOpt] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  const groupProp = db.properties.find((p) => p.id === view.groupByPropertyId);
  if (!groupProp?.options) return <TableView db={db} view={view} />;

  const title = titleProperty(db);
  const fieldProps = visibleProps(db, view).filter(
    (p) => p.id !== groupProp.id && p.id !== title.id,
  );

  const dropInto = (optId: string) => {
    if (dragId.current) setCell(dragId.current, groupProp.id, optId);
    dragId.current = null;
    setOverOpt(null);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {groupProp.options.map((opt) => {
        const rows = db.rows.filter((r) => r.cells[groupProp.id] === opt.id);
        const isOver = overOpt === opt.id;
        return (
          <div
            key={opt.id}
            onDragOver={(e) => {
              e.preventDefault();
              if (overOpt !== opt.id) setOverOpt(opt.id);
            }}
            onDragLeave={() => setOverOpt((o) => (o === opt.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              dropInto(opt.id);
            }}
            className={`w-64 shrink-0 rounded-md p-1 transition ${
              isOver ? "bg-lime/10 ring-2 ring-lime/40" : ""
            }`}
          >
            <div className="mb-2 flex items-center gap-2 px-1">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${pillClasses(opt.color)}`}
              >
                {opt.label}
              </span>
              <span className="text-xs text-ink-faint">{rows.length}</span>
            </div>
            <div className="space-y-2">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="group rounded-md border border-line bg-card p-3 shadow-sm"
                >
                  <div className="mb-2 flex items-start gap-1">
                    <span
                      draggable
                      onDragStart={(e) => {
                        dragId.current = r.id;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", r.id);
                      }}
                      onDragEnd={() => {
                        dragId.current = null;
                        setOverOpt(null);
                      }}
                      title={dict.db.dragHint}
                      className="mt-1 cursor-grab select-none leading-none text-ink-faint/60 transition hover:text-ink-soft active:cursor-grabbing"
                    >
                      ⠿
                    </span>
                    <input
                      key={`${r.id}:${rev}`}
                      defaultValue={String(r.cells[title.id] ?? "")}
                      onBlur={(e) => setCell(r.id, title.id, e.target.value)}
                      placeholder={dict.db.untitled}
                      className="min-w-0 flex-1 rounded bg-transparent text-sm font-medium text-ink outline-none focus:bg-hover"
                    />
                    <button
                      onClick={() => deleteRow(r.id)}
                      title={dict.db.deleteCard}
                      className="text-ink-faint/60 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                  {fieldProps.length > 0 && (
                    <div className="space-y-1.5 pl-5">
                      {fieldProps.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="w-16 shrink-0 truncate text-ink-faint">
                            {p.name}
                          </span>
                          <div className="min-w-0 flex-1">
                            <EditableCell
                              databaseId={db.id}
                              rowId={r.id}
                              prop={p}
                              value={r.cells[p.id] ?? null}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={() => addRow({ [groupProp.id]: opt.id })}
                className="w-full rounded-md border border-dashed border-line px-3 py-2 text-left text-xs text-ink-faint transition hover:border-line-strong hover:text-ink-soft"
              >
                {dict.db.newCard}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar (editable: click a day to add, click an event to rename, drag to
// reschedule, ✕ to delete)

function CalendarView({ db, view }: { db: Database; view: DBView }) {
  const { rev } = useWorkspace();
  const { dict, locale } = useI18n();
  const { setCell, addRow, deleteRow } = useDbActions(db.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  const dateProp = db.properties.find((p) => p.id === view.datePropertyId);
  const title = titleProperty(db);

  const dated = dateProp
    ? db.rows.filter((r) => typeof r.cells[dateProp.id] === "string")
    : [];
  const earliest = [...dated]
    .map((r) => String(r.cells[dateProp!.id]))
    .sort()[0];
  const [iy, im] = (earliest ?? "2026-06-01").split("-").map(Number);
  const [cursor, setCursor] = useState({ year: iy, month: im - 1 });

  if (!dateProp) return <TableView db={db} view={view} />;

  const startWeekday = new Date(
    Date.UTC(cursor.year, cursor.month, 1),
  ).getUTCDay();
  const daysInMonth = new Date(
    Date.UTC(cursor.year, cursor.month + 1, 0),
  ).getUTCDate();

  const pad = (n: number) => String(n).padStart(2, "0");
  const dayKey = (day: number) =>
    `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`;

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsOn = (day: number) =>
    dated.filter((r) => r.cells[dateProp.id] === dayKey(day));

  const addOn = (day: number) =>
    setEditingId(addRow({ [dateProp.id]: dayKey(day), [title.id]: "" }));

  const move = (delta: number) => {
    const total = cursor.month + delta;
    setCursor({
      year: cursor.year + Math.floor(total / 12),
      month: ((total % 12) + 12) % 12,
    });
  };

  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    weekdayFmt.format(new Date(Date.UTC(2024, 0, 7 + i))),
  );

  return (
    <div className="rounded-md border border-line bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-display text-[15px] font-bold text-ink">
          {new Intl.DateTimeFormat(locale, { month: "long" }).format(
            new Date(Date.UTC(cursor.year, cursor.month, 1)),
          )}{" "}
          {cursor.year}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => move(-1)}
            className="rounded px-2 py-1 text-sm text-ink-soft hover:bg-hover"
            aria-label={dict.db.prevMonth}
          >
            ‹
          </button>
          <button
            onClick={() => move(1)}
            className="rounded px-2 py-1 text-sm text-ink-soft hover:bg-hover"
            aria-label={dict.db.nextMonth}
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-line bg-surface text-center font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">
        {weekdays.map((w) => (
          <div key={w} className="py-1.5">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const key = day ? dayKey(day) : null;
          const isOver = key !== null && overKey === key;
          return (
            <div
              key={i}
              onDragOver={
                day
                  ? (e) => {
                      e.preventDefault();
                      if (overKey !== key) setOverKey(key);
                    }
                  : undefined
              }
              onDragLeave={
                day ? () => setOverKey((k) => (k === key ? null : k)) : undefined
              }
              onDrop={
                day
                  ? (e) => {
                      e.preventDefault();
                      if (dragId.current && key)
                        setCell(dragId.current, dateProp.id, key);
                      dragId.current = null;
                      setOverKey(null);
                    }
                  : undefined
              }
              className={`group/cell min-h-[92px] border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0 ${
                isOver ? "bg-lime/10" : ""
              }`}
            >
              {day && (
                <>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-ink-faint">{day}</span>
                    <button
                      onClick={() => addOn(day)}
                      title={dict.db.addOnDay}
                      className="text-sm leading-none text-ink-faint/60 opacity-0 transition hover:text-ink group-hover/cell:opacity-100"
                    >
                      +
                    </button>
                  </div>
                  <div className="space-y-1">
                    {eventsOn(day).map((r) =>
                      editingId === r.id ? (
                        <input
                          key={`${r.id}:${rev}`}
                          autoFocus
                          defaultValue={String(r.cells[title.id] ?? "")}
                          onBlur={(e) => {
                            setCell(r.id, title.id, e.target.value);
                            setEditingId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          placeholder={dict.db.untitled}
                          className="w-full rounded px-1.5 py-0.5 text-[11px] font-medium text-ink outline-none ring-1 ring-ink/20"
                        />
                      ) : (
                        <div
                          key={r.id}
                          draggable
                          onDragStart={(e) => {
                            dragId.current = r.id;
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", r.id);
                          }}
                          onDragEnd={() => {
                            dragId.current = null;
                            setOverKey(null);
                          }}
                          className={`group/ev flex cursor-grab items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset active:cursor-grabbing ${pillClasses(rowAccent(db, r))}`}
                        >
                          <button
                            onClick={() => setEditingId(r.id)}
                            title={dict.db.clickToRename}
                            className="min-w-0 flex-1 truncate text-left"
                          >
                            {String(r.cells[title.id] ?? "") || dict.db.untitled}
                          </button>
                          <button
                            onClick={() => deleteRow(r.id)}
                            title={dict.db.delete}
                            className="shrink-0 opacity-0 transition hover:text-rose-600 group-hover/ev:opacity-100"
                          >
                            ✕
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
