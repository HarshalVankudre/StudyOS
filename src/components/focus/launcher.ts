"use client";

import { createContext, useContext } from "react";
import type { FocusTarget } from "@/lib/study/focus-timer";

/** What the rest of the app may do with the focus timer: open it, and see what it is about. */
export interface FocusLauncher {
  /** Open the timer to start a session about `target`, or show the one on the clock. */
  open: (target?: Partial<FocusTarget>) => void;
  /** The Today item the current block was started from, while one is on the clock. */
  activeItemKey: string | null;
}

export const FocusLauncherContext = createContext<FocusLauncher | null>(null);

/** The timer's launcher, or null where there is no timer (outside the signed-in app). */
export function useFocusLauncher(): FocusLauncher | null {
  return useContext(FocusLauncherContext);
}
