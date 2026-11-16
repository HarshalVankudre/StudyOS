/**
 * The words of a withdrawal or cancellation declaration, built once and shown
 * three times: on the review step (exactly what will be sent), on the
 * receipt, and in the acknowledgement email. Pure.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { NOTICE_TIME_ZONE, type CancelType, type NoticeKind } from "./config";

export type NoticeMessages = Dictionary["contractNotices"];

export interface DeclarationLine {
  label: string;
  value: string;
}

/** What a declaration says (the validated notice with its contract described). */
export interface Declaration {
  kind: NoticeKind;
  name: string;
  email: string;
  /** The contract in words ("Pro subscription", "Credit pack, bought on …"). */
  contract: string;
  details: string | null;
  cancelType: CancelType | null;
  reason: string | null;
  /** YYYY-MM-DD, or null for the earliest possible date. */
  requestedEnd: string | null;
}

/** A calendar day (YYYY-MM-DD) in words, e.g. "13 November 2026". */
export function formatDay(day: string, locale: string): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
}

/** A date in words in the operator's time zone (for "paid until", "bought on", "ends on"). */
export function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: NOTICE_TIME_ZONE }).format(date);
}

/**
 * The moment a notice was received, unambiguous: date and time with its time
 * zone in the operator's zone, then the UTC instant, e.g.
 * "13 November 2026 at 15:30:12 CET (2026-11-13 14:30:12 UTC)".
 */
export function formatReceivedAt(date: Date, locale: string): string {
  const local = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "long",
    timeZone: NOTICE_TIME_ZONE,
  }).format(date);
  const utc = `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
  return `${local} (${utc})`;
}

/** Who the declaration is addressed to: the operator of the legal notice, else StudyOS. */
export function recipientLine(operator: { name: string; address: string[] } | null): string {
  return operator ? [operator.name, ...operator.address].join(", ") : "StudyOS";
}

/** The declaration as labelled lines, in the order it reads. */
export function declarationLines(
  declaration: Declaration,
  M: NoticeMessages,
  locale: string,
  to: string,
): DeclarationLine[] {
  const L = M.lines;
  const lines: DeclarationLine[] = [];
  if (declaration.kind === "withdrawal") {
    lines.push({ label: L.declaration, value: M.withdraw.statement });
  } else {
    const extraordinary = declaration.cancelType === "extraordinary";
    lines.push({
      label: L.declaration,
      value: extraordinary ? M.cancel.statementExtraordinary : M.cancel.statementOrdinary,
    });
  }
  lines.push({ label: L.to, value: to });
  if (declaration.kind === "cancellation") {
    const extraordinary = declaration.cancelType === "extraordinary";
    lines.push({ label: L.type, value: extraordinary ? M.cancel.extraordinary : M.cancel.ordinary });
    if (extraordinary && declaration.reason) lines.push({ label: L.reason, value: declaration.reason });
    lines.push({
      label: L.end,
      value: declaration.requestedEnd
        ? fmt(M.cancel.endOn, { date: formatDay(declaration.requestedEnd, locale) })
        : M.cancel.endEarliest,
    });
  }
  lines.push({ label: L.contract, value: declaration.contract });
  if (declaration.details) lines.push({ label: L.details, value: declaration.details });
  lines.push({ label: L.name, value: declaration.name });
  lines.push({ label: L.email, value: declaration.email });
  return lines;
}
