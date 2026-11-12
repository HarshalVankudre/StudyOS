// @vitest-environment node
/**
 * Integration test against a real Postgres: proves chargeCredits is atomic
 * under concurrency (row lock), which an in-memory fake cannot show.
 *
 * Opt-in, because CI has no database:
 *   STUDYOS_DB_TESTS=1 with DATABASE_URL pointing at a THROWAWAY database
 *   (e.g. the local one on :54329), then
 *   npx pnpm@10 exec vitest run src/lib/credits.db.test.ts
 * It only touches rows for its own random test user and removes them after.
 */
import { afterAll, describe, expect, it } from "vitest";

const enabled = process.env.STUDYOS_DB_TESTS === "1";

describe.skipIf(!enabled)("credits on Postgres", () => {
  const userId = `dbtest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.creditLedger.deleteMany({ where: { userId } });
    await prisma.creditAccount.deleteMany({ where: { userId } });
    await prisma.subscription.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  });

  it("40 concurrent charges never drive the balance negative or over-charge", async () => {
    const { prisma } = await import("@/lib/db");
    const { chargeCredits, getCreditBalance, FREE_SIGNUP_CREDITS } = await import("./credits");
    expect(await getCreditBalance(userId)).toBe(FREE_SIGNUP_CREDITS);

    const charged = await Promise.all(
      Array.from({ length: 40 }, () => chargeCredits(userId, 13, "agent")),
    );

    const total = charged.reduce((a, b) => a + b, 0);
    const account = await prisma.creditAccount.findUnique({ where: { userId } });
    const ledger = await prisma.creditLedger.aggregate({
      _sum: { delta: true },
      where: { userId },
    });
    expect(total).toBe(FREE_SIGNUP_CREDITS); // 40 × 13 = 520 asked, 300 available
    expect(account?.balance).toBe(0);
    expect(ledger._sum.delta).toBe(0); // ledger and balance agree
  }, 60_000);

  it("a keyed clawback applied concurrently happens once", async () => {
    const { prisma } = await import("@/lib/db");
    const { debitCredits, grantCredits } = await import("./credits");
    await grantCredits(userId, 500, "test");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        debitCredits(userId, 200, "credit_reversal", `dbtest_clawback:${userId}`),
      ),
    );
    expect(results.filter((r) => r > 0)).toEqual([200]);
    const account = await prisma.creditAccount.findUnique({ where: { userId } });
    expect(account?.balance).toBe(300);
  }, 60_000);
});
