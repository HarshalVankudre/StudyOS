/**
 * The two emails of a withdrawal or cancellation notice:
 *
 *  - the acknowledgement of receipt to the sender (Art. 11a(3) CRD,
 *    § 356a BGB; § 312k(4) BGB), in their language, on a durable medium:
 *    the content of the declaration and the date and time it was received.
 *    It confirms RECEIPT only, never that a withdrawal is valid or accepted;
 *  - a plain notification to the operator (legal notice email, else
 *    support), so a notice is seen without opening the console.
 *
 * Transactional: no unsubscribe link and none of the reminder channel's
 * preference, bounce or suppression logic (lib/notifications/email-channel.ts),
 * which could drop them. Every piece of user input is HTML-escaped and none
 * goes into a header; the only one there is the validated recipient address.
 */
import "server-only";

import { emailConfigured } from "@/lib/email/config";
import { sendMail, type MailOutcome, type OutgoingMail } from "@/lib/email/mailer";
import { escapeHtml, type RenderedEmail } from "@/lib/email/render";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { dirFor, type Locale } from "@/lib/i18n/config";
import { fmt } from "@/lib/i18n/interpolate";
import type { OperatorDetails } from "@/lib/legal/operator";
import type { AckStatus, NoticeKind, StripeOutcome } from "./config";
import { formatDate, formatReceivedAt, type DeclarationLine } from "./format";

export interface NoticeEmailInput {
  id: string;
  kind: NoticeKind;
  locale: Locale;
  /** The validated address the sender asked the acknowledgement to go to. */
  to: string;
  /** The declaration in the sender's language (format.ts declarationLines). */
  lines: DeclarationLine[];
  /** The same declaration in English, for the operator. */
  operatorLines: DeclarationLine[];
  receivedAt: Date;
  userId: string | null;
  contractRef: string | null;
  stripeOutcome: StripeOutcome | null;
  proEndsAt: Date | null;
}

const PAPER = "#FAF9F5";
const INK = "#141413";
const MUTED = "#5C5B57";
const LINE = "#E3E1D9";
const OAT = "#F1ECE1";
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const SERIF = "font-family:Georgia,'Times New Roman',serif;";

/** Marks of an automatic message, so out-of-office replies are not sent back. */
const AUTOMATIC_HEADERS = { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "OOF, AutoReply" };

const h = escapeHtml;
/** Escaped, with its line breaks kept. */
const multiline = (text: string) => h(text).replace(/\n/g, "<br>");

interface Layout {
  lang: string;
  dir: "ltr" | "rtl";
  title: string;
  paragraphs: string[];
  lines: DeclarationLine[];
  after: string[];
  footer: string[];
}

