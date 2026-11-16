"use server";

/**
 * The server side of /withdraw and /cancel: one form action (React
 * useActionState, so it also works before JavaScript has loaded) that moves
 * a visitor through the statutory steps:
 *
 *   form   --"Continue"-->  review (exactly what will be sent)
 *   review --"Change details"--> form
 *   review --"Confirm withdrawal" / "Cancel now"--> receipt
 *
 * Confirming validates again, applies the abuse limits (honeypot, per
 * address and per recipient in memory, a global daily cap), stores the
 * notice with the server's time of receipt, schedules an ordinary
 * cancellation of the sender's own live subscription in Stripe when it can
 * (lib/billing.ts scheduleCancellationAtPeriodEnd), and emails the
 * acknowledgement and the operator. Withdrawals are never processed
 * automatically. Every refusal tells the visitor the email route, so the
 * function never dead-ends. Never throws to the client.
 */
import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { z } from "zod";
import { scheduleCancellationAtPeriodEnd } from "@/lib/billing";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getI18n } from "@/lib/i18n/server";
import { operatorDetails } from "@/lib/legal/operator";
import { clientRateLimitKey } from "@/lib/ops/client-ip";
import { createMemoryRateLimiter } from "@/lib/ops/memory-rate-limit";
import { reportError } from "@/lib/ops/report-error";
import { siteUrl, supportEmail } from "@/lib/site";
import {
  HONEYPOT_FIELD,
  NOTICE_KINDS,
  NOTICE_PATHS,
  NOTICE_TIME_ZONE,
  NOTICES_GLOBAL_DAILY_CAP,
  NOTICES_PER_ADDRESS_PER_HOUR,
  NOTICES_PER_EMAIL_PER_DAY,
  type AckStatus,
  type NoticeKind,
  type StripeOutcome,
} from "./config";
import { sendNoticeEmails } from "./email";
import { readValues, validateNotice, type FieldErrors, type NoticeValues, type ValidNotice } from "./form";
import { declarationLines, formatDate, formatReceivedAt, recipientLine, type DeclarationLine } from "./format";
import {
  contractLabel,
  noticesInLastDay,
  recordNoticeOutcome,
  resolveContract,
  storeNotice,
  type NoticeOutcome,
  type ResolvedContract,
} from "./store";

const HOUR_MS = 60 * 60 * 1000;
const perAddress = createMemoryRateLimiter({ limit: NOTICES_PER_ADDRESS_PER_HOUR, windowMs: HOUR_MS });
const perRecipient = createMemoryRateLimiter({ limit: NOTICES_PER_EMAIL_PER_DAY, windowMs: 24 * HOUR_MS });

export type NoticeError = "rate_limited" | "busy" | "failed";

export type NoticeState =
  /** `key` is new for every answer, so the form is drawn afresh with the values it carries. */
  | { step: "form"; key: string; values: NoticeValues; errors: FieldErrors; error: NoticeError | null }
  | { step: "review"; values: NoticeValues; lines: DeclarationLine[]; error: NoticeError | null }
  | {
      step: "receipt";
      id: string;
      lines: DeclarationLine[];
      /** "13 November 2026 at 15:30:12 CET (2026-11-13 14:30:12 UTC)". */
      receivedAt: string;
      ack: AckStatus;
      /** Where the acknowledgement went (or would have gone). */
      ackEmail: string;
      /** A cancellation scheduled in Stripe: when Pro ends, in words. */
      proEnds: string | null;
    };

/**
 * The form step. React resets a form once its action has run, which would put
 * an uncontrolled <select> back to its first option: a new key draws the form
 * afresh instead, with the values sent back.
 */
function formStep(values: NoticeValues, errors: FieldErrors = {}, error: NoticeError | null = null): NoticeState {
  return { step: "form", key: randomUUID(), values, errors, error };
}

const kindInput = z.enum(NOTICE_KINDS);
const intentInput = z.enum(["review", "confirm", "edit"]);

/** Today in the operator's time zone (YYYY-MM-DD), the earliest end date a cancellation may ask for. */
function operatorToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: NOTICE_TIME_ZONE }).format(now);
}

/** The Stripe path: the sender's own ordinary cancellation of Pro, at the earliest date. */
function cancelsOwnSubscription(notice: ValidNotice, userId: string | null): userId is string {
  return (
    notice.kind === "cancellation" &&
    userId !== null &&
    notice.contractKind === "pro" &&
    notice.cancelType === "ordinary" &&
    notice.requestedEnd === null
  );
}

