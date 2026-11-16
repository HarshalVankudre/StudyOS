import { escapeHtml, EMAIL_SETTINGS_PATH } from "@/lib/email/render";
import { unsubscribeKeys, UNSUBSCRIBE_PATH, verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { DEFAULT_LOCALE, dirFor, isLocale, LOCALE_COOKIE, matchAcceptLanguage, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { unsubscribeEmail } from "@/lib/notifications/service";
import { reportError } from "@/lib/ops/report-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The unsubscribe link of every reminder email, signed-out by design (the
 * signed token is the credential, lib/email/unsubscribe.ts):
 *
 *   POST ?t=<token>   One-click (RFC 8058): the mail app posts
 *                     "List-Unsubscribe=One-Click". Email reminders go off;
 *                     200 with no body. Not same-origin checked: the request
 *                     comes from the mail provider, and the token only ever
 *                     switches email off for the student it names.
 *   GET  ?t=<token>   A small confirmation page, in the visitor's language,
 *                     whose button posts here. A GET changes nothing, so link
 *                     scanners that open every link in an email cannot
 *                     unsubscribe anyone.
 *
 * Push notifications are left as they are. Reachable without signing in:
 * this path is left out of the proxy (src/proxy.ts) altogether, so Clerk
 * never sees these requests; the security headers still apply (they come
 * from next.config.ts). The link is built on the app's own origin
 * (lib/email/unsubscribe.ts unsubscribeOrigin): mail apps do not follow the
 * website deployment's redirect of /api/* for a one-click POST.
 */

const MAX_BODY_BYTES = 2_000;

const pageHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  // The token is in the address: never pass it on.
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
} as const;

/** The visitor's language: their StudyOS choice (cookie), else the browser's, else English. */
function requestLocale(req: Request): Locale {
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== LOCALE_COOKIE) continue;
    let value = rest.join("=");
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep the raw value
    }
    if (isLocale(value)) return value;
  }
  return matchAcceptLanguage(req.headers.get("accept-language")) ?? DEFAULT_LOCALE;
}

interface PageContent {
  title: string;
  body: string;
  /** The unsubscribe button, posting back here. */
  form?: { action: string; button: string };
}

function page(locale: Locale, content: PageContent, status = 200): Response {
  const E = getDictionary(locale).email;
  const h = escapeHtml;
  const form = content.form
    ? `<form method="post" action="${h(content.form.action)}"><input type="hidden" name="confirm" value="1"><button type="submit">${h(content.form.button)}</button></form>`
    : "";
  const html = `<!doctype html>
<html lang="${locale}" dir="${dirFor(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light">
<title>${h(content.title)} · StudyOS</title>
<style>
body{margin:0;background:#FAF9F5;color:#141413;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6}
main{max-width:480px;margin:0 auto;padding:64px 16px}
.brand{margin:0 0 32px;font-weight:700}
h1{margin:0 0 12px;font-family:Georgia,"Times New Roman",serif;font-size:28px;line-height:1.25}
p{margin:0 0 24px}
form{margin:0 0 24px}
button{min-height:44px;padding:12px 24px;border:0;border-radius:999px;background:#C8F24A;color:#141413;font:inherit;font-weight:700;cursor:pointer}
a{color:#141413}
a:focus-visible,button:focus-visible{outline:2px solid #141413;outline-offset:3px}
</style>
</head>
<body>
<main>
<p class="brand">StudyOS</p>
<h1>${h(content.title)}</h1>
<p>${h(content.body)}</p>
${form}
<p><a href="${EMAIL_SETTINGS_PATH}">${h(E.unsubSettings)}</a></p>
</main>
</body>
</html>
`;
  return new Response(html, { status, headers: pageHeaders });
}

function tokenOf(req: Request): string | null {
  try {
    return new URL(req.url).searchParams.get("t");
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const locale = requestLocale(req);
  const E = getDictionary(locale).email;
  const token = tokenOf(req);
  if (!verifyUnsubscribeToken(token, unsubscribeKeys())) {
    return page(locale, { title: E.unsubInvalidTitle, body: E.unsubInvalidBody }, 400);
  }
  return page(locale, {
    title: E.unsubTitle,
    body: E.unsubBody,
    form: { action: `${UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token!)}`, button: E.unsubButton },
  });
}

/** The posted form: the confirmation page sends confirm=1, a mail app List-Unsubscribe=One-Click. */
async function readForm(req: Request): Promise<URLSearchParams> {
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return new URLSearchParams();
  try {
    const text = await req.text();
    return new URLSearchParams(text.length <= MAX_BODY_BYTES ? text : "");
  } catch {
    return new URLSearchParams();
  }
}

export async function POST(req: Request) {
  const form = await readForm(req);
  // A person on the confirmation page gets a page back; a mail app gets an empty 200.
  const fromPage = form.get("confirm") === "1";
  const locale = requestLocale(req);
  const E = getDictionary(locale).email;
  const userId = verifyUnsubscribeToken(tokenOf(req), unsubscribeKeys());
  if (!userId) {
    return fromPage
      ? page(locale, { title: E.unsubInvalidTitle, body: E.unsubInvalidBody }, 400)
      : new Response(null, { status: 400 });
  }
  try {
    await unsubscribeEmail(userId);
  } catch (error) {
    reportError(error, { source: "api", route: UNSUBSCRIBE_PATH, method: "POST", userId });
    return fromPage
      ? page(locale, { title: E.unsubFailedTitle, body: E.unsubFailedBody }, 500)
      : new Response(null, { status: 500 });
  }
  return fromPage
    ? page(locale, { title: E.unsubDoneTitle, body: E.unsubDoneBody })
    : new Response(null, { status: 200 });
}
