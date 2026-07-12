import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  setSubscription: vi.fn(),
  grantCredits: vi.fn(),
  recordFunnelEvent: vi.fn(),
  subFindFirst: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructEvent } },
}));
vi.mock("@/lib/billing", () => ({ setSubscription: mocks.setSubscription }));
vi.mock("@/lib/credits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/credits")>();
  return {
    ...actual,
    grantCredits: mocks.grantCredits,
  };
});
vi.mock("@/lib/usage-limits", () => ({
  recordFunnelEvent: mocks.recordFunnelEvent,
}));
vi.mock("@/lib/db", () => ({
  prisma: { subscription: { findFirst: mocks.subFindFirst } },
}));

import { POST } from "./route";
import { PRO_MONTHLY_CREDITS } from "@/lib/credits";

function request(body = "{}") {
  return new Request("http://test/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body,
  });
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.subFindFirst.mockResolvedValue(null);
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

describe("stripe webhook", () => {
  it("rejects an invalid signature", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("bad sig");
    });
    const res = await POST(request());
    expect(res.status).toBe(400);
  });

  it("grants monthly Pro credits on invoice.paid (metadata userId)", async () => {
    mocks.constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: {
        object: {
          id: "in_123",
          parent: {
            subscription_details: {
              metadata: { userId: "user_1" },
              subscription: "sub_9",
            },
          },
        },
      },
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mocks.grantCredits).toHaveBeenCalledWith(
      "user_1",
      PRO_MONTHLY_CREDITS,
      "pro_monthly",
      "pro_grant:in_123",
    );
    expect(mocks.setSubscription).toHaveBeenCalledWith("user_1", {
      status: "active",
      stripeSubscriptionId: "sub_9",
    });
  });

  it("resolves the user by subscription id when metadata is missing", async () => {
    mocks.subFindFirst.mockResolvedValue({ userId: "user_2" });
    mocks.constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: {
        object: {
          id: "in_456",
          parent: {
            subscription_details: { metadata: null, subscription: "sub_7" },
          },
        },
      },
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mocks.subFindFirst).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: "sub_7" },
    });
    expect(mocks.grantCredits).toHaveBeenCalledWith(
      "user_2",
      PRO_MONTHLY_CREDITS,
      "pro_monthly",
      "pro_grant:in_456",
    );
  });

  it("grants on the legacy pre-Basil invoice shape (top-level subscription)", async () => {
    // Older webhook API versions have no invoice.parent; the subscription is
    // top-level. A paying Pro user must still get credits.
    mocks.constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: {
        object: {
          id: "in_legacy",
          parent: null,
          subscription: "sub_legacy",
          subscription_details: { metadata: { userId: "user_5" } },
        },
      },
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mocks.grantCredits).toHaveBeenCalledWith(
      "user_5",
      PRO_MONTHLY_CREDITS,
      "pro_monthly",
      "pro_grant:in_legacy",
    );
  });

  it("returns 500 (Stripe will retry) when the subscription is unknown", async () => {
    mocks.constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: {
        object: {
          id: "in_789",
          parent: {
            subscription_details: { metadata: null, subscription: "sub_x" },
          },
        },
      },
    });
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(mocks.grantCredits).not.toHaveBeenCalled();
  });

  it("ignores invoices unrelated to subscriptions", async () => {
    mocks.constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: { object: { id: "in_solo", parent: null } },
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mocks.grantCredits).not.toHaveBeenCalled();
  });

  it("checkout completion sets Pro status but does NOT grant (invoice.paid does)", async () => {
    mocks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          mode: "subscription",
          client_reference_id: "user_1",
          customer: "cus_1",
          subscription: "sub_1",
        },
      },
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mocks.setSubscription).toHaveBeenCalledWith("user_1", {
      status: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    expect(mocks.grantCredits).not.toHaveBeenCalled();
  });

  it("grants purchased credit packs on checkout completion", async () => {
    mocks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_2",
          mode: "payment",
          client_reference_id: "user_1",
          metadata: { kind: "credits", credits: "1000" },
        },
      },
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mocks.grantCredits).toHaveBeenCalledWith(
      "user_1",
      1000,
      "credit_purchase",
      "credit_purchase:cs_2",
    );
  });

  it("marks the subscription canceled on deletion", async () => {
    mocks.constructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_1",
          status: "canceled",
          metadata: { userId: "user_1" },
        },
      },
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mocks.setSubscription).toHaveBeenCalledWith("user_1", {
      status: "canceled",
      stripeSubscriptionId: "sub_1",
    });
  });
});
