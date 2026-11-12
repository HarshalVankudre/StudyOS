import type { Instrumentation } from "next";

/**
 * Runs once when a server instance starts (never during `next build`).
 * Logs the configuration summary and, in production, exits when a required
 * environment variable is missing instead of silently serving template
 * workspaces.
 *
 * This is the second line of defence. Next runs register() only after the
 * standalone server is already listening, so on its own a broken revision
 * could pass a TCP startup probe before exiting. The container therefore runs
 * the same check first (`node check-env.cjs && exec node server.js`, see the
 * Dockerfile and src/lib/ops/check-env-cli.ts) and never opens the port; this
 * copy covers `next start` outside the container. /api/health also answers
 * 503 while required configuration is missing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnvironmentOnStartup, MissingEnvironmentError } = await import(
    "./lib/ops/env"
  );
  try {
    validateEnvironmentOnStartup();
  } catch (error) {
    if (error instanceof MissingEnvironmentError) {
      console.error(error.message);
      // Exit instead of throwing: a thrown register() error only surfaces on
      // the first request, while an exit fails the Cloud Run revision at once.
      process.exit(1);
    }
    throw error;
  }
}

/** Uncaught server errors (render, route handlers, actions) go to Error Reporting. */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("./lib/ops/report-error");
  reportError(error, {
    source: "onRequestError",
    method: request.method,
    path: request.path,
    route: context.routePath,
    routeType: context.routeType,
    digest: (error as { digest?: string }).digest,
  });
};
