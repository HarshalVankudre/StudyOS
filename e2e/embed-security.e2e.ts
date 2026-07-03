import { test, expect, type Page } from "@playwright/test";

/**
 * THE SECURITY KEYSTONE for interactive React artifacts.
 *
 * A react_artifact component is untrusted code. It runs inside
 * <iframe sandbox="allow-scripts"> (NO allow-same-origin → opaque origin)
 * served by /embed/react with a strict CSP (default-src 'none'; no
 * connect-src; img-src 'self' data: blob:). This suite proves, in a real
 * browser, that a hostile component cannot:
 *   1. touch the parent document (even though the parent IS same-site),
 *   2. read cookies or web storage,
 *   3. exfiltrate via fetch/XHR,
 *   4. exfiltrate via remote-image loads,
 * and that a legitimate component still renders and reports its height.
 */

// Mimics ReactArtifact.tsx: hosts the sandboxed iframe from a real same-origin
// page, answers the runtime's "ready" with a render request, and records
// every message the frame posts back.
async function mountArtifact(page: Page, source: string) {
  await page.goto("/privacy"); // public, same-origin host page
  await page.evaluate((src) => {
    (window as unknown as { __msgs: unknown[] }).__msgs = [];
    const iframe = document.createElement("iframe");
    iframe.id = "artifact";
    iframe.src = "/embed/react";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.width = "600px";
    iframe.style.height = "400px";
    window.addEventListener("message", (ev) => {
      if (ev.source !== iframe.contentWindow) return;
      const data = ev.data as { type?: string };
      (window as unknown as { __msgs: unknown[] }).__msgs.push(data);
      if (data?.type === "ready") {
        iframe.contentWindow?.postMessage({ type: "render", source: src }, "*");
      }
    });
    document.body.appendChild(iframe);
  }, source);
  const frame = page.frameLocator("#artifact");
  return { frame };
}

test("embed route ships the lockdown CSP", async ({ page }) => {
  const res = await page.request.get("/embed/react");
  expect(res.status()).toBe(200);
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'none'");
  expect(csp).not.toContain("connect-src");
  expect(csp).toContain("img-src 'self' data: blob:");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("form-action 'none'");
});

test("hostile component is fully contained", async ({ page }) => {
  const HOSTILE = `
    function App() {
      const probe = (fn) => {
        try { return "LEAK:" + String(fn()).slice(0, 40); }
        catch (e) { return "BLOCKED:" + e.name; }
      };
      const [net, setNet] = React.useState({ fetch: "PENDING", img: "PENDING" });
      React.useEffect(() => {
        fetch("https://example.com/probe")
          .then(() => setNet((n) => ({ ...n, fetch: "LEAK:fetched" })))
          .catch((e) => setNet((n) => ({ ...n, fetch: "BLOCKED:" + e.name })));
        const img = new Image();
        img.onload = () => setNet((n) => ({ ...n, img: "LEAK:imgloaded" }));
        img.onerror = () => setNet((n) => ({ ...n, img: "BLOCKED:img" }));
        img.src = "https://example.com/pixel.png";
      }, []);
      const results = {
        parentDoc: probe(() => window.parent.document.title),
        topLoc: probe(() => window.top.location.href),
        cookie: probe(() => document.cookie),
        storage: probe(() => window.localStorage.getItem("x")),
        fetch: net.fetch,
        img: net.img,
      };
      return <pre id="probes">{JSON.stringify(results)}</pre>;
    }
  `;
  const { frame } = await mountArtifact(page, HOSTILE);

  const probes = frame.locator("#probes");
  await expect(probes).toBeVisible({ timeout: 30_000 });
  // Network probes resolve async — wait until neither is PENDING.
  await expect(probes).not.toContainText("PENDING", { timeout: 20_000 });

  const text = (await probes.textContent()) ?? "";
  const results = JSON.parse(text) as Record<string, string>;
  expect(results.parentDoc, "parent DOM must be unreachable").toContain("BLOCKED:");
  expect(results.topLoc, "top.location must be unreachable").toContain("BLOCKED:");
  expect(results.cookie, "cookies must be unreadable").toContain("BLOCKED:");
  expect(results.storage, "localStorage must be unreachable").toContain("BLOCKED:");
  expect(results.fetch, "fetch must be CSP-blocked").toContain("BLOCKED:");
  expect(results.img, "remote images must be CSP-blocked").toContain("BLOCKED:");
  expect(text).not.toContain("LEAK:");
});

test("legitimate component renders and reports height", async ({ page }) => {
  const LEGIT = `
    function App() {
      const [n, setN] = React.useState(2);
      return (
        <div id="ok">
          <p>sum is {n + 2}</p>
          <button onClick={() => setN(n + 1)}>bump</button>
        </div>
      );
    }
  `;
  const { frame } = await mountArtifact(page, LEGIT);

  await expect(frame.locator("#ok")).toContainText("sum is 4", {
    timeout: 30_000,
  });
  // Interactivity works inside the sandbox.
  await frame.locator("button").click();
  await expect(frame.locator("#ok")).toContainText("sum is 5");
  // The runtime posted ready + at least one height message to the parent.
  const msgs = await page.evaluate(
    () => (window as unknown as { __msgs: { type?: string }[] }).__msgs,
  );
  expect(msgs.some((m) => m.type === "ready")).toBe(true);
  expect(msgs.some((m) => m.type === "height")).toBe(true);
});
