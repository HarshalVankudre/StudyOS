/**
 * Daily study streak — the retention hook. A streak is the number of
 * consecutive calendar days (ending today or yesterday) on which the user
 * reviewed at least one card. Kept pure and day-string based so it's testable
 * and timezone-agnostic (the caller supplies days already in local time).
 */

/**
 * @param reviewDays distinct local YYYY-MM-DD strings the user studied on.
 * @param today local YYYY-MM-DD for "now".
 * @returns consecutive-day streak. 0 if the last study day is before yesterday
 *          (the streak has lapsed). Studying yesterday but not yet today keeps
 *          the streak alive so an evening reminder still shows a live number.
 */
export function computeStreak(reviewDays: string[], today: string): number {
  if (reviewDays.length === 0) return 0;
  const set = new Set(reviewDays);
  const yesterday = shiftDay(today, -1);
  // Anchor: if studied today, count from today; else if yesterday, from
  // yesterday; else the streak is broken.
  let cursor: string;
  if (set.has(today)) cursor = today;
  else if (set.has(yesterday)) cursor = yesterday;
  else return 0;

  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
