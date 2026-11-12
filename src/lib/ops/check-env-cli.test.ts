import { describe, expect, it, vi } from "vitest";
import { runEnvironmentCheck } from "./check-env-cli";

const COMPLETE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@h/db",
  CLERK_SECRET_KEY: "sk_test_secretvalue",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
  STUDYOS_FREE_MODEL: "z-ai/glm-5.2",
  STUDYOS_PRO_MODEL: "z-ai/glm-5.2",
  OPENROUTER_API_KEY: "sk-or-secretvalue",
  FEED_URL_KEY: "feed-url-key-value-1234567890abcdef",
};

describe("container startup configuration check", () => {
  it("exits 0 when production configuration is complete", () => {
    const log = vi.fn();
    expect(runEnvironmentCheck(COMPLETE, log, vi.fn())).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain("required: ok");
  });

  it("exits 1 (before the server listens) when a required variable is missing", () => {
    const logError = vi.fn();
    expect(runEnvironmentCheck({ ...COMPLETE, DATABASE_URL: "" }, vi.fn(), logError)).toBe(1);
    expect(logError.mock.calls.flat().join("\n")).toMatch(/refusing to start.*DATABASE_URL/);
    expect(logError.mock.calls.flat().join("\n")).not.toContain("sk-or-secretvalue");
  });

  it("exits 0 when only optional secrets are missing, ending the log with one warnings block", () => {
    const log = vi.fn();
    const env = { ...COMPLETE, FEED_URL_KEY: "", STRIPE_SECRET_KEY: "sk_live_x", STRIPE_PRICE_PRO: "price_1", STRIPE_WEBHOOK_SECRET: "whsec_1" };
    expect(runEnvironmentCheck(env, log, vi.fn())).toBe(0);
    const out = log.mock.calls.flat().join("\n");
    expect(out).toContain("required: ok");
    const block = out.slice(out.indexOf("[StudyOS] WARNINGS"));
    expect(block).toMatch(/CLERK_WEBHOOK_SIGNING_SECRET is not set/);
    expect(block).toMatch(/FEED_URL_KEY is not set/);
    expect(out.trimEnd().split("\n").at(-1)).toMatch(/^=+$/);
    expect(out).not.toContain("sk_live_x");
  });

  it("exits 1 when the AI key for the configured model is missing", () => {
    const logError = vi.fn();
    expect(runEnvironmentCheck({ ...COMPLETE, STUDYOS_PRO_MODEL: "claude-haiku-5-5" }, vi.fn(), logError)).toBe(1);
    expect(logError.mock.calls.flat().join("\n")).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("keeps the STUDYOS_ALLOW_INCOMPLETE_ENV escape hatch and never blocks development", () => {
    const env = { ...COMPLETE, DATABASE_URL: "" };
    expect(runEnvironmentCheck({ ...env, STUDYOS_ALLOW_INCOMPLETE_ENV: "1" }, vi.fn(), vi.fn())).toBe(0);
    expect(runEnvironmentCheck({ ...env, NODE_ENV: "development" }, vi.fn(), vi.fn())).toBe(0);
  });
});