export async function contractNoticeAction(_prev: NoticeState, formData: FormData): Promise<NoticeState> {
  const values = readValues(formData);
  const kindParse = kindInput.safeParse(formData.get("kind"));
  const intent = intentInput.safeParse(formData.get("intent"));
  if (!kindParse.success || !intent.success || intent.data === "edit") {
    return formStep(values);
  }
  const kind: NoticeKind = kindParse.data;
  const route = NOTICE_PATHS[kind];
  const checked = validateNotice(kind, values, operatorToday(new Date()));
  if (!checked.ok) return formStep(values, checked.errors);
  const notice = checked.notice;

  const { userId } = await auth();
  const { dict, locale } = await getI18n();
  const M = dict.contractNotices;
  const operator = operatorDetails();
  const to = recipientLine(operator);

  let contract: ResolvedContract | null;
  try {
    contract = await resolveContract(userId, notice);
  } catch (error) {
    reportError(error, { source: "contract-notice", route, userId });
    return formStep(values, {}, "failed");
  }
  if (!contract) return formStep(values, { contract: "invalid" });
  const lines = declarationLines({ ...notice, contract: contractLabel(contract, M, locale) }, M, locale, to);

  if (intent.data === "review") return { step: "review", values, lines, error: null };

  // ---- Confirm ------------------------------------------------------------
  const refuse = (error: NoticeError): NoticeState => ({ step: "review", values, lines, error });
  // A bot filled the hidden field: nothing is stored or sent (a person whose
  // browser did it still sees the email route).
  const honeypot = formData.get(HONEYPOT_FIELD);
  if (typeof honeypot === "string" && honeypot.trim() !== "") return refuse("failed");
  if (!perAddress(clientRateLimitKey(await headers()))) return refuse("rate_limited");
  if (!perRecipient(notice.email.toLowerCase())) return refuse("rate_limited");

  let id: string;
  // The moment of receipt: the server's clock when the confirm button arrived.
  const receivedAt = new Date();
  try {
    if ((await noticesInLastDay(receivedAt)) >= NOTICES_GLOBAL_DAILY_CAP) {
      reportError(
        new Error(
          `Contract notices: the cap of ${NOTICES_GLOBAL_DAILY_CAP} a day was reached, so a ${kind} was refused (the visitor was shown the email route)`,
        ),
        { source: "contract-notice", route },
      );
      return refuse("busy");
    }
    ({ id } = await storeNotice({
      kind,
      userId,
      name: notice.name,
      email: notice.email,
      contractKind: notice.contractKind,
      contractRef: contract.ref,
      details: notice.details,
      cancelType: notice.cancelType,
      reason: notice.reason,
      requestedEnd: notice.requestedEnd,
      locale,
      receivedAt,
    }));
  } catch (error) {
    reportError(error, { source: "contract-notice", route, userId });
    return refuse("failed");
  }

  // Stored: from here on the visitor gets their receipt, whatever fails.
  const outcome: NoticeOutcome = {};
  let stripeOutcome: StripeOutcome | null = null;
  let proEndsAt: Date | null = null;
  if (cancelsOwnSubscription(notice, userId)) {
    try {
      const result = await scheduleCancellationAtPeriodEnd(userId);
      stripeOutcome = result.outcome;
      if (result.outcome !== "no_live_subscription") {
        proEndsAt = result.endsAt;
        outcome.status = "done";
        outcome.handledAt = new Date();
      }
    } catch (error) {
      stripeOutcome = "failed";
      reportError(error, { source: "contract-notice", route: "scheduleCancellationAtPeriodEnd", userId });
    }
    outcome.stripeOutcome = stripeOutcome;
    outcome.proEndsAt = proEndsAt;
  }

  const english = getDictionary("en").contractNotices;
  const emails = await sendNoticeEmails(
    {
      id,
      kind,
      locale,
      to: notice.email,
      lines,
      operatorLines: declarationLines(
        { ...notice, contract: contractLabel(contract, english, "en-GB") },
        english,
        "en-GB",
        to,
      ),
      receivedAt,
      userId,
      contractRef: contract.ref,
      stripeOutcome,
      proEndsAt,
    },
    { operator, operatorEmail: operator?.email ?? supportEmail(), site: siteUrl() },
  );
  outcome.ackStatus = emails.ackStatus;
  outcome.operatorNotified = emails.operatorNotified;
  if (emails.ackStatus === "failed") {
    reportError(new Error("Contract notice: the acknowledgement email could not be sent"), { source: "contract-notice", route });
  }
  await recordNoticeOutcome(id, outcome).catch((error) =>
    reportError(error, { source: "contract-notice", route: "recordNoticeOutcome", userId }),
  );

  const scheduled = stripeOutcome === "scheduled" || stripeOutcome === "already_scheduled";
  return {
    step: "receipt",
    id,
    lines,
    receivedAt: formatReceivedAt(receivedAt, locale),
    ack: emails.ackStatus,
    ackEmail: notice.email,
    proEnds: scheduled && proEndsAt ? formatDate(proEndsAt, locale) : null,
  };
}
