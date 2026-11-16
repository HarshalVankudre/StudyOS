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
    // The operator console's allow-list: optional (nobody is admin without it).
    expect(ENV_VARS.find((v) => v.name === "STUDYOS_ADMIN_USER_IDS")).toMatchObject({ required: false, secret: false });
  });

  it("lists every registered variable in .env.example", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const listed = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
    expect(ENV_VARS.map((v) => v.name).filter((name) => !listed.has(name))).toEqual([]);
  });

  it("warns in production, without failing, while the legal notice is not configured", () => {
    const legal = (env: Record<string, string>) => checkEnvironment(env).warnings.filter((w) => /legal notice/.test(w));
    expect(checkEnvironment(BASE).missingRequired).toEqual([]);
    expect(legal(BASE)).toEqual([
      expect.stringMatching(/^STUDYOS_OPERATOR_NAME and STUDYOS_OPERATOR_ADDRESS are not both set.*Impressum, § 5 DDG/),
    ]);
    expect(legal({ ...BASE, STUDYOS_OPERATOR_NAME: "Example GmbH" })).toHaveLength(1);
    expect(legal({ ...BASE, STUDYOS_OPERATOR_NAME: "Example GmbH", STUDYOS_OPERATOR_ADDRESS: "Musterstraße 1|10115 Berlin" })).toEqual([]);
    expect(legal({ ...BASE, NODE_ENV: "development" })).toEqual([]);
    const operator = ENV_VARS.filter((v) => v.name.startsWith("STUDYOS_OPERATOR_"));
    expect(operator.map((v) => v.name)).toHaveLength(7);
    for (const v of operator) expect(v).toMatchObject({ required: false, secret: false });
  });

  it("warns in production when the public app URL still points at this machine", () => {
    const local = (vars: Record<string, string>) =>
      checkEnvironment({ ...BASE, ...vars }).warnings.filter((w) => /local address/.test(w));
    expect(local({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toEqual([
      expect.stringMatching(/^NEXT_PUBLIC_APP_URL points at http:\/\/localhost:3000.*rebuild/),
    ]);
    expect(local({ APP_URL: "http://127.0.0.1:8080/" })).toHaveLength(1);
    expect(local({ APP_URL: "http://[::1]:3000", NEXT_PUBLIC_APP_URL: "0.0.0.0:3000" })).toHaveLength(2);
    expect(local({ APP_URL: "https://studyos.app", NEXT_PUBLIC_APP_URL: "https://studyos.app" })).toEqual([]);
    // A host that merely contains the word is fine.
    expect(local({ APP_URL: "https://localhost-tools.example.com" })).toEqual([]);
    // Development runs on localhost by design.
    expect(
      checkEnvironment({ ...BASE, NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:3000" }).warnings.some((w) =>
        /local address/.test(w),
      ),
    ).toBe(false);
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

  it("the website deployment (STUDYOS_APP_ORIGIN set) needs the auth keys but no database or AI key", () => {
    const website = { ...BASE, STUDYOS_APP_ORIGIN: "https://app.example.com", DATABASE_URL: "", OPENROUTER_API_KEY: "" };
    expect(checkEnvironment(website).missingRequired).toEqual([]);
    expect(checkEnvironment({ ...website, CLERK_SECRET_KEY: "" }).missingRequired).toEqual(["CLERK_SECRET_KEY"]);
    // Without the setting the same environment is refused, as before.
    expect(checkEnvironment({ ...website, STUDYOS_APP_ORIGIN: "" }).missingRequired).toEqual([
      "DATABASE_URL",
      "OPENROUTER_API_KEY",
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

  it("warns when billing is on without email: withdrawal and cancellation acknowledgements cannot be emailed", () => {
    const billing = { ...BASE, STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_PRICE_PRO: "price_1", STRIPE_WEBHOOK_SECRET: "whsec_1" };
    const about = (env: Record<string, string>) =>
      checkEnvironment(env).warnings.filter((w) => /\/withdraw and \/cancel/.test(w));
    expect(about(billing)).toHaveLength(1);
    expect(about(billing)[0]).toMatch(/acknowledgement of receipt cannot be emailed/);
    // With email configured, without billing, or on the website deployment (it sends nothing): no warning.
    const email = { SMTP_URL: "smtps://u:p@smtp.example.com:465", MAIL_FROM: "StudyOS <hello@example.com>" };
    expect(about({ ...billing, ...email })).toEqual([]);
    expect(about(BASE)).toEqual([]);
    expect(about({ ...billing, STUDYOS_APP_ORIGIN: "https://app.example.com" })).toEqual([]);
  });

  it("registers the EU selling settings as optional, non-secret billing settings", () => {
    for (const name of ["STRIPE_PRICE_CREDIT_PACK", "STRIPE_AUTOMATIC_TAX", "STRIPE_TAX_BEHAVIOR", "STRIPE_PACK_INVOICES", "STRIPE_TERMS_CONSENT"]) {
      expect(ENV_VARS.find((v) => v.name === name), name).toMatchObject({ required: false, feature: "billing", secret: false });
    }
    // The consent checkbox fails on Stripe without the Terms URL in the Dashboard: the description says so.
    expect(ENV_VARS.find((v) => v.name === "STRIPE_TERMS_CONSENT")?.description).toMatch(/Terms of service URL in the Dashboard/);
    // None of them is needed to start, or switches billing on or off.
    const report = checkEnvironment({ ...BASE, STRIPE_AUTOMATIC_TAX: "1", STRIPE_TERMS_CONSENT: "1" });
    expect(report.missingRequired).toEqual([]);
    expect(report.features.billing.enabled).toBe(false);
  });

  it("names a checkout switch set to neither on nor off (it stays off), never its value", () => {
    const warnings = checkEnvironment({
      ...BASE,
      STRIPE_AUTOMATIC_TAX: "maybe-later",
      STRIPE_PACK_INVOICES: "Yes",
      STRIPE_TERMS_CONSENT: "off",
    }).warnings;
    expect(warnings.filter((w) => /STRIPE_AUTOMATIC_TAX/.test(w))).toEqual([
      expect.stringMatching(/^STRIPE_AUTOMATIC_TAX is set to something that is neither on \(1, true, yes, on\) nor off \(0, false, no, off\), so it is OFF\.$/),
    ]);
    expect(warnings.join(" ")).not.toMatch(/STRIPE_PACK_INVOICES|STRIPE_TERMS_CONSENT/);
    expect(warnings.join(" ")).not.toContain("maybe-later");
  });

  it("while the Terms checkbox is on, reminds the owner that Stripe's customer emails must be on for the confirmation to arrive", () => {
    const reminder = /STRIPE_TERMS_CONSENT is on: make sure Stripe's customer emails for successful payments/;
    expect(checkEnvironment({ ...BASE, STRIPE_TERMS_CONSENT: "true" }).warnings).toContainEqual(expect.stringMatching(reminder));
    expect(checkEnvironment(BASE).warnings.join(" ")).not.toMatch(reminder);
    expect(checkEnvironment({ ...BASE, STRIPE_TERMS_CONSENT: "0" }).warnings.join(" ")).not.toMatch(reminder);
    // The setting's description says it too, with the invoice the pack always gets then.
    const description = ENV_VARS.find((v) => v.name === "STRIPE_TERMS_CONSENT")?.description ?? "";
    expect(description).toMatch(/even without STRIPE_PACK_INVOICES/);
    expect(description).toMatch(/customer emails for successful payments/);
  });

  it("warns when STRIPE_TAX_BEHAVIOR is neither inclusive nor exclusive", () => {
    const tax = (value: string) => checkEnvironment({ ...BASE, STRIPE_TAX_BEHAVIOR: value }).warnings.filter((w) => /STRIPE_TAX_BEHAVIOR/.test(w));
    expect(tax("inclusve")).toEqual([expect.stringMatching(/inclusive is used/)]);
    expect(tax("inclusive")).toEqual([]);
    expect(tax("exclusive")).toEqual([]);
    expect(tax("")).toEqual([]);
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

  it("switches email reminders on only with a readable SMTP_URL and MAIL_FROM, and never prints the SMTP secret", () => {
    const email = {
      ...BASE,
      MAINTENANCE_SECRET: "m",
      SMTP_URL: "smtps://apikey:smtp-secretvalue@smtp.example.com:465",
      MAIL_FROM: "StudyOS <hello@example.com>",
    };
    const warningsAbout = (env: Record<string, string>) =>
      checkEnvironment(env).warnings.filter((w) => /SMTP_URL|MAIL_FROM|MAIL_REPLY_TO|Email reminders/.test(w));

    expect(checkEnvironment(email).features.email).toEqual({ enabled: true, missing: [] });
    expect(warningsAbout(email)).toEqual([]);
    // Off without either, with the missing name in the summary.
    expect(checkEnvironment(BASE).features.email).toEqual({ enabled: false, missing: ["SMTP_URL", "MAIL_FROM"] });
    expect(warningsAbout({ ...BASE, MAINTENANCE_SECRET: "m" })).toEqual([]);
    expect(checkEnvironment({ ...email, MAIL_FROM: "" }).features.email).toEqual({ enabled: false, missing: ["MAIL_FROM"] });
    expect(warningsAbout({ ...email, MAIL_FROM: "" })).toEqual([
      "Email reminders are partly configured (missing MAIL_FROM): they stay off.",
    ]);
    // Set, but not readable: off, and said why.
    expect(checkEnvironment({ ...email, SMTP_URL: "smtp.example.com:587" }).features.email.enabled).toBe(false);
    expect(warningsAbout({ ...email, SMTP_URL: "smtp.example.com:587" })).toEqual([
      expect.stringMatching(/^SMTP_URL cannot be read \(it does not start with smtp:\/\/ or smtps:\/\/;/),
    ]);
    expect(warningsAbout({ ...email, SMTP_URL: "smtp://u:p@host:99999" })).toEqual([expect.stringMatching(/host or port cannot be read/)]);
    // A password with an unencoded "/", "+" or "%" is read as written, not refused.
    for (const SMTP_URL of ["smtps://apikey:ab/c+d%e@smtp.example.com:465", "smtp://u:p@ss/w%rd@smtp.example.com"]) {
      expect(checkEnvironment({ ...email, SMTP_URL }).features.email.enabled, SMTP_URL).toBe(true);
      expect(warningsAbout({ ...email, SMTP_URL }), SMTP_URL).toEqual([]);
    }
    expect(warningsAbout({ ...email, MAIL_FROM: "StudyOS" })).toEqual([expect.stringMatching(/^MAIL_FROM is not an email address/)]);
    expect(warningsAbout({ ...email, MAIL_REPLY_TO: "help" })).toEqual([expect.stringMatching(/^MAIL_REPLY_TO is not a single email address/)]);
    // Without the dispatch's secret nothing but test emails would go out.
    expect(warningsAbout({ ...email, MAINTENANCE_SECRET: "" })).toEqual([expect.stringMatching(/MAINTENANCE_SECRET is not: .*no reminder emails/)]);

    expect(ENV_VARS.find((v) => v.name === "SMTP_URL")).toMatchObject({ required: false, feature: "email", secret: true });
    for (const name of ["MAIL_FROM", "MAIL_REPLY_TO"]) {
      expect(ENV_VARS.find((v) => v.name === name)).toMatchObject({ required: false, feature: "email", secret: false });
    }
    // The unsubscribe links' own key: optional, secret, with its rotation described.
    for (const name of ["UNSUBSCRIBE_SECRET", "UNSUBSCRIBE_SECRET_PREVIOUS"]) {
      expect(ENV_VARS.find((v) => v.name === name)).toMatchObject({ required: false, feature: "email", secret: true });
    }
    expect(ENV_VARS.find((v) => v.name === "UNSUBSCRIBE_SECRET")!.description).toMatch(/UNSUBSCRIBE_SECRET_PREVIOUS/);
    expect(ENV_VARS.find((v) => v.name === "APP_URL")!.description).toMatch(/unsubscribe link/);
    expect(checkEnvironment({ ...email, UNSUBSCRIBE_SECRET: "short" }).warnings).toContainEqual(
      expect.stringMatching(/^UNSUBSCRIBE_SECRET is shorter than 32 characters/),
    );
    expect(checkEnvironment({ ...email, UNSUBSCRIBE_SECRET: "x".repeat(40) }).warnings.some((w) => /UNSUBSCRIBE/.test(w))).toBe(false);
    const summary = formatStartupSummary(checkEnvironment(email));
    expect(summary).toContain("  email: on");
    expect(formatStartupSummary(checkEnvironment(BASE))).toContain("  email: off (missing SMTP_URL, MAIL_FROM)");
    for (const text of [summary, JSON.stringify(publicConfigStatus(email)), JSON.stringify(publicConfigStatus({ ...email, SMTP_URL: "smtp://u:smtp-secretvalue@" }))]) {
      expect(text).not.toContain("smtp-secretvalue");
    }
    expect(publicConfigStatus(email).features.email).toBe(true);
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
