/**
 * /.well-known/security.txt (RFC 9116): where to report a vulnerability.
 *
 * The contact is STUDYOS_SECURITY_EMAIL when set, else the public support
 * address (lib/site.ts). Expires is required by the RFC and must be less than
 * a year ahead; the file is generated per request, so it always says 180
 * days from now and never goes stale.
 */
import { isPlausibleEmail, siteUrl, supportEmail } from "@/lib/site";

type Env = Record<string, string | undefined>;

export const SECURITY_TXT_TTL_DAYS = 180;

export function securityContact(env: Env = process.env): string {
  const raw = env.STUDYOS_SECURITY_EMAIL?.trim();
  return isPlausibleEmail(raw) ? raw : supportEmail(env);
}

export function securityTxt(now: Date = new Date(), env: Env = process.env, origin: string = siteUrl()): string {
  const expires = new Date(now.getTime() + SECURITY_TXT_TTL_DAYS * 24 * 60 * 60 * 1000);
  // Whole seconds: RFC 3339 without milliseconds reads better and is valid.
  const stamp = `${expires.toISOString().slice(0, 19)}Z`;
  return [
    `Contact: mailto:${securityContact(env)}`,
    `Expires: ${stamp}`,
    "Preferred-Languages: en",
    `Canonical: ${origin}/.well-known/security.txt`,
    "",
  ].join("\n");
}
