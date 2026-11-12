"use client";

import { useMemo } from "react";
import type {
  CellValue,
  Database,
  DatabaseView as DBView,
  Workspace,
} from "@/lib/workspace/types";
import { useWorkspace } from "../WorkspaceContext";

/**
 * Every database edit goes through the workspace `update()` (so autosave and
 * the workspace-level undo history see it). These helpers just find the
 * database / row / view inside the draft.
 */
export function useDbActions(databaseId: string) {
  const { update } = useWorkspace();
  return useMemo(() => {
    const withDb = (fn: (db: Database, draft: Workspace) => void) =>
      update((draft) => {
        const db = draft.databases.find((x) => x.id === databaseId);
        if (db) fn(db, draft);
      });
    return {
      withDb,
      setCell: (rowId: string, propId: string, value: CellValue) =>
        withDb((db) => {
          const row = db.rows.find((r) => r.id === rowId);
          if (row) row.cells[propId] = value;
        }),
      addRow: (cells: Record<string, CellValue> = {}) => {
        const id = crypto.randomUUID();
        withDb((db) => {
          db.rows.push({ id, cells });
        });
        return id;
      },
      deleteRow: (rowId: string) =>
        withDb((db) => {
          db.rows = db.rows.filter((r) => r.id !== rowId);
        }),
      updateView: (viewId: string, fn: (view: DBView, db: Database) => void) =>
        withDb((db) => {
          const view = db.views.find((v) => v.id === viewId);
          if (view) fn(view, db);
        }),
    };
  }, [update, databaseId]);
}

export type DbActions = ReturnType<typeof useDbActions>;
