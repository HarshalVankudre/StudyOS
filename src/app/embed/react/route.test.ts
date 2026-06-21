import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /embed/react", () => {
  it("returns HTML with a nonce'd runtime script and a locked-down CSP", async () => {
    const res = await GET();
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("connect-src"); // no connect-src -> default-src 'none' blocks fetch
    const html = await res.text();
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script src="/embed/runtime.js" nonce="${nonce}">`);
  });

  it("uses a fresh nonce per request", async () => {
    const a = (await GET()).headers.get("content-security-policy");
    const b = (await GET()).headers.get("content-security-policy");
    expect(a).not.toEqual(b);
  });
});
