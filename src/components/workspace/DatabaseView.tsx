"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Columns3, LayoutGrid, List, Table2 } from "lucide-react";
import type { CellValue, Database, DatabaseView as DBView } from "@/lib/workspace/types";
import { applyView, newRowCells } from "@/lib/workspace/view-logic";
import { useI18n } from "@/lib/i18n/client";
import { useWorkspace } from "./WorkspaceContext";
import { revealElement, useDeepLink } from "./DeepLinkContext";
import { useDbActions } from "./database/actions";
import { BoardView } from "./database/BoardView";
import { CalendarView } from "./database/CalendarView";
import { GalleryView } from "./database/GalleryView";
import { ListView } from "./database/ListView";
import type { ViewBodyProps } from "./database/parts";
import { RowDetail } from "./database/RowDetail";
import { DatabaseSettings } from "./database/Settings";
import { relationLabeler, useToday, visibleProps } from "./database/shared";
import { TableView } from "./database/TableView";
import { ViewToolbar } from "./database/Toolbar";
import { useNarrowScreen } from "./useMediaQuery";
import { DraftInput } from "./editor/DraftInput";

const VIEW_ICON: Record<DBView["type"], typeof Table2> = {
  table: Table2,
  board: Columns3,
  calendar: CalendarDays,
  list: List,
  gallery: LayoutGrid,
};

const TABLE_CHOICE_KEY = "studyos:table-on-phone:";

function readTableChoice(viewId: string): boolean {
  try {
    return window.localStorage.getItem(TABLE_CHOICE_KEY + viewId) === "1";
  } catch {
    return false;
  }
}

function writeTableChoice(viewId: string, table: boolean) {
  try {
    if (table) window.localStorage.setItem(TABLE_CHOICE_KEY + viewId, "1");
    else window.localStorage.removeItem(TABLE_CHOICE_KEY + viewId);
  } catch {
    // Private mode: the choice lasts until the page is reloaded.
  }
}

/**
 * A database embedded in a page: view tabs, a search / filter / sort / fields
 * toolbar, the active view (table, board, calendar, list or gallery) and a
 * row detail sheet. Sort and filter rules live in lib/workspace/view-logic.
 */
export function DatabaseView({
  databaseId,
  viewId,
  pageId,
}: {
  databaseId: string;
  viewId: string;
  /** The page the view sits on: a database named like its title shows no name label. */
  pageId?: string;
}) {
  const { workspace } = useWorkspace();
  const database = workspace.databases.find((d) => d.id === databaseId);
  if (!database || database.views.length === 0) return null;
  const pageTitle = pageId ? workspace.pages.find((p) => p.id === pageId)?.title : undefined;
  const repeatsTitle = pageTitle !== undefined && sameName(database.name, pageTitle);
  return <DatabaseBody database={database} initialViewId={viewId} showName={!repeatsTitle} />;
}

/** Names compared the way a reader sees them: case, spacing and emoji aside. */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .normalize("NFKC")
      .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
  const left = norm(a);
  return left !== "" && left === norm(b);
}

