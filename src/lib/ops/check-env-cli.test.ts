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

  it("keeps the STUDYOS_ALLOW_INCOMPLETE_ENV escape hatch and never blocks development", () => {
    const env = { ...COMPLETE, DATABASE_URL: "" };
    expect(runEnvironmentCheck({ ...env, STUDYOS_ALLOW_INCOMPLETE_ENV: "1" }, vi.fn(), vi.fn())).toBe(0);
    expect(runEnvironmentCheck({ ...env, NODE_ENV: "development" }, vi.fn(), vi.fn())).toBe(0);
  });
});
