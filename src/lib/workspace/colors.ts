/**
 * Maps design-token color names (from the data model) to Tailwind classes.
 * These are STATIC maps on purpose: Tailwind only keeps classes it can see in
 * source, so we can't build class names like `bg-${color}-100` dynamically.
 */

export const PILL_CLASSES: Record<string, string> = {
  zinc: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  red: "bg-red-100 text-red-700 ring-red-200",
  rose: "bg-rose-100 text-rose-700 ring-rose-200",
  orange: "bg-orange-100 text-orange-700 ring-orange-200",
  amber: "bg-amber-100 text-amber-800 ring-amber-200",
  yellow: "bg-yellow-100 text-yellow-800 ring-yellow-200",
  lime: "bg-lime-100 text-lime-700 ring-lime-200",
  green: "bg-green-100 text-green-700 ring-green-200",
  emerald: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  teal: "bg-teal-100 text-teal-700 ring-teal-200",
  cyan: "bg-cyan-100 text-cyan-700 ring-cyan-200",
  sky: "bg-sky-100 text-sky-700 ring-sky-200",
  blue: "bg-blue-100 text-blue-700 ring-blue-200",
  indigo: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  violet: "bg-violet-100 text-violet-700 ring-violet-200",
  purple: "bg-purple-100 text-purple-700 ring-purple-200",
  fuchsia: "bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200",
  pink: "bg-pink-100 text-pink-700 ring-pink-200",
};

export function pillClasses(color?: string): string {
  return (color && PILL_CLASSES[color]) || PILL_CLASSES.zinc;
}

export const DOT_CLASSES: Record<string, string> = {
  zinc: "bg-zinc-400",
  gray: "bg-zinc-400",
  red: "bg-red-500",
  rose: "bg-rose-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  yellow: "bg-yellow-500",
  lime: "bg-lime-500",
  green: "bg-green-500",
  emerald: "bg-emerald-500",
  teal: "bg-teal-500",
  cyan: "bg-cyan-500",
  sky: "bg-sky-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  purple: "bg-purple-500",
  fuchsia: "bg-fuchsia-500",
  pink: "bg-pink-500",
};

export function dotClass(color?: string): string {
  return (color && DOT_CLASSES[color]) || DOT_CLASSES.zinc;
}
