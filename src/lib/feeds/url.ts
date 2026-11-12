/**
 * Turning what a student pasted into a feed link we are willing to fetch.
 * Isomorphic: the dialog uses it for instant feedback, the server re-checks
 * with it (and then with DNS) before any request is made.
 */

export type FeedUrlError = "invalid_url" | "unsupported_link";

const MAX_URL_CHARS = 2_048;

/** Names that never point at a public calendar server. */
const PRIVATE_SUFFIXES = [
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".private",
  ".test",
  ".invalid",
  ".example",
];

export function normalizeFeedUrl(
  input: string,
): { ok: true; url: string } | { ok: false; error: FeedUrlError } {
  let text = (input ?? "").trim().replace(/^[<"'“”]+|[>"'“”]+$/g, "").trim();
  if (!text || text.length > MAX_URL_CHARS || /\s/.test(text)) return { ok: false, error: "invalid_url" };
  // webcal:// is how calendar apps advertise subscriptions; it is plain HTTP(S).
  text = text.replace(/^webcals?:\/\//i, "https://");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return { ok: false, error: "unsupported_link" };
    text = `https://${text}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  // Calendar links are sometimes shown as http://; only ever fetch over https.
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") return { ok: false, error: "unsupported_link" };
  if (url.username || url.password) return { ok: false, error: "unsupported_link" };
  if (url.port && url.port !== "443") return { ok: false, error: "unsupported_link" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, error: "invalid_url" };
  const isIpLiteral = /^\[.*\]$/.test(host) || /^\d+(\.\d+){3}$/.test(host);
  if (!isIpLiteral && (!host.includes(".") || PRIVATE_SUFFIXES.some((s) => host === s.replace(/^\./, "") || host.endsWith(s)))) {
    return { ok: false, error: "unsupported_link" };
  }
  url.hash = "";
  return { ok: true, url: url.href };
}

/** The part of a feed link that is safe to show: its host. */
export function feedLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
