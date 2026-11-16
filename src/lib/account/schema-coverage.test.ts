// @vitest-environment node
// Every model in prisma/schema.prisma must be both exported (GDPR access) and
// erased (account deletion), or be listed as a deliberate exception with its
// reason. A table added later without either fails here, not in production.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ byModel: new Map<string, { method: string; args: unknown }[]>() }));

/** A Prisma stand-in that accepts any model and records every call by model. */
vi.mock("@/lib/db", () => {
  const delegate = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async (args: unknown) => {
          const list = calls.byModel.get(model) ?? [];
          list.push({ method, args });
          calls.byModel.set(model, list);
          if (method === "findUnique" || method === "findFirst") return null;
          if (method === "findMany") return [];
          if (method === "count") return 0;
          return { count: 0 };
        },
      },
    );
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === "$transaction") return async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops);
        if (key === "$queryRaw") return async () => [];
        return delegate(key);
      },
    },
  );
  return { prisma };
});
vi.mock("@/lib/assets/storage", () => ({ gcsAssetStore: () => ({ delete: async () => {} }) }));

import { buildUserDataExport, EXPORT_EXCLUDED_MODELS } from "./export-user-data";
import { eraseUserData, ERASURE_KEPT_MODELS } from "./erase-user-data";

const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]);
const delegateOf = (model: string) => model[0].toLowerCase() + model.slice(1);

beforeEach(() => calls.byModel.clear());

describe("every database model is covered by export and erasure", () => {
  it("finds the schema's models", () => {
    expect(models).toEqual(expect.arrayContaining(["Workspace", "AgentChatMessage", "CreditHold", "CalendarFeed"]));
  });

  it("the export reads every model except the documented exclusions, scoped to the user", async () => {
    await buildUserDataExport("user_1");
    const missing = models.filter(
      (model) =>
        !(EXPORT_EXCLUDED_MODELS as readonly string[]).includes(model) &&
        !(calls.byModel.get(delegateOf(model)) ?? []).some((c) => c.method.startsWith("find")),
    );
    expect(missing).toEqual([]);
    for (const [, list] of calls.byModel) {
      for (const { args } of list) {
        const where = (args as { where?: Record<string, unknown> }).where ?? {};
        // An invite is the student's as the inviter or as the invited friend.
        expect(where.userId ?? where.ownerId ?? where.referrerId ?? where.refereeId).toBe("user_1");
      }
    }
  });

  it("the erasure deletes from every model except the documented keepers, scoped to the user", async () => {
    await eraseUserData("user_1");
    const missing = models.filter(
      (model) =>
        !(ERASURE_KEPT_MODELS as readonly string[]).includes(model) &&
        !(calls.byModel.get(delegateOf(model)) ?? []).some((c) => c.method === "deleteMany"),
    );
    expect(missing).toEqual([]);
    for (const [, list] of calls.byModel) {
      for (const { method, args } of list) {
        if (method !== "deleteMany" && method !== "updateMany") continue;
        const where = (args as { where: Record<string, unknown> }).where;
        // A row owned through its parent (a share report through its share) is scoped by the parent's owner.
        const parent = where.share as { userId?: unknown } | undefined;
        // A row with two parties (an invite: inviter OR friend) is scoped on every branch.
        const either = where.OR as Record<string, unknown>[] | undefined;
        if (either) {
          expect(either.length).toBeGreaterThan(0);
          for (const branch of either) expect(branch.referrerId ?? branch.refereeId).toBe("user_1");
          continue;
        }
        // An invite the user made goes (referrerId); one they came through is anonymised (refereeId).
        expect(where.userId ?? where.ownerId ?? where.referrerId ?? where.refereeId ?? parent?.userId).toBe("user_1");
      }
    }
  });

  it("an invite the user came through is anonymised, never kept naming them", async () => {
    await eraseUserData("user_1");
    const referral = calls.byModel.get("referral") ?? [];
    expect(referral).toContainEqual({ method: "deleteMany", args: { where: { referrerId: "user_1" } } });
    expect(referral).toContainEqual({
      method: "updateMany",
      args: { where: { refereeId: "user_1" }, data: { refereeId: null } },
    });
    // The mailbox register holds no user id, so there is nothing of theirs to erase.
    expect(ERASURE_KEPT_MODELS).toContain("ReferralMailbox");
    expect(calls.byModel.get("referralMailbox")).toBeUndefined();
  });

  it("withdrawal and cancellation notices are exported, and kept unlinked (legal records) on erasure", async () => {
    await buildUserDataExport("user_1");
    expect(calls.byModel.get("contractNotice")).toContainEqual(
      expect.objectContaining({ method: "findMany", args: expect.objectContaining({ where: { userId: "user_1" } }) }),
    );
    calls.byModel.clear();
    await eraseUserData("user_1");
    expect(ERASURE_KEPT_MODELS).toContain("ContractNotice");
    expect(calls.byModel.get("contractNotice")).toEqual([
      { method: "updateMany", args: { where: { userId: "user_1" }, data: { userId: null } } },
    ]);
  });

  it("agent chat messages are read a page at a time, like the other large collections", async () => {
    await buildUserDataExport("user_1");
    const reads = calls.byModel.get("agentChatMessage") ?? [];
    // Ids are listed first (cheap); with no messages, no page is loaded.
    expect(reads).toHaveLength(1);
    expect((reads[0].args as { select: unknown }).select).toEqual({ id: true });
  });
});
