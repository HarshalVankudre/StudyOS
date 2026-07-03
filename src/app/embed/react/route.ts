import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic"; // per-request nonce

export async function GET() {
  const nonce = randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    // No remote hosts: an arbitrary-https img-src would be an exfiltration
    // channel for a hostile component (data in the URL of a tracking pixel).
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const html =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>html,body{margin:0;padding:0}</style></head>` +
    `<body><div id="root"></div>` +
    `<script src="/embed/runtime.js" nonce="${nonce}"></script>` +
    `</body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
