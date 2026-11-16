/**
 * Browser side of email reminders: the "Also send reminders by email" switch
 * and "Send a test email". No React here (see push-client.ts for push).
 */
import type { EmailSettingsView } from "@/lib/notifications/service";

const EMAIL_URL = "/api/notifications/email";
const TEST_URL = "/api/notifications/test";

export type EmailSwitchOutcome =
  | { ok: true; email: EmailSettingsView }
  | { ok: false; reason: "no_address" | "unverified" | "unavailable" | "failed" };

/** Turn email on or off for the signed-in student (the device's zone and language come along). */
export async function setEmailEnabled(
  enabled: boolean,
  context: { timeZone?: string; locale?: string },
): Promise<EmailSwitchOutcome> {
  try {
    const res = await fetch(EMAIL_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, ...context }),
    });
    const json = (await res.json().catch(() => ({}))) as { email?: EmailSettingsView; error?: unknown };
    if (res.ok && json.email) return { ok: true, email: json.email };
    if (json.error === "no_address" || json.error === "unverified" || json.error === "unavailable") {
      return { ok: false, reason: json.error };
    }
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function sendTestEmail(): Promise<"sent" | "failed" | "limited"> {
  try {
    const res = await fetch(TEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "email" }),
    });
    if (res.status === 429) return "limited";
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return res.ok && json.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