function DatabaseBody({
  database,
  initialViewId,
  showName,
}: {
  database: Database;
  initialViewId: string;
  showName: boolean;
}) {
  const { workspace } = useWorkspace();
  const { dict } = useI18n();
  const actions = useDbActions(database.id);
  const today = useToday();
  const [activeViewId, setActiveViewId] = useState(initialViewId);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [editingName, setEditingName] = useState(false);

  // A deep link (?db=&row=) to one of this database's rows: bring the
  // database into view and open the row's detail sheet.
  const { focus: linkFocus, claim: claimLink } = useDeepLink();
  useEffect(() => {
    if (linkFocus?.kind !== "row" || linkFocus.databaseId !== database.id) return;
    if (!database.rows.some((r) => r.id === linkFocus.rowId) || !claimLink(linkFocus.seq)) return;
    if (sectionRef.current) revealElement(sectionRef.current);
    // Open the sheet once the scroll has started (claimed: must not be lost).
    const rowId = linkFocus.rowId;
    window.setTimeout(() => setOpenRowId(rowId), 0);
  }, [claimLink, database.id, database.rows, linkFocus]);
  // Rows added here stay visible even if they don't match the filters yet.
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set());

  const view = database.views.find((v) => v.id === activeViewId) ?? database.views[0];

  // On a phone a table with more than a couple of columns is unreadable, so
  // a table view shows as a list there, unless the student asked for the
  // table on this device (remembered per view).
  const narrow = useNarrowScreen();
  const [tableChoice, setTableChoice] = useState<Record<string, boolean>>({});
  const tableChosen = tableChoice[view.id] ?? readTableChoice(view.id);
  const chooseLayout = (table: boolean) => {
    setTableChoice((prev) => ({ ...prev, [view.id]: table }));
    writeTableChoice(view.id, table);
  };
  const phoneList = narrow && view.type === "table" && visibleProps(database, view).length > 2;
  const showAsList = phoneList && !tableChosen;
  const labeler = useMemo(() => relationLabeler(workspace, dict.db.untitled), [workspace, dict.db.untitled]);

  const rows = useMemo(() => {
    if (!today) return database.rows;
    const result = applyView(database, view, { today, search: deferredSearch, relationLabel: labeler });
    if (pinned.size === 0) return result;
    const shown = new Set(result.map((r) => r.id));
    return [...result, ...database.rows.filter((r) => pinned.has(r.id) && !shown.has(r.id))];
  }, [database, view, today, deferredSearch, labeler, pinned]);

  const onAdd = useCallback(
    (cells: Record<string, CellValue> = {}) => {
      const id = actions.addRow({ ...(today ? newRowCells(database, view, today) : {}), ...cells });
      setPinned((prev) => new Set(prev).add(id));
      return id;
    },
    [actions, database, view, today],
  );

  const switchView = (id: string) => {
    setActiveViewId(id);
    setPinned(new Set());
  };

  const createView = (next: DBView) => {
    // A preset view that already exists (same name, layout, filters and
    // sorts) is opened rather than duplicated.
    const same = (v: DBView) =>
      v.name === next.name &&
      v.type === next.type &&
      JSON.stringify(v.filters ?? []) === JSON.stringify(next.filters ?? []) &&
      JSON.stringify(v.sorts ?? []) === JSON.stringify(next.sorts ?? []);
    const existing = database.views.find(same);
    if (existing) {
      switchView(existing.id);
      return;
    }
    actions.withDb((db) => {
      db.views.push(next);
    });
    switchView(next.id);
  };

  const filtered = (view.filters?.length ?? 0) > 0 || deferredSearch.trim() !== "";
  const empty = (
    <div className="px-4 py-8 text-center text-sm text-ink-faint">
      {database.rows.length === 0 ? (
        dict.dbViews.emptyDatabase
      ) : (
        <>
          <p>{dict.dbViews.noResults}</p>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                actions.updateView(view.id, (v) => {
                  v.filters = undefined;
                  v.filterMatch = undefined;
                });
              }}
              className="mt-2 min-h-9 rounded-md border border-line px-3 text-sm text-ink-soft hover:bg-hover hover:text-ink"
            >
              {dict.dbViews.clearFilters}
            </button>
          )}
        </>
      )}
    </div>
  );

  const body: ViewBodyProps = {
    db: database,
    view,
    rows,
    actions,
    onOpen: setOpenRowId,
    onAdd,
    empty,
  };

  return (
    <section ref={sectionRef} className="my-4 min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 border-b border-line">
        {/* Shown unless it would repeat the page title right above (then it
            can still be renamed under "Customize fields & views"). */}
        {(showName || editingName) && (
          <div
            className="flex min-w-0 items-center gap-1.5 pb-2 text-sm font-medium text-ink-soft"
            // Typing a name equal to the title must not pull the field away.
            onFocus={() => setEditingName(true)}
            onBlur={() => setEditingName(false)}
          >
            <DraftInput
              value={database.icon ?? ""}
              onCommit={(value) =>
                actions.withDb((db) => {
                  db.icon = value;
                })
              }
              aria-label={dict.db.databaseIcon}
              maxLength={8}
              className="h-8 w-8 rounded bg-transparent text-center outline-none hover:bg-hover focus:bg-card focus:ring-1 focus:ring-ink/20"
            />
            <DraftInput
              value={database.name}
              onCommit={(value) =>
                actions.withDb((db) => {
                  db.name = value;
                })
              }
              dir="auto"
              aria-label={dict.db.nameAria}
              className="h-8 w-40 min-w-0 rounded bg-transparent px-1 text-sm font-medium text-ink-soft outline-none hover:bg-hover focus:bg-card focus:ring-1 focus:ring-ink/20"
            />
          </div>
        )}
        <div className="-mb-px flex min-w-0 max-w-full items-center gap-0.5 overflow-x-auto" role="group" aria-label={dict.dbSettings.views}>
          {database.views.map((v) => {
            const Icon = VIEW_ICON[v.type] ?? Table2;
            const active = v.id === view.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => switchView(v.id)}
                aria-pressed={active}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 border-b-2 px-2 pb-2 pt-1 text-sm transition ${
                  active ? "border-lime font-medium text-ink" : "border-transparent text-ink-faint hover:text-ink-soft"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <bdi>{v.name}</bdi>
              </button>
            );
          })}
        </div>
      </div>

      <ViewToolbar
        db={database}
        view={view}
        actions={actions}
        search={search}
        onSearch={setSearch}
        onCreateView={createView}
      />

      <DatabaseSettings database={database} activeViewId={view.id} setActiveViewId={switchView} />

      {phoneList && today && (
        <div data-print="hide" className="mb-2 flex items-center justify-between gap-2 text-xs text-ink-faint">
          <span>{showAsList ? dict.dbViews.shownAsList : null}</span>
          <button
            type="button"
            onClick={() => chooseLayout(showAsList)}
            className="min-h-9 shrink-0 rounded-md px-2 text-xs font-medium text-ink-soft hover:bg-hover hover:text-ink"
          >
            {showAsList ? dict.dbViews.showAsTable : dict.dbViews.showAsList}
          </button>
        </div>
      )}

      {!today ? (
        <div className="min-h-32 rounded-md border border-line bg-card" aria-busy />
      ) : showAsList ? (
        <ListView {...body} />
      ) : view.type === "board" ? (
        <BoardView {...body} />
      ) : view.type === "calendar" ? (
        <CalendarView {...body} />
      ) : view.type === "list" ? (
        <ListView {...body} />
      ) : view.type === "gallery" ? (
        <GalleryView {...body} />
      ) : (
        <TableView {...body} />
      )}

      {openRowId && (
        <RowDetail db={database} view={view} rowId={openRowId} actions={actions} onClose={() => setOpenRowId(null)} />
      )}
    </section>
  );
}
