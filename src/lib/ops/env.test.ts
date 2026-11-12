import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ENV_VARS,
  MissingEnvironmentError,
  checkEnvironment,
  formatStartupSummary,
  publicConfigStatus,
  remoteAssetImagesAvailable,
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
  FEED_URL_KEY: "feed-key-secretvalue",
};

describe("environment validation", () => {
  it("documents every variable once", () => {
    const names = ENV_VARS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("STRIPE_PRICE_PRO_ANNUAL");
  });

  it("lists every registered variable in .env.example", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const listed = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
    expect(ENV_VARS.map((v) => v.name).filter((name) => !listed.has(name))).toEqual([]);
  });

  it("passes with the required variables set", () => {
    const report = checkEnvironment(BASE);
    expect(report.missingRequired).toEqual([]);
    expect(report.features.ai.enabled).toBe(true);
    expect(report.features.billing.enabled).toBe(false);
  });

  it("refuses to start only without what the app cannot run without at all", () => {
    for (const name of ["DATABASE_URL", "CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "OPENROUTER_API_KEY"]) {
      expect(checkEnvironment({ ...BASE, [name]: "" }).missingRequired).toEqual([name]);
      expect(() => validateEnvironmentOnStartup({ ...BASE, [name]: "" }, () => {})).toThrow(MissingEnvironmentError);
    }
    expect(ENV_VARS.filter((v) => v.required === "always").map((v) => v.name).sort()).toEqual([
      "CLERK_SECRET_KEY",
      "DATABASE_URL",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    ]);
  });

  it("starts without FEED_URL_KEY, with calendar links switched off and a warning", () => {
    const env = { ...BASE, FEED_URL_KEY: "" };
    const report = checkEnvironment(env);
    expect(report.missingRequired).toEqual([]);
    expect(report.features.feedLinks.enabled).toBe(false);
    expect(report.warnings.join(" ")).toMatch(/FEED_URL_KEY is not set, so connecting calendar links is OFF/);
    expect(() => validateEnvironmentOnStartup(env, () => {})).not.toThrow();
    // Development keeps working with links stored encoded only.
    expect(checkEnvironment({ ...env, NODE_ENV: "development" }).features.feedLinks.enabled).toBe(true);
    expect(checkEnvironment(BASE).features.feedLinks.enabled).toBe(true);
  });

  it("starts with a build whose image CSP does not match the bucket, with remote asset images off", () => {
    const built = (assetsBucket: string | undefined) => ({ assetsBucket });
    const mismatches = [
      [{ ...BASE, ASSETS_BUCKET: "studyos-assets" }, built("")],
      [{ ...BASE, AGENT_SANDBOX: "1", ASSETS_BUCKET: "b1" }, built("")],
      [{ ...BASE, ASSETS_BUCKET: "studyos-assets" }, built("other")],
    ] as const;
    for (const [env, build] of mismatches) {
      const report = checkEnvironment(env, build);
      expect(report.missingRequired).toEqual([]);
      expect(report.features.assets.enabled).toBe(false);
      expect(report.features.sandbox.enabled).toBe(false);
      expect(report.warnings.join(" ")).toMatch(/remote asset images and the render sandbox are OFF/);
      expect(remoteAssetImagesAvailable(env, build)).toBe(false);
      expect(() => validateEnvironmentOnStartup(env, () => {}, build)).not.toThrow();
    }
    // Matching build, development, or not a production build: images on.
    expect(remoteAssetImagesAvailable({ ...BASE, ASSETS_BUCKET: "studyos-assets" }, built("studyos-assets"))).toBe(true);
    expect(remoteAssetImagesAvailable({ ...BASE, NODE_ENV: "development", ASSETS_BUCKET: "b1" }, built(""))).toBe(true);
    expect(remoteAssetImagesAvailable({ ...BASE, ASSETS_BUCKET: "b1" }, built(undefined))).toBe(true);
    expect(remoteAssetImagesAvailable(BASE, built(""))).toBe(false); // no bucket at all
    expect(checkEnvironment(BASE, built("")).warnings.join(" ")).not.toMatch(/render sandbox are OFF/);
  });

  it("prints the warnings as one delimited block at the end of the summary", () => {
    const summary = formatStartupSummary(checkEnvironment({ ...BASE, FEED_URL_KEY: "" }));
    const lines = summary.split("\n");
    const header = lines.findIndex((l) => l.includes("[StudyOS] WARNINGS"));
    expect(header).toBeGreaterThan(0);
    expect(lines[header - 1]).toMatch(/^=+$/);
    expect(lines[lines.length - 1]).toMatch(/^=+$/);
    // Every feature line comes before the block; nothing else follows it.
    expect(lines.slice(header).some((l) => /^ {2}feedLinks: /.test(l))).toBe(false);
    expect(lines.slice(header + 1, -1).every((l) => /^ {2}\d+\. /.test(l))).toBe(true);
    // No block when there is nothing to warn about.
    expect(formatStartupSummary(checkEnvironment({ ...BASE, NODE_ENV: "development" }))).not.toContain("WARNINGS");
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

  it("starts without the Clerk webhook secret, warning that Clerk-side deletions keep data and subscription", () => {
    const billing = {
      ...BASE,
      STRIPE_SECRET_KEY: "sk_live_abc",
      STRIPE_PRICE_PRO: "price_1",
      STRIPE_WEBHOOK_SECRET: "whsec_1",
    };
    const report = checkEnvironment(billing);
    expect(report.missingRequired).toEqual([]);
    expect(report.features.clerkWebhook.enabled).toBe(false);
    expect(report.warnings[0]).toMatch(/CLERK_WEBHOOK_SIGNING_SECRET is not set, so \/api\/clerk\/webhook is OFF/);
    expect(report.warnings[0]).toMatch(/Clerk's own profile screen KEEP THEIR STUDYOS DATA AND THEIR SUBSCRIPTION KEEPS BILLING/);
    expect(() => validateEnvironmentOnStartup(billing, () => {})).not.toThrow();
    expect(checkEnvironment({ ...billing, CLERK_WEBHOOK_SIGNING_SECRET: "whsec_c" }).warnings.join(" ")).not.toMatch(
      /CLERK_WEBHOOK_SIGNING_SECRET/,
    );
    // Without billing it warns about the data.
    expect(checkEnvironment(BASE).missingRequired).toEqual([]);
    expect(checkEnvironment(BASE).warnings.join(" ")).toMatch(/profile screen KEEP THEIR STUDYOS DATA/);
  });

  it("exposes only names and booleans in the public status", () => {
    const status = publicConfigStatus({ ...BASE, STRIPE_SECRET_KEY: "sk_live_abc", OPENROUTER_API_KEY: "" });
    const json = JSON.stringify(status);
    expect(status.ok).toBe(false);
    expect(status.missingRequired).toEqual(["OPENROUTER_API_KEY"]);
    expect(json).not.toContain("sk_live_abc");
    expect(json).not.toContain("sk_test_secretvalue");
    expect(typeof status.features.billing).toBe("boolean");
    // Warnings are listed as texts (names only, never values).
    expect(Array.isArray(status.warnings)).toBe(true);
    const degraded = publicConfigStatus({ ...BASE, FEED_URL_KEY: "" });
    expect(degraded.ok).toBe(true);
    expect(degraded.features.feedLinks).toBe(false);
    expect(degraded.warnings.join(" ")).toMatch(/FEED_URL_KEY/);
    expect(JSON.stringify(degraded)).not.toContain("sk-or-secretvalue");
  });
});
