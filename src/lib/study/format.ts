/** Compact interval for a grade button: 10m, 5h, 3d, 4mo, 1.5y. */
export type IntervalUnit = "minutes" | "hours" | "days" | "months" | "years";

export function intervalParts(ms: number): { unit: IntervalUnit; n: number } {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return { unit: "minutes", n: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { unit: "hours", n: hours };
  const days = Math.round(hours / 24);
  if (days < 31) return { unit: "days", n: days };
  if (days < 365) return { unit: "months", n: Math.round(days / 30.4) };
  return { unit: "years", n: Math.round((days / 365) * 10) / 10 };
}
