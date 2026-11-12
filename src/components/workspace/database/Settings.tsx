"use client";

import { X } from "lucide-react";
import type {
  CellValue,
  Database,
  DatabaseView as DBView,
  PropertyType,
} from "@/lib/workspace/types";
import { convertProperty } from "@/lib/workspace/column-convert";
import { FILTER_OPERATORS } from "@/lib/workspace/view-logic";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { useWorkspace } from "../WorkspaceContext";
import { useDbActions } from "./actions";
import { PROPERTY_TYPES, VIEW_TYPES } from "./shared";

const SMALL_ICON_BUTTON =
  "grid h-8 w-8 shrink-0 place-items-center rounded text-ink-faint transition enabled:hover:bg-hover enabled:hover:text-rose-500 disabled:opacity-30";

function hasValue(value: CellValue | undefined): boolean {
  return !(value === null || value === undefined || value === "" || value === false || (Array.isArray(value) && value.length === 0));
}

export function defaultOptions(type: PropertyType, dict: Dictionary) {
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

/** The "Customize fields & views" panel. */
export function DatabaseSettings({
  database,
  activeViewId,
  setActiveViewId,
}: {
  database: Database;
  activeViewId: string;
  setActiveViewId: (id: string) => void;
}) {
  const { workspace, update } = useWorkspace();
  const { dict, t, plural } = useI18n();
  const { withDb, updateView } = useDbActions(database.id);

  const addProperty = () => {
    const id = crypto.randomUUID();
    withDb((target) => {
      target.properties.push({ id, name: dict.dbSettings.newField, type: "text" });
      // Views with an explicit column list would otherwise hide the new field.
      for (const view of target.views) view.visiblePropertyIds?.push(id);
    });
  };

  const deleteProperty = (propertyId: string) => {
    if (database.properties.length <= 1) return;
    const property = database.properties.find((p) => p.id === propertyId);
    const filled = database.rows.filter((row) => hasValue(row.cells[propertyId])).length;
    if (
      filled > 0 &&
      !window.confirm(plural(dict.counts.deleteFieldConfirm, filled, { name: property?.name ?? "" }))
    ) {
      return;
    }
    withDb((target) => {
      target.properties = target.properties.filter((p) => p.id !== propertyId);
      for (const row of target.rows) delete row.cells[propertyId];
      for (const view of target.views) {
        if (view.groupByPropertyId === propertyId) view.groupByPropertyId = undefined;
        if (view.datePropertyId === propertyId) view.datePropertyId = undefined;
        view.visiblePropertyIds = view.visiblePropertyIds?.filter((id) => id !== propertyId);
        if (view.visiblePropertyIds?.length === 0) view.visiblePropertyIds = undefined;
        view.sorts = view.sorts?.filter((s) => s.propertyId !== propertyId);
        view.filters = view.filters?.filter((f) => f.propertyId !== propertyId);
      }
    });
  };

  const changePropertyType = (propertyId: string, type: PropertyType) => {
    const property = database.properties.find((p) => p.id === propertyId);
    if (!property || property.type === type) return;
    const relationDatabaseId = workspace.databases.find((d) => d.id !== database.id)?.id;
    const result = convertProperty(database, propertyId, type, {
      defaultOptions: (optionType) => defaultOptions(optionType, dict),
      newId: () => crypto.randomUUID(),
      relationDatabaseId,
    });
    if (
      result.lost > 0 &&
      !window.confirm(
        plural(dict.counts.convertConfirm, result.lost, {
          name: property.name,
          type: dict.dbSettings.propertyTypes[type],
        }),
      )
    ) {
      return;
    }
    withDb((target) => {
      const index = target.properties.findIndex((p) => p.id === propertyId);
      if (index === -1) return;
      target.properties[index] = result.property;
      for (const row of target.rows) {
        if (row.id in result.cells) row.cells[propertyId] = result.cells[row.id];
      }
      for (const view of target.views) {
        if (view.groupByPropertyId === propertyId && type !== "select" && type !== "status") {
          view.groupByPropertyId = undefined;
        }
        if (view.datePropertyId === propertyId && type !== "date") view.datePropertyId = undefined;
        // Keep only filters whose condition still fits the new type.
        view.filters = view.filters?.filter(
          (f) => f.propertyId !== propertyId || FILTER_OPERATORS[type].includes(f.operator),
        );
      }
    });
  };

  const optionUpdate = (propertyId: string, fn: (options: NonNullable<Database["properties"][number]["options"]>) => void) =>
    withDb((target) => {
      const property = target.properties.find((p) => p.id === propertyId);
      if (property?.options) fn(property.options);
    });

  const deleteOption = (propertyId: string, optionId: string) =>
    withDb((target) => {
      const property = target.properties.find((item) => item.id === propertyId);
      if (!property) return;
      property.options = property.options?.filter((option) => option.id !== optionId);
      for (const row of target.rows) {
        const value = row.cells[propertyId];
        if (Array.isArray(value)) row.cells[propertyId] = value.filter((id) => id !== optionId);
        else if (value === optionId) row.cells[propertyId] = null;
      }
    });

  const addView = () => {
    const id = crypto.randomUUID();
    withDb((target) => {
      target.views.push({ id, name: dict.dbSettings.newView, type: "table" });
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
          if (block.type === "database_view" && block.databaseId === database.id && block.viewId === viewId) {
            block.viewId = replacement.id;
          }
        }
      }
    });
    if (activeViewId === viewId) setActiveViewId(replacement.id);
  };

  const deleteDatabase = () => {
    if (!window.confirm(t(dict.dbSettings.deleteConfirm, { name: database.name }))) return;
    update((draft) => {
      draft.databases = draft.databases.filter((item) => item.id !== database.id);
      for (const page of draft.pages) {
        page.blocks = page.blocks.filter(
          (block) => block.type !== "database_view" || block.databaseId !== database.id,
        );
      }
    });
  };

  const changeViewType = (view: DBView, type: DBView["type"]) =>
    updateView(view.id, (target, db) => {
      target.type = type;
      const validDate = db.properties.some((p) => p.id === target.datePropertyId && p.type === "date");
      const validGroup = db.properties.some(
        (p) => p.id === target.groupByPropertyId && (p.type === "select" || p.type === "status"),
      );
      target.groupByPropertyId =
        type === "board"
          ? validGroup
            ? target.groupByPropertyId
            : db.properties.find((p) => p.type === "status" || p.type === "select")?.id
          : undefined;
      target.datePropertyId =
        type === "calendar" || type === "list" || type === "gallery"
          ? validDate
            ? target.datePropertyId
            : type === "calendar"
              ? db.properties.find((p) => p.type === "date")?.id
              : undefined
          : undefined;
    });

  const fieldInput =
    "rounded border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-ink/40";
  const smallSelect = "min-h-8 rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft";

  return (
    <details data-print="hide" className="mb-3 rounded-md border border-line bg-surface">
      <summary className="min-h-9 cursor-pointer select-none px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-soft hover:text-ink">
        {dict.dbSettings.customize}
      </summary>
      <div className="border-t border-line p-3">
        {/* Also here: the label above the views hides when it repeats the page title. */}
        <label className="mb-3 block text-xs font-medium text-ink-soft">
          {dict.db.nameAria}
          <input
            value={database.name}
            onChange={(e) =>
              withDb((target) => {
                target.name = e.target.value;
              })
            }
            dir="auto"
            className={`mt-1 w-full font-normal ${fieldInput}`}
          />
        </label>
        <label className="block text-xs font-medium text-ink-soft">
          {dict.dbSettings.description}
          <input
            value={database.description ?? ""}
            onChange={(e) =>
              withDb((target) => {
                target.description = e.target.value;
              })
            }
            placeholder={dict.dbSettings.descriptionPlaceholder}
            className={`mt-1 w-full font-normal ${fieldInput}`}
          />
        </label>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
              {dict.dbSettings.fields}
            </span>
            <button onClick={addProperty} className="min-h-8 px-1 text-xs font-medium text-ink-soft hover:text-ink">
              {dict.dbSettings.addField}
            </button>
          </div>
          <div className="space-y-2">
            {database.properties.map((property) => (
              <div key={property.id} className="rounded border border-line bg-card p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={property.name}
                    onChange={(e) =>
                      withDb((target) => {
                        const p = target.properties.find((item) => item.id === property.id);
                        if (p) p.name = e.target.value;
                      })
                    }
                    dir="auto"
                    aria-label={dict.dbSettings.fieldName}
                    className={`min-w-32 flex-1 ${fieldInput}`}
                  />
                  <select
                    value={property.type}
                    onChange={(e) => changePropertyType(property.id, e.target.value as PropertyType)}
                    aria-label={dict.dbSettings.fieldType}
                    className={smallSelect}
                  >
                    {PROPERTY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {dict.dbSettings.propertyTypes[type]}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => deleteProperty(property.id)}
                    disabled={database.properties.length <= 1}
                    aria-label={`${dict.dbSettings.deleteField}: ${property.name}`}
                    title={dict.dbSettings.deleteField}
                    className={SMALL_ICON_BUTTON}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                {property.type === "relation" && (
                  <select
                    value={property.relationDatabaseId ?? ""}
                    onChange={(e) =>
                      withDb((target) => {
                        const p = target.properties.find((item) => item.id === property.id);
                        if (p) p.relationDatabaseId = e.target.value || undefined;
                      })
                    }
                    aria-label={dict.dbSettings.chooseRelatedDatabase}
                    className={`mt-2 w-full ${smallSelect}`}
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

                {(property.type === "select" || property.type === "multi_select" || property.type === "status") && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {property.options?.map((option) => (
                      <span
                        key={option.id}
                        className="flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 ps-2"
                      >
                        <input
                          value={option.label}
                          onChange={(e) =>
                            optionUpdate(property.id, (options) => {
                              const o = options.find((item) => item.id === option.id);
                              if (o) o.label = e.target.value;
                            })
                          }
                          dir="auto"
                          aria-label={dict.dbSettings.optionLabel}
                          className="w-24 bg-transparent text-xs text-ink-soft outline-none"
                        />
                        <button
                          onClick={() => deleteOption(property.id, option.id)}
                          aria-label={t(dict.dbViews.removeOption, { name: option.label })}
                          className="grid h-7 w-7 place-items-center rounded-full text-ink-faint/80 hover:text-rose-500"
                        >
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() =>
                        optionUpdate(property.id, (options) => {
                          options.push({ id: crypto.randomUUID(), label: dict.dbSettings.newOption, color: "zinc" });
                        })
                      }
                      className="min-h-8 rounded-full border border-dashed border-line-strong px-2 py-1 text-xs text-ink-faint hover:text-ink"
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
            <button onClick={addView} className="min-h-8 px-1 text-xs font-medium text-ink-soft hover:text-ink">
              {dict.dbSettings.addView}
            </button>
          </div>
          <div className="space-y-2">
            {database.views.map((view) => (
              <div key={view.id} className="flex flex-wrap items-center gap-2 rounded border border-line bg-card p-2">
                <input
                  value={view.name}
                  onFocus={() => setActiveViewId(view.id)}
                  onChange={(e) =>
                    updateView(view.id, (target) => {
                      target.name = e.target.value;
                    })
                  }
                  dir="auto"
                  aria-label={dict.dbSettings.viewName}
                  className={`min-w-28 flex-1 ${fieldInput}`}
                />
                <select
                  value={view.type}
                  onChange={(e) => changeViewType(view, e.target.value as DBView["type"])}
                  aria-label={dict.dbViews.viewType}
                  className={smallSelect}
                >
                  {VIEW_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {dict.dbSettings.viewTypes[type]}
                    </option>
                  ))}
                </select>
                {view.type === "board" && (
                  <select
                    value={view.groupByPropertyId ?? ""}
                    onChange={(e) =>
                      updateView(view.id, (target) => {
                        target.groupByPropertyId = e.target.value || undefined;
                      })
                    }
                    aria-label={dict.dbSettings.groupBy}
                    className={smallSelect}
                  >
                    <option value="">{dict.dbSettings.groupBy}</option>
                    {database.properties
                      .filter((p) => p.type === "select" || p.type === "status")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                )}
                {(view.type === "calendar" || view.type === "list" || view.type === "gallery") && (
                  <select
                    value={view.datePropertyId ?? ""}
                    onChange={(e) =>
                      updateView(view.id, (target) => {
                        target.datePropertyId = e.target.value || undefined;
                      })
                    }
                    aria-label={dict.dbSettings.dateField}
                    className={smallSelect}
                  >
                    <option value="">{dict.dbSettings.dateField}</option>
                    {database.properties
                      .filter((p) => p.type === "date")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                )}
                <button
                  onClick={() => deleteView(view.id)}
                  disabled={database.views.length <= 1}
                  aria-label={`${dict.dbSettings.deleteView}: ${view.name}`}
                  title={dict.dbSettings.deleteView}
                  className={SMALL_ICON_BUTTON}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </div>

        <button onClick={deleteDatabase} className="mt-5 min-h-8 text-xs font-medium text-rose-500 hover:text-rose-700">
          {dict.dbSettings.deleteDatabase}
        </button>
      </div>
    </details>
  );
}
