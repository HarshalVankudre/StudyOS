import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { eraseUserData } from "@/lib/account/erase-user-data";
import { cancelAllBillingForUser, markAccountDeleted } from "@/lib/billing";
import { reportError } from "@/lib/ops/report-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clerk → us. When an account is deleted from Clerk's own UI (user profile or
 * dashboard), erase that user's StudyOS data. Register this URL in the Clerk
 * dashboard (Webhooks) with the `user.deleted` event and put the endpoint's
 * signing secret in CLERK_WEBHOOK_SIGNING_SECRET.
 *
 * The Svix signature (id + timestamp + body, 5-minute tolerance) is verified by
 * Clerk's own verifyWebhook. Erasure is idempotent, so Clerk's retries and the
 * webhook fired by our in-app delete are harmless.
 */
export async function POST(req: Request) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) return new Response("Not found", { status: 404 });

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    // NextRequest is a Request subclass; verifyWebhook only reads headers + body.
    event = await verifyWebhook(req as NextRequest, { signingSecret });
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type !== "user.deleted") return new Response("ignored", { status: 200 });

  const userId = event.data.id;
  if (!userId) return new Response("ignored", { status: 200 });

  // Same order as the in-app deleteAccountAction: stop billing, erase, tombstone.
  try {
    await cancelAllBillingForUser(userId);
  } catch {
    // Billing may still be live: keep the row that maps to it. A non-2xx makes
    // Clerk retry with backoff.
    return new Response("Billing cancel failed", { status: 503 });
  }
  try {
    await eraseUserData(userId);
    await markAccountDeleted(userId);
    return new Response("ok", { status: 200 });
  } catch (error) {
    reportError(error, {
      source: "api",
      route: "/api/clerk/webhook",
      method: "POST",
      eventType: event.type,
      userId,
    });
    return new Response("Erasure failed", { status: 500 });
  }
}
