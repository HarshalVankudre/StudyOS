/**
 * Who operates StudyOS, for the legal notice (/legal-notice: the German
 * "Impressum" required by § 5 DDG) and the privacy policy's controller line.
 *
 * Configured with plain, non-secret environment variables (registered in
 * lib/ops/env.ts, documented in .env.example). The notice exists only when a
 * name AND a postal address are set: without them /legal-notice is a 404, no
 * footer links to it and the sitemap leaves it out. In production the startup
 * check warns while it is missing. The public pages are served by the website
 * deployment too (lib/ops/site-split.ts), so set them on both deployments.
 */
import { isPlausibleEmail, supportEmail } from "@/lib/site";

type Env = Record<string, string | undefined>;

export interface OperatorDetails {
  /** Person or company. */
  name: string;
  /** Postal address, one entry per line. */
  address: string[];
  /** STUDYOS_OPERATOR_EMAIL, or the support address when unset or malformed. */
  email: string;
  phone: string | null;
  /** Commercial register entry, e.g. "Amtsgericht Berlin, HRB 12345". */
  register: string | null;
  vatId: string | null;
  /** Person responsible for the content. */
  responsible: string | null;
}

/** Longest value accepted for one field; anything longer is a paste accident. */
const MAX_FIELD = 300;

function text(env: Env, name: string): string | null {
  const value = env[name]?.replace(/\s+/g, " ").trim();
  return value && value.length <= MAX_FIELD ? value : null;
}

/**
 * Address lines: separated by real line breaks, a literal "\n" (how .env
 * files and many dashboards carry one) or "|". Blank lines are dropped.
 */
export function parseAddress(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n|\\n|\|/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && line.length <= MAX_FIELD);
}

/** The operator's details, or null when the legal notice is not configured. */
export function operatorDetails(env: Env = process.env): OperatorDetails | null {
  const name = text(env, "STUDYOS_OPERATOR_NAME");
  const address = parseAddress(env.STUDYOS_OPERATOR_ADDRESS);
  if (!name || address.length === 0) return null;
  const email = env.STUDYOS_OPERATOR_EMAIL?.trim();
  return {
    name,
    address,
    email: isPlausibleEmail(email) ? email : supportEmail(env),
    phone: text(env, "STUDYOS_OPERATOR_PHONE"),
    register: text(env, "STUDYOS_OPERATOR_REGISTER"),
    vatId: text(env, "STUDYOS_OPERATOR_VAT_ID"),
    responsible: text(env, "STUDYOS_OPERATOR_RESPONSIBLE"),
  };
}

/** True when /legal-notice exists: a name and a postal address are set. */
export function legalNoticeConfigured(env: Env = process.env): boolean {
  return operatorDetails(env) !== null;
}

/** "tel:" target for a phone number as written ("+49 30 1234-567" → "tel:+49301234567"). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
