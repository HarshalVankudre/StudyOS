import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { eraseUserData } from "@/lib/account/erase-user-data";
import { markAccountDeleted, stopBillingForDeletedAccount } from "@/lib/billing";
import { reportError } from "@/lib/ops/report-error";
import { isBillingConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clerk → us. When an account is deleted from Clerk's own UI (user profile or
 * dashboard), stop its billing and erase that user's StudyOS data. Register
 * this URL in the Clerk dashboard (Webhooks) with the `user.deleted` event
 * and put the endpoint's signing secret in CLERK_WEBHOOK_SIGNING_SECRET.
 * The secret is optional for starting the server: without it this route stays
 * off (404, or 503 plus a reported error once billing is live so the failed
 * deliveries show in Clerk), and the startup log and the operator view of
 * /api/health warn that accounts deleted from Clerk's own profile screen keep
 * their data and subscription (lib/ops/env.ts).
 *
 * The Svix signature (id + timestamp + body, 5-minute tolerance) is verified by
 * Clerk's own verifyWebhook. Every step is idempotent, so Clerk's retries and
 * the webhook fired by our in-app delete are harmless.
 */
export async function POST(req: Request) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    if (!isBillingConfigured()) return new Response("Not found", { status: 404 });
    // Billing is live but deletions in Clerk cannot be verified: fail loudly
    // (Clerk shows failed deliveries and retries; the error is reported).
    reportError(new Error("CLERK_WEBHOOK_SIGNING_SECRET is not set while billing is on"), {
      source: "api",
      route: "/api/clerk/webhook",
      method: "POST",
    });
    return new Response("Webhook not configured", { status: 503 });
  }

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

  try {
    // Tombstone first (nothing can be granted or recreated from here on); it
    // also queues the billing cancellation with the Stripe ids, so erasing
    // the rows below can never lose track of a live subscription.
    await markAccountDeleted(userId);
    // Cancel now if Stripe answers; if not, the queued job is retried by the
    // maintenance run until it succeeds (and any charge meanwhile is refunded,
    // since the account is tombstoned).
    const billingStopped = await stopBillingForDeletedAccount(userId);
    await eraseUserData(userId);
    // A non-2xx makes Clerk retry soon as well.
    if (!billingStopped) return new Response("Billing cancel queued", { status: 503 });
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
