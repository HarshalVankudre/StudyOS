import { describe, expect, it, vi } from "vitest";
import {
  ENV_VARS,
  MissingEnvironmentError,
  checkEnvironment,
  publicConfigStatus,
  requiredAiKeys,
  validateEnvironmentOnStartup,
} from "./env";

const BASE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@h/db",
  CLERK_SECRET_KEY: "sk_test_secretvalue",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
  STUDYOS_FREE_MODEL: "z-ai/glm-5.2",
  STUDYOS_PRO_MODEL: "z-ai/glm-5.2",
  OPENROUTER_API_KEY: "sk-or-secretvalue",
};

describe("environment validation", () => {
  it("documents every variable once", () => {
    const names = ENV_VARS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("passes with the required variables set", () => {
    const report = checkEnvironment(BASE);
    expect(report.missingRequired).toEqual([]);
    expect(report.features.ai.enabled).toBe(true);
    expect(report.features.billing.enabled).toBe(false);
  });

  it("requires the AI key of the provider each model uses", () => {
    expect(requiredAiKeys({ STUDYOS_FREE_MODEL: "claude-haiku-5-5", STUDYOS_PRO_MODEL: "z-ai/glm-5.2" }).sort()).toEqual([
      "ANTHROPIC_API_KEY",
      "OPENROUTER_API_KEY",
    ]);
    const report = checkEnvironment({ ...BASE, STUDYOS_PRO_MODEL: "claude-haiku-5-5" });
    expect(report.missingRequired).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("warns about half-configured billing", () => {
    const report = checkEnvironment({ ...BASE, STRIPE_SECRET_KEY: "sk_live_abc" });
    expect(report.warnings.join(" ")).toMatch(/STRIPE_PRICE_PRO/);
  });

  it("throws in production when a required variable is missing, and logs no values", () => {
    const log = vi.fn();
    const env = { ...BASE, CLERK_SECRET_KEY: "" };
    expect(() => validateEnvironmentOnStartup(env, log)).toThrow(MissingEnvironmentError);
    const logged = log.mock.calls.flat().join("\n");
    expect(logged).toContain("CLERK_SECRET_KEY");
    expect(logged).not.toContain("sk-or-secretvalue");
    expect(logged).not.toContain("postgresql://");
  });

  it("does not throw outside production or with the explicit escape hatch", () => {
    const env = { ...BASE, DATABASE_URL: "" };
    expect(() => validateEnvironmentOnStartup({ ...env, NODE_ENV: "development" }, () => {})).not.toThrow();
    expect(() =>
      validateEnvironmentOnStartup({ ...env, STUDYOS_ALLOW_INCOMPLETE_ENV: "1" }, () => {}),
    ).not.toThrow();
  });

  it("exposes only names and booleans in the public status", () => {
    const status = publicConfigStatus({ ...BASE, STRIPE_SECRET_KEY: "sk_live_abc", OPENROUTER_API_KEY: "" });
    const json = JSON.stringify(status);
    expect(status.ok).toBe(false);
    expect(status.missingRequired).toEqual(["OPENROUTER_API_KEY"]);
    expect(json).not.toContain("sk_live_abc");
    expect(json).not.toContain("sk_test_secretvalue");
    expect(typeof status.features.billing).toBe("boolean");
  });
});
