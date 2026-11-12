/**
 * Standalone startup configuration check, run by the container BEFORE the
 * Next.js server starts listening (Dockerfile CMD: `node check-env.cjs &&
 * exec node server.js`). A revision with a required variable missing then
 * exits before it opens its port, so it can never pass Cloud Run's TCP
 * startup probe and receive traffic.
 *
 * Bundled to .next/standalone/check-env.cjs by scripts/build-env-check.mjs
 * (part of `pnpm build`), whose tiny entry calls runEnvironmentCheck() and
 * sets the exit code. Same rules as validateEnvironmentOnStartup: logs the
 * names-only summary, exits 1 in production when a required variable is
 * missing, unless STUDYOS_ALLOW_INCOMPLETE_ENV=1.
 */
import { MissingEnvironmentError, validateEnvironmentOnStartup } from "./env";

export function runEnvironmentCheck(
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = console.log,
  logError: (line: string) => void = console.error,
): number {
  try {
    validateEnvironmentOnStartup(env, log);
    return 0;
  } catch (error) {
    if (error instanceof MissingEnvironmentError) {
      logError(error.message);
      return 1;
    }
    throw error;
  }
}
