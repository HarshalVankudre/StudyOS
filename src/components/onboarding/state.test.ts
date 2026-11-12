import { beforeEach, describe, expect, it, vi } from "vitest";
import { installHintMode } from "./InstallHint";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  createMany: vi.fn(),
  change: vi.fn(),
  aggregate: vi.fn(),
  token: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    usageEvent: { findMany: mocks.findMany, findFirst: mocks.findFirst, create: mocks.create, createMany: mocks.createMany },
    workspaceChange: { findFirst: mocks.change },
    studyDay: { aggregate: mocks.aggregate },
    calendarToken: { findUnique: mocks.token },
  },
}));

import { getOnboardingState, markOnboardingItem, setOnboardingDismissed } from "./state";

beforeEach(() => {
  mocks.findMany.mockResolvedValue([]);
  mocks.findFirst.mockResolvedValue(null);
  mocks.create.mockResolvedValue({});
  mocks.createMany.mockResolvedValue({ count: 0 });
  mocks.change.mockResolvedValue(null);
  mocks.aggregate.mockResolvedValue({ _sum: { reviews: 0, practice: 0 } });
  mocks.token.mockResolvedValue(null);
});

describe("onboarding state (server)", () => {
  it("reads only the user's own milestones", async () => {
    await getOnboardingState("user_1");
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ userId: "user_1", kind: { startsWith: "evt:onboarding:" } });
    expect(mocks.change.mock.calls[0][0].where).toEqual({ ownerId: "user_1", kind: "agent" });
    expect(mocks.aggregate.mock.calls[0][0].where).toEqual({ userId: "user_1" });
    expect(mocks.token.mock.calls[0][0].where).toEqual({ userId: "user_1" });
  });

  it("derives items from real activity and records them", async () => {
    mocks.change.mockResolvedValue({ id: "c" });
    mocks.aggregate.mockResolvedValue({ _sum: { reviews: 2, practice: 1 } });
    mocks.token.mockResolvedValue({ userId: "user_1" });
    const state = await getOnboardingState("user_1");
    expect(state).toEqual({ done: ["askAi", "study", "calendar"], dismissed: false });
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user_1", kind: "evt:onboarding:askAi" },
        { userId: "user_1", kind: "evt:onboarding:study" },
        { userId: "user_1", kind: "evt:onboarding:calendar" },
      ],
    });
  });

  it("needs a few cards, not one", async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { reviews: 2, practice: 0 } });
    expect((await getOnboardingState("u")).done).toEqual([]);
  });

  it("skips derivation for items already recorded", async () => {
    mocks.findMany.mockResolvedValue(
      ["checkOff", "askAi", "study", "deadlines", "calendar"].map((i) => ({ kind: `evt:onboarding:${i}`, createdAt: new Date(1) })),
    );
    const state = await getOnboardingState("u");
    expect(state.done).toHaveLength(5);
    expect(mocks.change).not.toHaveBeenCalled();
  });

  it("records an item once", async () => {
    await markOnboardingItem("u", "checkOff");
    expect(mocks.create).toHaveBeenCalledWith({ data: { userId: "u", kind: "evt:onboarding:checkOff" } });
    mocks.create.mockClear();
    mocks.findFirst.mockResolvedValue({ id: "x" });
    await markOnboardingItem("u", "checkOff");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("records dismiss and restore", async () => {
    await setOnboardingDismissed("u", true);
    await setOnboardingDismissed("u", false);
    expect(mocks.create.mock.calls.map((c) => c[0].data.kind)).toEqual([
      "evt:onboarding:dismissed",
      "evt:onboarding:restored",
    ]);
  });
});

describe("installHintMode", () => {
  const env = { standalone: false, phone: true, ios: false, dismissed: false, visits: 2, canPrompt: true };
  it("shows the install button on a phone that can install", () => {
    expect(installHintMode(env)).toBe("prompt");
    expect(installHintMode({ ...env, canPrompt: false, ios: true })).toBe("ios");
  });
  it("stays quiet otherwise", () => {
    expect(installHintMode({ ...env, visits: 1 })).toBeNull();
    expect(installHintMode({ ...env, phone: false })).toBeNull();
    expect(installHintMode({ ...env, standalone: true })).toBeNull();
    expect(installHintMode({ ...env, dismissed: true })).toBeNull();
    expect(installHintMode({ ...env, canPrompt: false })).toBeNull();
  });
});
