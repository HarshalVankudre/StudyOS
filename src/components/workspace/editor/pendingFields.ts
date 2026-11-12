"use client";

import { createContext, useContext } from "react";
import type { PendingField } from "../workspace-sync";

export type { PendingField };

export interface FieldSync {
  /**
   * How a text field that buffers typing (it writes to the workspace after a
   * pause, not per keystroke) tells the editor's sync engine about it. The
   * engine then writes that typing first whenever it matters: before the tab
   * is hidden or closed, before undo/redo, and before a newer version from
   * elsewhere is merged in, and counts it as unsaved for the leave prompt.
   */
  register: (field: PendingField) => () => void;
  /**
   * Bumps whenever the document changed other than by typing (undo, redo, a
   * merge). The engine has written every field's typing just before, so a
   * field then simply shows the stored value again.
   */
  rev: number;
}

/** Null outside the editor (tests, previews): fields then just commit on blur. */
export const PendingFieldsContext = createContext<FieldSync | null>(null);

export function usePendingFieldRegistry(): FieldSync | null {
  return useContext(PendingFieldsContext);
}
