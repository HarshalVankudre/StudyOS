/**
 * Email configuration from the environment: plain SMTP, so any provider that
 * offers it works (Postmark, Brevo, Amazon SES, Resend, Mailgun, ...).
 *
 *   SMTP_URL       smtps://user:password@smtp.example.com:465  (TLS from the start)
 *                  smtp://user:password@smtp.example.com:587   (STARTTLS, required
 *                  except on localhost, so credentials never travel in clear)
 *   MAIL_FROM      StudyOS <hello@example.com>
 *   MAIL_REPLY_TO  optional single address
 *
 * Email exists only when SMTP_URL and MAIL_FROM are both set and valid;
 * otherwise every email surface hides itself and nothing is sent. Pure (no
 * server-only imports): lib/ops/env.ts and the bundled startup check use it.
 * The SMTP URL carries a password: nothing here ever logs or returns it.
 */
import { isPlausibleEmail } from "@/lib/site";

type Env = Record<string, string | undefined>;

export interface SmtpSettings {
  host: string;
  port: number;
  /** TLS from the first byte (smtps:). */
  secure: boolean;
  /** Refuse to send unless the server upgrades with STARTTLS (smtp: off localhost). */
  requireTLS: boolean;
  auth: { user: string; pass: string } | null;
}

export interface Mailbox {
  name: string | null;
  address: string;
}

export interface EmailConfig {
  smtp: SmtpSettings;
  from: Mailbox;
  replyTo: string | null;
}

const LOCAL_HOSTS = /^(localhost|127(?:\.\d{1,3}){3}|::1|0\.0\.0\.0)$/i;

/**
 * Percent-decoding that never throws: every run of valid %XX escapes is
 * decoded, anything else (a lone "%", a "+") is kept as written. Providers
 * hand out passwords with "/", "+" and "%" in them, and not every operator
 * encodes them.
 */
function lenientDecode(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

type SmtpParse = { ok: true; settings: SmtpSettings } | { ok: false; problem: string };

function readSmtpUrl(raw: string | undefined): SmtpParse {
  const value = raw?.trim();
  if (!value) return { ok: false, problem: "it is empty" };
  const scheme = /^(smtps?):\/\//i.exec(value);
  if (!scheme) return { ok: false, problem: "it does not start with smtp:// or smtps://" };
  const rest = value.slice(scheme[0].length);
  // The login is everything before the LAST "@" (a host never has one), so a
  // password holding "/", "?", "#", ":" or "@" unencoded still reads right.
  // URL parsing would end the login at its first "/" and misread the host.
  const at = rest.lastIndexOf("@");
  const login = at >= 0 ? rest.slice(0, at) : "";
  let url: URL;
  try {
    url = new URL(`smtp://${rest.slice(at + 1)}`);
  } catch {
    return { ok: false, problem: "its host or port cannot be read" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || url.username || url.password) return { ok: false, problem: "it has no host" };
  const secure = scheme[1].toLowerCase() === "smtps";
  const port = url.port ? Number(url.port) : secure ? 465 : 587;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return { ok: false, problem: "its host or port cannot be read (the port must be 1 to 65535)" };
  const colon = login.indexOf(":");
  const user = lenientDecode(colon >= 0 ? login.slice(0, colon) : login);
  const pass = lenientDecode(colon >= 0 ? login.slice(colon + 1) : "");
  return {
    ok: true,
    settings: {
      host,
      port,
      secure,
      requireTLS: !secure && !LOCAL_HOSTS.test(host),
      auth: user || pass ? { user, pass } : null,
    },
  };
}

/** SMTP_URL as connection settings, or null when it is not a usable smtp(s) URL. Never throws. */
export function parseSmtpUrl(raw: string | undefined): SmtpSettings | null {
  const parsed = readSmtpUrl(raw);
  return parsed.ok ? parsed.settings : null;
}

/** Why SMTP_URL cannot be used (for the startup check, never naming its value), or null when it can. */
export function smtpUrlProblem(raw: string | undefined): string | null {
  const parsed = readSmtpUrl(raw);
  return parsed.ok ? null : parsed.problem;
}

/**
 * "Name <address>" or a bare address, or null. A display name with a line
 * break, angle bracket or control character is refused (header injection).
 */
export function parseMailbox(raw: string | undefined): Mailbox | null {
  const value = raw?.trim();
  if (!value || value.length > 320) return null;
  const named = /^(.*?)\s*<([^<>\s]+)>$/.exec(value);
  if (named) {
    const name = named[1].trim().replace(/^"(.*)"$/, "$1").trim();
    if (/[\u0000-\u001f\u007f<>"]/.test(name)) return null;
    return isPlausibleEmail(named[2]) ? { name: name || null, address: named[2] } : null;
  }
  return isPlausibleEmail(value) ? { name: null, address: value } : null;
}

let cache: { signature: string; value: EmailConfig | null } | null = null;

/** The email settings, or null when email is not (correctly) configured. */
export function emailConfig(env: Env = process.env): EmailConfig | null {
  const signature = `${env.SMTP_URL ?? ""}\n${env.MAIL_FROM ?? ""}\n${env.MAIL_REPLY_TO ?? ""}`;
  if (cache?.signature === signature) return cache.value;
  const smtp = parseSmtpUrl(env.SMTP_URL);
  const from = parseMailbox(env.MAIL_FROM);
  const replyTo = env.MAIL_REPLY_TO?.trim();
  const value =
    smtp && from ? { smtp, from, replyTo: replyTo && isPlausibleEmail(replyTo) ? replyTo : null } : null;
  cache = { signature, value };
  return value;
}

export function emailConfigured(env: Env = process.env): boolean {
  return emailConfig(env) !== null;
}
