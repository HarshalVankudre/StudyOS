/**
 * Server-side error reporting without a vendor: one structured JSON line per
 * error on stderr, in the shape Google Cloud Error Reporting ingests from
 * Cloud Run logs (`@type` ReportedErrorEvent, severity ERROR, stack trace in
 * `message`, serviceContext from Cloud Run's K_SERVICE/K_REVISION).
 *
 * Never includes secrets or document contents: the context is a short
 * allowlist of primitive fields, messages are scrubbed of credential shapes and
 * truncated, and Prisma error messages (which echo query arguments, i.e.
 * workspace JSON) are replaced by their error code.
 */

export const REPORTED_ERROR_EVENT_TYPE =
  "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent";

const MAX_MESSAGE = 500;
const MAX_STACK = 4_000;
const MAX_CONTEXT_VALUE = 200;

/** Context keys that may be logged. Anything else is dropped. */
const CONTEXT_KEYS = [
  "source",
  "route",
  "path",
  "method",
  "routeType",
  "userId",
  "workspaceId",
  "taskId",
  "digest",
  "boundary",
  "status",
  "eventType",
] as const;

export type ErrorContext = Partial<
  Record<(typeof CONTEXT_KEYS)[number], string | number | boolean | null | undefined>
>;

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, "[redacted-stripe-key]"],
  [/\bwhsec_[A-Za-z0-9+/=]+/g, "[redacted-webhook-secret]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]"],
  // Daytona (sandbox) API keys.
  [/\bdtn_[A-Za-z0-9_-]{8,}/g, "[redacted-daytona-key]"],
  // Google API keys.
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted-google-key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi, "[redacted-credentials]@"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[redacted-jwt]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]"],
];

/**
 * A quoted value that may stay in a log line: a short code or identifier
 * ("invalid_type", 'P2002', "out/page-1.png"). Anything else inside quotes
 * (words with spaces, punctuation, long runs) may be the student's content.
 */
const SAFE_QUOTED = /^[A-Za-z0-9_.:/#@-]{0,48}$/;

const QUOTED_PATTERNS: [RegExp, string, string][] = [
  [/"([^"\n]{0,2000})"/g, '"', '"'],
  [/“([^”\n]{0,2000})”/g, "“", "”"],
  [/`([^`\n]{0,2000})`/g, "`", "`"],
  // Single quotes only when not an apostrophe ("can't", "students'").
  [/(?<![A-Za-z0-9])'([^'\n]{0,2000})'(?![A-Za-z0-9])/g, "'", "'"],
];

/**
 * Remove credential shapes and anything that may be user content.
 *
 * Error messages quote the values they choke on: JSON.parse quotes the start
 * of the text, Zod quotes received values, Prisma echoes arguments, and the
 * model's own output can carry workspace text. Any length of such content can
 * be private (an exam date, a name), so every quoted value is replaced unless
 * it looks like a code or identifier, and any inline JSON object is dropped.
 */
export function scrub(text: string, max = MAX_MESSAGE): string {
  // Work on a bounded prefix: the result is capped anyway, and this keeps the
  // regex work linear in a small input.
  let out = text.length > max * 4 ? text.slice(0, max * 4) : text;
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  for (const [re, open, close] of QUOTED_PATTERNS) {
    out = out.replace(re, (whole, inner: string) =>
      SAFE_QUOTED.test(inner) ? whole : `${open}…${close}`,
    );
  }
  // Inline JSON objects are almost always user content.
  out = out.replace(/\{[^{}]{24,}\}/g, "{…}");
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

function describe(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (error.name.startsWith("PrismaClient") || error.constructor?.name?.startsWith("PrismaClient")) {
      // Prisma messages echo query arguments (workspace JSON); keep only the code.
      const name = error.constructor?.name ?? error.name;
      const stackFrames = error.stack?.split("\n").filter((l) => l.trimStart().startsWith("at ")) ?? [];
      const message = `${name}${typeof code === "string" ? ` ${code}` : ""}`;
      return { name, message, stack: [`${name}: ${message}`, ...stackFrames].join("\n") };
    }
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === "string") return { name: "Error", message: error };
  return { name: "NonErrorThrown", message: typeof error };
}

function cleanContext(context: ErrorContext): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of CONTEXT_KEYS) {
    const value = context[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      // Paths: drop query strings (tokens, search terms).
      const v = key === "path" ? value.split("?")[0] : value;
      out[key] = scrub(v, MAX_CONTEXT_VALUE);
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

export interface ReportedErrorEntry {
  "@type": string;
  severity: "ERROR";
  message: string;
  serviceContext: { service: string; version?: string };
  context: {
    httpRequest?: { method?: string; url?: string };
    user?: string;
    reportLocation?: { filePath: string; lineNumber: number; functionName: string };
  };
  labels: Record<string, string | number | boolean>;
  time: string;
}

export function buildErrorEntry(
  error: unknown,
  context: ErrorContext = {},
  env: Record<string, string | undefined> = process.env,
): ReportedErrorEntry {
  const info = describe(error);
  const labels = cleanContext(context);
  const headline = `${info.name}: ${scrub(info.message)}`;
  const stack = info.stack
    ? scrub(
        // Replace the first line (which repeats the raw message) with the scrubbed one.
        [headline, ...info.stack.split("\n").slice(1)].join("\n"),
        MAX_STACK,
      )
    : undefined;
  const entry: ReportedErrorEntry = {
    "@type": REPORTED_ERROR_EVENT_TYPE,
    severity: "ERROR",
    message: stack ?? headline,
    serviceContext: {
      service: env.K_SERVICE ?? "studyos",
      ...(env.K_REVISION ? { version: env.K_REVISION } : {}),
    },
    context: {},
    labels,
    time: new Date().toISOString(),
  };
  if (labels.method || labels.path) {
    entry.context.httpRequest = {
      ...(typeof labels.method === "string" ? { method: labels.method } : {}),
      ...(typeof labels.path === "string" ? { url: labels.path } : {}),
    };
  }
  if (typeof labels.userId === "string") entry.context.user = labels.userId;
  if (!stack) {
    // Error Reporting needs a stack trace OR a report location to group an event.
    entry.context.reportLocation = {
      filePath: String(labels.route ?? labels.source ?? "unknown"),
      lineNumber: 0,
      functionName: String(labels.source ?? "unknown"),
    };
  }
  return entry;
}

/** Report a server-side error. Never throws. */
export function reportError(error: unknown, context: ErrorContext = {}): void {
  try {
    console.error(JSON.stringify(buildErrorEntry(error, context)));
  } catch {
    console.error('{"severity":"ERROR","message":"reportError failed"}');
  }
}
