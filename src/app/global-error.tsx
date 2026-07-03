"use client";

/**
 * Last-resort boundary: replaces the ENTIRE root layout, so no providers
 * (theme, i18n) exist here. Self-contained styles, English only.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[StudyOS] global error:", error);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b0b0a",
          color: "#f4f3ef",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div>
          <h1 style={{ fontSize: 32, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#a8a89e", maxWidth: 420, lineHeight: 1.6 }}>
            An unexpected error occurred. Your work is autosaved — reloading
            usually fixes it.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "12px 24px",
              borderRadius: 8,
              border: "none",
              background: "#2dd4bf",
              color: "#0b0b0a",
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
