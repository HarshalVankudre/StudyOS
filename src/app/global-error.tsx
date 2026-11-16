"use client";

import { useEffect } from "react";
import { sendClientErrorReport } from "@/lib/ops/client-report";

/**
 * Last-resort boundary: replaces the ENTIRE root layout, so no providers
 * (theme, i18n) exist here. Self-contained styles, English only.
 *
 * The button reloads the page, as its label says: the root layout itself
 * failed, so everything has to be fetched again.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    console.error("[StudyOS] global error:", error);
    sendClientErrorReport(error, "global");
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#faf9f5",
          color: "#141413",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div>
          <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.015em", margin: 0, fontFamily: "Georgia, 'Times New Roman', serif" }}>Something went wrong</h1>
          <p style={{ color: "#4d4c48", maxWidth: 420, lineHeight: 1.6 }}>
            An unexpected error occurred. Your work is autosaved — reloading
            usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: "12px 24px",
              borderRadius: 999,
              border: "none",
              background: "#c8f24a",
              color: "#141413",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
