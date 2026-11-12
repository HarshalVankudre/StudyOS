/**
 * One description of every environment variable StudyOS reads, plus the
 * startup check and the secret-free status the health endpoint exposes.
 *
 * Required variables fail the server start in production (see
 * src/instrumentation.ts). `next build` never runs that check (Next skips
 * instrumentation during the build phase), so the Docker image still builds
 * with secrets injected only at runtime.
 *
 * Nothing here ever returns or logs a variable's VALUE, only whether it is set.
 */
import { modelForPlan } from "@/lib/ai/plans";
import { apiKeyEnvVar, providerForModel } from "@/lib/ai/provider";

type Env = Record<string, string | undefined>;

export type FeatureKey =
  | "core"
  | "ai"
  | "billing"
  | "assets"
  | "sandbox"
  | "clerkWebhook"
  | "maintenance"
  | "webFetch"
  | "notifications"
  | "dev";

export interface EnvVarSpec {
  name: string;
  /**
   * "always" = required in production; "ai" = required when a configured model
   * needs it; "billing" = required in production once billing is configured.
   */
  required: "always" | "ai" | "billing" | false;
  feature: FeatureKey;
  /** Public values may appear in the client bundle; secrets never leave the server. */
  secret: boolean;
  description: string;
}

export const ENV_VARS: readonly EnvVarSpec[] = [
  // Core
  { name: "DATABASE_URL", required: "always", feature: "core", secret: true, description: "Pooled Postgres connection string used at runtime." },
  { name: "DATABASE_URL_UNPOOLED", required: false, feature: "core", secret: true, description: "Direct Postgres connection for prisma migrate (Cloud Build migrate step)." },
  { name: "CLERK_SECRET_KEY", required: "always", feature: "core", secret: true, description: "Clerk backend key (auth)." },
  { name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", required: "always", feature: "core", secret: false, description: "Clerk publishable key. Inlined at build time, so it is also a Docker build arg." },
  { name: "NEXT_PUBLIC_CLERK_SIGN_IN_URL", required: false, feature: "core", secret: false, description: "Path of the sign-in page (e.g. /sign-in)." },
  { name: "NEXT_PUBLIC_CLERK_SIGN_UP_URL", required: false, feature: "core", secret: false, description: "Path of the sign-up page (e.g. /sign-up)." },
  { name: "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL", required: false, feature: "core", secret: false, description: "Where Clerk sends users after sign-in." },
  { name: "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL", required: false, feature: "core", secret: false, description: "Where Clerk sends users after sign-up." },
  { name: "APP_URL", required: false, feature: "core", secret: false, description: "Canonical public URL (SEO, ICS links). Falls back to NEXT_PUBLIC_APP_URL, then the Cloud Run URL." },
  { name: "NEXT_PUBLIC_APP_URL", required: false, feature: "core", secret: false, description: "Public URL fallback for APP_URL." },
  { name: "STUDYOS_SUPPORT_EMAIL", required: false, feature: "core", secret: false, description: "Public support address shown on the landing, pricing and legal pages (lib/site.ts). Falls back to the owner's address." },
  // AI
  { name: "OPENROUTER_API_KEY", required: "ai", feature: "ai", secret: true, description: "OpenRouter key; required when a plan model is an OpenRouter slug (the default)." },
  { name: "ANTHROPIC_API_KEY", required: "ai", feature: "ai", secret: true, description: "Anthropic key; required when a plan model is a bare claude-* id." },
  { name: "STUDYOS_FREE_MODEL", required: false, feature: "ai", secret: false, description: "Model for the Free plan (default z-ai/glm-5.2)." },
  { name: "STUDYOS_PRO_MODEL", required: false, feature: "ai", secret: false, description: "Model for the Pro plan (default z-ai/glm-5.2)." },
  { name: "AGENT_FETCH_ALLOWLIST", required: false, feature: "webFetch", secret: false, description: "Comma-separated hosts the agent may read; empty = no web reading." },
  // Billing
  { name: "STRIPE_SECRET_KEY", required: false, feature: "billing", secret: true, description: "Stripe secret key; billing is disabled without it." },
  { name: "STRIPE_PRICE_PRO", required: false, feature: "billing", secret: false, description: "Stripe price id of the Pro subscription." },
  { name: "STRIPE_PRICE_PRO_ANNUAL", required: false, feature: "billing", secret: false, description: "Stripe price id of annual Pro billing; annual is offered only when it is set (lib/stripe.ts)." },
  { name: "STRIPE_WEBHOOK_SECRET", required: false, feature: "billing", secret: true, description: "Signing secret of the Stripe webhook (/api/stripe/webhook)." },
  { name: "STUDYOS_PRO_MONTHLY_PRICE", required: false, feature: "billing", secret: false, description: "USD a month shown for monthly Pro (default 5). Must match the Stripe price STRIPE_PRICE_PRO (lib/plan-pricing.ts)." },
  { name: "STUDYOS_PRO_ANNUAL_PRICE", required: false, feature: "billing", secret: false, description: "USD a year shown for annual Pro. Must match STRIPE_PRICE_PRO_ANNUAL; annual is shown only when both are set (lib/plan-pricing.ts)." },
  { name: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", required: false, feature: "billing", secret: false, description: "Stripe publishable key (passed as a build arg; currently unused by the client)." },
  // Assets + sandbox
  { name: "ASSETS_BUCKET", required: false, feature: "assets", secret: false, description: "GCS bucket for rendered images; required by the sandbox feature and account deletion of asset bytes." },
  { name: "GOOGLE_APPLICATION_CREDENTIALS", required: false, feature: "assets", secret: true, description: "Service-account key path outside Google Cloud; Cloud Run uses its own identity instead." },
  { name: "AGENT_SANDBOX", required: false, feature: "sandbox", secret: false, description: "1 = enable the Daytona render sandbox tool (owner's decision)." },
  { name: "DAYTONA_API_KEY", required: false, feature: "sandbox", secret: true, description: "Daytona API key for the render sandbox." },
  { name: "STUDYOS_SANDBOX_SNAPSHOT", required: false, feature: "sandbox", secret: false, description: "Prebuilt Daytona snapshot with the render toolchain." },
  { name: "STUDYOS_SANDBOX_NETWORK_ALLOWLIST", required: false, feature: "sandbox", secret: false, description: "Comma-separated CIDRs the sandbox may reach; empty = all network blocked." },
  // Ops
  { name: "CLERK_WEBHOOK_SIGNING_SECRET", required: "billing", feature: "clerkWebhook", secret: true, description: "Signing secret of the Clerk webhook (/api/clerk/webhook) that cancels billing of and erases data of users deleted in Clerk. Required once billing is configured." },
  { name: "MAINTENANCE_SECRET", required: false, feature: "maintenance", secret: true, description: "Bearer secret for /api/ops/maintenance (Cloud Scheduler). Route returns 404 without it." },
  { name: "VAPID_PUBLIC_KEY", required: false, feature: "notifications", secret: false, description: "Web Push VAPID public key (base64url, 65 bytes). With the private key and subject it switches notifications on; generate the pair once (see .env.example)." },
  { name: "VAPID_PRIVATE_KEY", required: false, feature: "notifications", secret: true, description: "Web Push VAPID private key (base64url, 32 bytes). Changing the pair makes every device re-subscribe the next time the student opens StudyOS." },
  { name: "VAPID_SUBJECT", required: false, feature: "notifications", secret: false, description: "Contact for push services: mailto:address or an https URL (Apple rejects pushes without one)." },
  { name: "FEED_URL_KEY", required: false, feature: "core", secret: true, description: "Secret that encrypts students' connected calendar feed links at rest (lib/feeds/secret.ts). Without it links are stored encoded, not encrypted. Changing it means students reconnect their feeds." },
  { name: "STUDYOS_TRUSTED_PROXY_HOPS", required: false, feature: "core", secret: false, description: "X-Forwarded-For entries appended by our own proxies (default 1 = Cloud Run alone; 2 = a Google external Application Load Balancer in front). Picks the client address for per-client rate limits." },
  { name: "STUDYOS_ALLOW_INCOMPLETE_ENV", required: false, feature: "core", secret: false, description: "1 = start in production even when required variables are missing (local next start only)." },
  // Dev-only
  { name: "STUDYOS_PLAN", required: false, feature: "dev", secret: false, description: "Dev override of the plan (free|pro) for users without a subscription." },
  { name: "STUDYOS_GEO_COUNTRY", required: false, feature: "dev", secret: false, description: "Force a visitor country for locale detection (local testing)." },
];

export interface FeatureStatus {
  enabled: boolean;
  /** Names of variables the feature still needs (never values). */
  missing: string[];
}

export interface EnvReport {
  production: boolean;
  /** Required variables that are missing. Non-empty = must not serve traffic in production. */
  missingRequired: string[];
  features: Record<Exclude<FeatureKey, "core" | "dev">, FeatureStatus>;
  warnings: string[];
}

const isSet = (env: Env, name: string) => Boolean(env[name]?.trim());
const isOn = (env: Env, name: string) => env[name] === "1" || env[name] === "true";

function status(env: Env, names: string[], enabled = true): FeatureStatus {
  const missing = names.filter((n) => !isSet(env, n));
  return { enabled: enabled && missing.length === 0, missing };
}

/** AI key names the configured plan models need (deduplicated). */
export function requiredAiKeys(env: Env = process.env): string[] {
  const models = [
    env.STUDYOS_FREE_MODEL ?? modelForPlan("free"),
    env.STUDYOS_PRO_MODEL ?? modelForPlan("pro"),
  ];
  return [...new Set(models.map((m) => apiKeyEnvVar(providerForModel(m))))];
}

export function checkEnvironment(env: Env = process.env): EnvReport {
  const production = env.NODE_ENV === "production";
  const aiKeys = requiredAiKeys(env);
  const always = ENV_VARS.filter((v) => v.required === "always").map((v) => v.name);
  const billing = status(env, ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO", "STRIPE_WEBHOOK_SECRET"]);
  // With billing on, a user deleted in Clerk must also stop being charged.
  const billingKeys = billing.enabled
    ? ENV_VARS.filter((v) => v.required === "billing").map((v) => v.name)
    : [];
  const missingRequired = [...always, ...aiKeys, ...billingKeys].filter((n) => !isSet(env, n));

  const sandboxOn = isOn(env, "AGENT_SANDBOX");
  const features: EnvReport["features"] = {
    ai: status(env, aiKeys),
    billing,
    assets: status(env, ["ASSETS_BUCKET"]),
    sandbox: sandboxOn
      ? status(env, ["DAYTONA_API_KEY", "STUDYOS_SANDBOX_SNAPSHOT", "ASSETS_BUCKET"])
      : { enabled: false, missing: [] },
    clerkWebhook: status(env, ["CLERK_WEBHOOK_SIGNING_SECRET"]),
    maintenance: status(env, ["MAINTENANCE_SECRET"]),
    webFetch: status(env, ["AGENT_FETCH_ALLOWLIST"]),
    notifications: status(env, ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]),
  };

  const warnings: string[] = [];
  if (!billing.enabled && billing.missing.length < 3) {
    warnings.push(
      `Billing is partly configured (missing ${billing.missing.join(", ")}): payments could succeed without the subscription being recorded.`,
    );
  }
  if (sandboxOn && !features.sandbox.enabled) {
    warnings.push(`AGENT_SANDBOX is on but ${features.sandbox.missing.join(", ")} is missing.`);
  }
  if (production && !features.clerkWebhook.enabled) {
    warnings.push(
      billing.enabled
        ? "CLERK_WEBHOOK_SIGNING_SECRET is not set: accounts deleted in Clerk keep their StudyOS data AND KEEP BEING BILLED."
        : "CLERK_WEBHOOK_SIGNING_SECRET is not set: accounts deleted in Clerk keep their StudyOS data.",
    );
  }
  if (production && !features.maintenance.enabled) {
    warnings.push("MAINTENANCE_SECRET is not set: data retention cleanup cannot run.");
  }
  if (!features.notifications.enabled && features.notifications.missing.length < 3) {
    warnings.push(
      `Notifications are partly configured (missing ${features.notifications.missing.join(", ")}): they stay off.`,
    );
  }
  if (features.notifications.enabled && !features.maintenance.enabled) {
    warnings.push("VAPID keys are set but MAINTENANCE_SECRET is not: the notifications dispatch cannot run, so nothing is sent.");
  }
  if (production && !isSet(env, "FEED_URL_KEY")) {
    warnings.push("FEED_URL_KEY is not set: connected calendar feed links are stored without encryption.");
  }
  if (isSet(env, "STRIPE_PRICE_PRO_ANNUAL") && !isSet(env, "STUDYOS_PRO_ANNUAL_PRICE")) {
    warnings.push("STRIPE_PRICE_PRO_ANNUAL is set but STUDYOS_PRO_ANNUAL_PRICE is not: annual billing is hidden on the pricing page until its displayed price is set.");
  }
  if (production && !isSet(env, "STUDYOS_SUPPORT_EMAIL")) {
    warnings.push("STUDYOS_SUPPORT_EMAIL is not set: public pages show the fallback support address.");
  }
  if (production && !isSet(env, "APP_URL") && !isSet(env, "NEXT_PUBLIC_APP_URL")) {
    warnings.push("APP_URL is not set: absolute links use the fallback Cloud Run URL.");
  }
  return { production, missingRequired, features, warnings };
}

/** One readable startup summary (names and on/off only, never values). */
export function formatStartupSummary(report: EnvReport): string {
  const lines = [
    `[StudyOS] configuration (${report.production ? "production" : "development"})`,
    report.missingRequired.length
      ? `  MISSING REQUIRED: ${report.missingRequired.join(", ")}`
      : "  required: ok",
  ];
  for (const [name, s] of Object.entries(report.features)) {
    lines.push(
      `  ${name}: ${s.enabled ? "on" : "off"}${s.missing.length ? ` (missing ${s.missing.join(", ")})` : ""}`,
    );
  }
  for (const w of report.warnings) lines.push(`  warning: ${w}`);
  return lines.join("\n");
}

export class MissingEnvironmentError extends Error {}

/**
 * Log the summary; in production throw when required variables are missing
 * (unless STUDYOS_ALLOW_INCOMPLETE_ENV=1). Never runs during `next build`.
 */
export function validateEnvironmentOnStartup(
  env: Env = process.env,
  log: (line: string) => void = console.log,
): EnvReport {
  const report = checkEnvironment(env);
  log(formatStartupSummary(report));
  if (
    report.production &&
    report.missingRequired.length > 0 &&
    !isOn(env, "STUDYOS_ALLOW_INCOMPLETE_ENV")
  ) {
    throw new MissingEnvironmentError(
      `[StudyOS] refusing to start: missing required environment variables ${report.missingRequired.join(", ")}`,
    );
  }
  return report;
}

/** Secret-free configuration status for /api/health. */
export function publicConfigStatus(env: Env = process.env) {
  const report = checkEnvironment(env);
  return {
    ok: report.missingRequired.length === 0,
    missingRequired: report.missingRequired,
    features: Object.fromEntries(
      Object.entries(report.features).map(([k, s]) => [k, s.enabled]),
    ) as Record<keyof EnvReport["features"], boolean>,
    warnings: report.warnings.length,
  };
}
