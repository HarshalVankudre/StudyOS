/**
 * Maps design-token color names (from the data model) to Tailwind classes.
 * These are STATIC maps on purpose: Tailwind only keeps classes it can see in
 * source, so we can't build class names like `bg-${color}-100` dynamically.
 */

export const PILL_CLASSES: Record<string, string> = {
  zinc: "bg-white/[0.06] text-ink-soft ring-1 ring-inset ring-white/10",
  gray: "bg-white/[0.06] text-ink-soft ring-1 ring-inset ring-white/10",
  red: "bg-red-400/15 text-red-300 ring-1 ring-inset ring-red-400/30",
  rose: "bg-rose-400/15 text-rose-300 ring-1 ring-inset ring-rose-400/30",
  orange: "bg-orange-400/15 text-orange-300 ring-1 ring-inset ring-orange-400/30",
  amber: "bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30",
  yellow: "bg-yellow-400/15 text-yellow-300 ring-1 ring-inset ring-yellow-400/30",
  lime: "bg-lime-400/15 text-lime-300 ring-1 ring-inset ring-lime-400/30",
  green: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30",
  emerald: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30",
  teal: "bg-lime-faint text-lime ring-1 ring-inset ring-lime/30",
  cyan: "bg-cyan-400/15 text-cyan-300 ring-1 ring-inset ring-cyan-400/30",
  sky: "bg-sky-400/15 text-sky-300 ring-1 ring-inset ring-sky-400/30",
  blue: "bg-blue-400/15 text-blue-300 ring-1 ring-inset ring-blue-400/30",
  indigo: "bg-indigo-400/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/30",
  violet: "bg-violet-400/15 text-violet-300 ring-1 ring-inset ring-violet-400/30",
  purple: "bg-purple-400/15 text-purple-300 ring-1 ring-inset ring-purple-400/30",
  fuchsia: "bg-fuchsia-400/15 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-400/30",
  pink: "bg-pink-400/15 text-pink-300 ring-1 ring-inset ring-pink-400/30",
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