/** One column, the StudyOS paper and ink, no images or links fetched from elsewhere. */
function renderLayout(layout: Layout): RenderedEmail {
  const subject = layout.title.replace(/\s+/g, " ").trim();
  const align = layout.dir === "rtl" ? "right" : "left";
  const text = [
    subject,
    "",
    ...layout.paragraphs.flatMap((p) => [p, ""]),
    ...layout.lines.map((line) => `${line.label}: ${line.value}`),
    "",
    ...layout.after.flatMap((p) => [p, ""]),
    ...(layout.footer.length ? ["-- ", ...layout.footer, ""] : []),
  ].join("\n");
  const rows = layout.lines
    .map(
      (line) =>
        `<tr><td style="padding:6px 0;vertical-align:top;color:${MUTED};font-size:14px;white-space:nowrap;padding-${layout.dir === "rtl" ? "left" : "right"}:16px;">${h(line.label)}</td><td dir="auto" style="padding:6px 0;vertical-align:top;font-size:15px;">${multiline(line.value)}</td></tr>`,
    )
    .join("\n");
  const paragraph = (p: string) => `<p style="margin:0 0 16px;">${h(p)}</p>`;
  const html = `<!doctype html>
<html lang="${h(layout.lang)}" dir="${layout.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${h(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};color:${INK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPER};">
<tr>
<td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr>
<td dir="${layout.dir}" style="${FONT}font-size:16px;line-height:1.6;color:${INK};text-align:${align};">
<p style="margin:0 0 28px;font-size:15px;font-weight:700;">StudyOS</p>
<h1 style="margin:0 0 16px;${SERIF}font-size:26px;line-height:1.25;font-weight:700;color:${INK};">${h(subject)}</h1>
${layout.paragraphs.map(paragraph).join("\n")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;background-color:${OAT};border-radius:16px;">
<tr><td style="padding:16px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${FONT}line-height:1.5;color:${INK};text-align:${align};">
${rows}
</table>
</td></tr>
</table>
${layout.after.map(paragraph).join("\n")}
${
  layout.footer.length
    ? `<hr style="margin:28px 0 16px;border:0;border-top:1px solid ${LINE};">\n<p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">${layout.footer.map(h).join("<br>")}</p>\n`
    : ""
}</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`;
  return { subject, text, html };
}

/**
 * The acknowledgement of receipt, in the sender's language. `contactEmail`
 * is where they can write to us (the operator's address, else support).
 */
export function renderAcknowledgement(
  input: NoticeEmailInput,
  operator: Pick<OperatorDetails, "name" | "address"> | null,
  contactEmail: string,
  site: string,
): RenderedEmail {
  const dict = getDictionary(input.locale);
  const M = dict.contractNotices;
  const K = input.kind === "withdrawal" ? M.withdraw : M.cancel;
  const date = formatReceivedAt(input.receivedAt, input.locale);
  const after: string[] = [];
  const scheduled = input.stripeOutcome === "scheduled" || input.stripeOutcome === "already_scheduled";
  if (input.kind === "cancellation" && scheduled && input.proEndsAt) {
    after.push(fmt(M.cancel.scheduled, { date: formatDate(input.proEndsAt, input.locale) }));
  } else {
    after.push(K.next);
  }
  return renderLayout({
    lang: input.locale,
    dir: dirFor(input.locale),
    title: K.emailSubject,
    paragraphs: [fmt(K.received, { date }), M.email.receiptOnly],
    lines: [...input.lines, { label: M.lines.reference, value: input.id }],
    after,
    footer: [
      fmt(M.email.notYou, { site, email: contactEmail }),
      ...(operator ? ["", operator.name, ...operator.address] : []),
    ],
  });
}

const STRIPE_WORDS: Record<StripeOutcome, string> = {
  scheduled: "Stripe updated: the subscription is set to cancel at period end.",
  already_scheduled: "Stripe: the subscription was already set to cancel at period end.",
  no_live_subscription: "Stripe not changed: no active subscription found for this account. Check it by hand.",
  failed: "Stripe update FAILED (reported in the error log). Cancel it by hand.",
};

/** The operator's notification (English, like the console). */
export function renderOperatorNotice(input: NoticeEmailInput, consoleUrl: string): RenderedEmail {
  const what = input.kind === "withdrawal" ? "withdrawal" : "cancellation";
  const facts: DeclarationLine[] = [
    { label: "Received", value: formatReceivedAt(input.receivedAt, "en-GB") },
    ...input.operatorLines,
    { label: "Language", value: input.locale },
    { label: "Account", value: input.userId ?? "not signed in" },
    ...(input.contractRef ? [{ label: "Stripe reference", value: input.contractRef }] : []),
    { label: "Reference", value: input.id },
  ];
  const after: string[] = [];
  if (input.stripeOutcome) {
    after.push(STRIPE_WORDS[input.stripeOutcome]);
    if (input.proEndsAt) after.push(`Pro ends: ${formatDate(input.proEndsAt, "en-GB")}.`);
  }
  after.push(
    input.kind === "withdrawal"
      ? "Withdrawals are never processed automatically: work out the refund (Terms, section 4), then mark it done in the console."
      : "Process it if Stripe was not updated, confirm the end date to the customer, then mark it done in the console.",
  );
  after.push(`Console: ${consoleUrl}`);
  return renderLayout({
    lang: "en",
    dir: "ltr",
    title: `New ${what} notice received`,
    paragraphs: [`A ${what} was declared with the online function. The sender has been sent an acknowledgement of receipt (if email worked).`],
    lines: facts,
    after,
    footer: [],
  });
}

export interface NoticeEmailResult {
  ackStatus: AckStatus;
  operatorNotified: boolean;
}

export interface SendNoticeEmailsOptions {
  operator: Pick<OperatorDetails, "name" | "address"> | null;
  /** Where the sender can write to us, and where the operator's notification goes. */
  operatorEmail: string;
  site: string;
  send?: (mail: OutgoingMail) => Promise<MailOutcome>;
  configured?: boolean;
}

/** Send both emails (at once). Never throws. */
export async function sendNoticeEmails(
  input: NoticeEmailInput,
  options: SendNoticeEmailsOptions,
): Promise<NoticeEmailResult> {
  const configured = options.configured ?? emailConfigured();
  if (!configured) return { ackStatus: "not_configured", operatorNotified: false };
  const send = options.send ?? sendMail;
  const mail = (to: string, rendered: RenderedEmail): OutgoingMail => ({ to, ...rendered, headers: AUTOMATIC_HEADERS });
  const [ack, notice] = await Promise.all([
    send(mail(input.to, renderAcknowledgement(input, options.operator, options.operatorEmail, options.site))).catch(
      () => null,
    ),
    send(mail(options.operatorEmail, renderOperatorNotice(input, `${options.site}/app/admin#contract-notices`))).catch(
      () => null,
    ),
  ]);
  return { ackStatus: ack?.kind === "sent" ? "sent" : "failed", operatorNotified: notice?.kind === "sent" };
}
