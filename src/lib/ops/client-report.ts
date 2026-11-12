/**
 * Browser side of error reporting: send a boundary-caught error to
 * /api/ops/client-error once. Fire-and-forget; never throws.
 */
const sent = new Set<string>();

export function sendClientErrorReport(
  error: Error & { digest?: string },
  boundary: "route" | "global",
): void {
  try {
    const key = `${boundary}:${error.digest ?? ""}:${error.message}`;
    if (sent.has(key)) return;
    sent.add(key);
    const body = JSON.stringify({
      boundary,
      name: error.name,
      message: error.message,
      digest: error.digest,
      stack: error.stack?.slice(0, 4_000),
      path: window.location.pathname,
    });
    void fetch("/api/ops/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never break the error page.
  }
}
