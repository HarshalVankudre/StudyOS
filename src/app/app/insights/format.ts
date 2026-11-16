/**
 * Numbers, durations, dates and changes on the insights page, in the
 * student's language. Pure: every number goes through Intl for `locale`
 * (Arabic digits in Arabic, grouping everywhere), and every word comes from
 * the dictionary.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import type { CountChange, InsightPeriod, RateChange } from "@/lib/study/insights";

type Copy = Pick<Dictionary, "insights" | "today">;

/** The dictionary key of a period ("7d" → "d7"). */
export function periodKey(period: InsightPeriod): "d7" | "d30" | "d90" {
  return period === "90d" ? "d90" : period === "30d" ? "d30" : "d7";
}

function numberFormat(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch {
    return new Intl.NumberFormat("en", options);
  }
}

export function formatNumber(value: number, locale: string): string {
  return numberFormat(locale).format(Math.round(value));
}

/** 0.873 → "87%" in the student's language. */
export function formatPercent(rate: number, locale: string): string {
  return numberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(rate);
}

/**
 * "25 min", "1 h", "2 h 30 min" with the Today view's words and the
 * student's digits. Beyond an hour, minutes round to the nearest 5 (like
 * formatDuration in lib/agents/daily-study/present.ts).
 */
export function formatMinutes(minutes: number, copy: Copy, locale: string): string {
  const T = copy.today;
  const m = Math.max(0, Math.round(minutes));
  const n = (value: number) => formatNumber(value, locale);
  if (m < 60) return fmt(T.minutes, { count: n(m) });
  const h = Math.floor(m / 60);
  const rest = Math.round((m % 60) / 5) * 5;
  if (rest === 0) return fmt(T.hours, { count: n(h) });
  if (rest === 60) return fmt(T.hours, { count: n(h + 1) });
  return fmt(T.hoursMinutes, { h: n(h), m: n(rest) });
}

/** A day as "Mon 10 Nov" (or the locale's own order). */
export function formatDay(day: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  } catch {
    return day;
  }
}

/**
 * How a number changed against the period before: "Up 25 min from the 7
 * days before", "Same as …", or that there is nothing to compare with yet.
 * `show` formats the size of the change; a rate (0…1) that moved by less
 * than half a percentage point reads as the same.
 */
export function describeChange(
  change: CountChange | RateChange,
  options: {
    hasPrevious: boolean;
    period: InsightPeriod;
    copy: Copy;
    show: (amount: number) => string;
    rate?: boolean;
  },
): string {
  const I = options.copy.insights;
  if (!options.hasPrevious || change.change === null) return I.noPrevious;
  const previous = I.previous[periodKey(options.period)];
  const amount = Math.abs(change.change);
  if (options.rate ? amount < 0.005 : amount === 0) return fmt(I.same, { previous });
  return fmt(change.change > 0 ? I.up : I.down, { value: options.show(amount), previous });
}
