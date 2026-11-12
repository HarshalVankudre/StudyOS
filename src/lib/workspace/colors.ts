/**
 * Maps design-token color names (from the data model) to Tailwind classes.
 * These are STATIC maps on purpose: Tailwind only keeps classes it can see in
 * source, so we can't build class names like `bg-${color}-100` dynamically.
 *
 * The app is dark by default; `.light` on <html> switches the theme, so each
 * entry carries `[.light_&]:` overrides with darker text for contrast on white.
 */

export const PILL_CLASSES: Record<string, string> = {
  zinc: "bg-white/[0.06] text-ink-soft ring-1 ring-inset ring-white/10 [.light_&]:bg-zinc-900/[0.05] [.light_&]:ring-zinc-900/10",
  gray: "bg-white/[0.06] text-ink-soft ring-1 ring-inset ring-white/10 [.light_&]:bg-zinc-900/[0.05] [.light_&]:ring-zinc-900/10",
  red: "bg-red-400/15 text-red-300 ring-1 ring-inset ring-red-400/30 [.light_&]:bg-red-500/10 [.light_&]:text-red-700",
  rose: "bg-rose-400/15 text-rose-300 ring-1 ring-inset ring-rose-400/30 [.light_&]:bg-rose-500/10 [.light_&]:text-rose-700",
  orange: "bg-orange-400/15 text-orange-300 ring-1 ring-inset ring-orange-400/30 [.light_&]:bg-orange-500/10 [.light_&]:text-orange-700",
  amber: "bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30 [.light_&]:bg-amber-500/10 [.light_&]:text-amber-700",
  yellow: "bg-yellow-400/15 text-yellow-300 ring-1 ring-inset ring-yellow-400/30 [.light_&]:bg-yellow-500/15 [.light_&]:text-yellow-800",
  lime: "bg-lime-400/15 text-lime-300 ring-1 ring-inset ring-lime-400/30 [.light_&]:bg-lime-500/15 [.light_&]:text-lime-800",
  green: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30 [.light_&]:bg-emerald-500/10 [.light_&]:text-emerald-700",
  emerald: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30 [.light_&]:bg-emerald-500/10 [.light_&]:text-emerald-700",
  teal: "bg-lime-faint text-lime ring-1 ring-inset ring-lime/30",
  cyan: "bg-cyan-400/15 text-cyan-300 ring-1 ring-inset ring-cyan-400/30 [.light_&]:bg-cyan-500/10 [.light_&]:text-cyan-700",
  sky: "bg-sky-400/15 text-sky-300 ring-1 ring-inset ring-sky-400/30 [.light_&]:bg-sky-500/10 [.light_&]:text-sky-700",
  blue: "bg-blue-400/15 text-blue-300 ring-1 ring-inset ring-blue-400/30 [.light_&]:bg-blue-500/10 [.light_&]:text-blue-700",
  indigo: "bg-indigo-400/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/30 [.light_&]:bg-indigo-500/10 [.light_&]:text-indigo-700",
  violet: "bg-violet-400/15 text-violet-300 ring-1 ring-inset ring-violet-400/30 [.light_&]:bg-violet-500/10 [.light_&]:text-violet-700",
  purple: "bg-purple-400/15 text-purple-300 ring-1 ring-inset ring-purple-400/30 [.light_&]:bg-purple-500/10 [.light_&]:text-purple-700",
  fuchsia: "bg-fuchsia-400/15 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-400/30 [.light_&]:bg-fuchsia-500/10 [.light_&]:text-fuchsia-700",
  pink: "bg-pink-400/15 text-pink-300 ring-1 ring-inset ring-pink-400/30 [.light_&]:bg-pink-500/10 [.light_&]:text-pink-700",
};

export function pillClasses(color?: string): string {
  return (color && PILL_CLASSES[color]) || PILL_CLASSES.zinc;
}

export const DOT_CLASSES: Record<string, string> = {
  zinc: "bg-zinc-400", gray: "bg-zinc-400",
  red: "bg-red-400", rose: "bg-rose-400",
  orange: "bg-orange-400", amber: "bg-amber-400",
  yellow: "bg-yellow-400", lime: "bg-lime-400",
  green: "bg-emerald-400", emerald: "bg-emerald-400",
  teal: "bg-lime", cyan: "bg-cyan-400",
  sky: "bg-sky-400", blue: "bg-blue-400",
  indigo: "bg-indigo-400", violet: "bg-violet-400",
  purple: "bg-purple-400", fuchsia: "bg-fuchsia-400",
  pink: "bg-pink-400",
};

export function dotClass(color?: string): string {
  return (color && DOT_CLASSES[color]) || DOT_CLASSES.zinc;
}

/**
 * Deadline badge styling by tone (see `dueInfo` in view-logic). Only overdue
 * and due-today get a tinted background; everything else stays quiet, so a
 * busy tracker reads as a few clear signals rather than a wall of red.
 */
export const DUE_TONE_CLASSES: Record<
  "overdue" | "today" | "soon" | "week" | "later" | "past" | "done",
  string
> = {
  overdue: "bg-rose-400/12 text-rose-300 ring-rose-400/30 [.light_&]:bg-rose-500/10 [.light_&]:text-rose-700",
  today: "bg-amber-400/12 text-amber-300 ring-amber-400/30 [.light_&]:bg-amber-500/10 [.light_&]:text-amber-700",
  soon: "text-amber-300 ring-amber-400/25 [.light_&]:text-amber-700",
  week: "text-ink-soft ring-line-strong",
  later: "text-ink-faint ring-line",
  past: "text-ink-faint ring-line",
  done: "text-ink-faint ring-line",
};
