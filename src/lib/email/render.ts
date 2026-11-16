/**
 * The reminder email, built from the same NotificationMessage a push
 * notification shows (lib/notifications/content.ts): its title is the
 * subject and heading, its body the text, and its link the button. Pure.
 *
 * Simple on purpose: one column, system fonts, the StudyOS paper and ink with
 * a lime button, a plain-text part with the same words, no images (so no
 * tracking pixel and nothing fetched from elsewhere) and no scripts. Every
 * piece of text is HTML-escaped: titles carry the student's own words (course
 * and assignment names).
 *
 * Every email ends with why it came, a link to the notification settings, the
 * unsubscribe link and, when the legal notice is configured, the operator's
 * name and postal address.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import type { NotificationMessage } from "@/lib/notifications/content";

export interface EmailLinks {
  /** The app's public origin, no trailing slash. */
  origin: string;
  unsubscribeUrl: string;
}

export interface EmailOperator {
  name: string;
  address: string[];
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Where the footer's "change what you get" link goes. */
export const EMAIL_SETTINGS_PATH = "/app/settings#notifications";

const PAPER = "#FAF9F5";
const INK = "#141413";
const LIME = "#C8F24A";
/** Secondary text: 6.4:1 on the paper background. */
const MUTED = "#5C5B57";
const LINE = "#E3E1D9";
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const SERIF = "font-family:Georgia,'Times New Roman',serif;";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** An absolute link to a same-origin path; anything else opens the app. */
export function absoluteLink(origin: string, path: string): string {
  const safe = path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/app";
  return `${origin}${safe}`;
}

/** One line: no line breaks in a subject or a heading. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export function renderNotificationEmail(
  message: NotificationMessage,
  dict: Dictionary,
  links: EmailLinks,
  operator: EmailOperator | null,
): RenderedEmail {
  const E = dict.email;
  const subject = oneLine(message.title);
  const body = oneLine(message.body);
  const link = absoluteLink(links.origin, message.url);
  const settings = absoluteLink(links.origin, EMAIL_SETTINGS_PATH);
  const align = message.dir === "rtl" ? "right" : "left";
  const h = escapeHtml;

  const text = [
    subject,
    "",
    body,
    "",
    `${E.open}: ${link}`,
    "",
    "-- ",
    E.why,
    `${E.manage}: ${settings}`,
    `${E.unsubscribe}: ${links.unsubscribeUrl}`,
    ...(operator ? ["", operator.name, ...operator.address] : []),
    "",
  ].join("\n");

  const footerLink = `color:${INK};text-decoration:underline;`;
  const html = `<!doctype html>
<html lang="${h(message.lang)}" dir="${message.dir}">
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
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr>
<td dir="${message.dir}" style="${FONT}font-size:16px;line-height:1.6;color:${INK};text-align:${align};">
<p style="margin:0 0 28px;font-size:15px;font-weight:700;">StudyOS</p>
<h1 style="margin:0 0 12px;${SERIF}font-size:26px;line-height:1.25;font-weight:700;color:${INK};">${h(subject)}</h1>
<p style="margin:0 0 28px;">${h(body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="border-radius:999px;background-color:${LIME};">
<a href="${h(link)}" style="display:inline-block;padding:12px 24px;border-radius:999px;${FONT}font-size:16px;font-weight:700;color:${INK};text-decoration:none;">${h(E.open)}</a>
</td>
</tr>
</table>
<hr style="margin:36px 0 20px;border:0;border-top:1px solid ${LINE};">
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${MUTED};">${h(E.why)}</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};"><a href="${h(settings)}" style="${footerLink}">${h(E.manage)}</a> &middot; <a href="${h(links.unsubscribeUrl)}" style="${footerLink}">${h(E.unsubscribe)}</a></p>
${
  operator
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">${[operator.name, ...operator.address].map(h).join("<br>")}</p>\n`
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
 * RFC 8058 one-click unsubscribe, and the marks of an automatic message so
 * out-of-office replies are not sent back. The HTTPS link only: a mailto:
 * target would land in an inbox nobody processes, so asking for it would
 * unsubscribe nobody (RFC 8058 needs the HTTPS link with the -Post header).
 */
export function reminderHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "Auto-Submitted": "auto-generated",
    "X-Auto-Response-Suppress": "OOF, AutoReply",
  };
}
