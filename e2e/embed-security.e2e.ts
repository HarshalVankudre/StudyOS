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

// Like mountArtifact, but the parent starts listening only after the frame
// has loaded and announced itself (a slow hydration, a deep link on the dev
// server): it then says "hello", as ReactArtifact.tsx does.
async function mountArtifactLate(page: Page, source: string) {
  await page.goto("/privacy");
  await page.evaluate(async (src) => {
    const w = window as unknown as { __msgs: unknown[] };
    w.__msgs = [];
    const iframe = document.createElement("iframe");
    iframe.id = "artifact";
    iframe.src = "/embed/react";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.width = "600px";
    iframe.style.height = "400px";
    const loaded = new Promise((resolve) => iframe.addEventListener("load", resolve, { once: true }));
    document.body.appendChild(iframe);
    await loaded;
    // The frame's first "ready" went out with nobody listening.
    await new Promise((resolve) => setTimeout(resolve, 300));
    window.addEventListener("message", (ev) => {
      if (ev.source !== iframe.contentWindow) return;
      const data = ev.data as { type?: string };
      w.__msgs.push(data);
      if (data?.type === "ready") iframe.contentWindow?.postMessage({ type: "render", source: src }, "*");
    });
    iframe.contentWindow?.postMessage({ type: "hello" }, "*");
  }, source);
  return { frame: page.frameLocator("#artifact") };
}

const COUNTER = `
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

test("renders when the parent starts listening after the frame said ready", async ({ page }) => {
  const { frame } = await mountArtifactLate(page, COUNTER);
  await expect(frame.locator("#ok")).toContainText("sum is 4", { timeout: 30_000 });
});

test("a repeated handshake does not remount the component or lose its state", async ({ page }) => {
  const { frame } = await mountArtifact(page, COUNTER);
  await expect(frame.locator("#ok")).toContainText("sum is 4", { timeout: 30_000 });
  await frame.locator("button").click();
  await expect(frame.locator("#ok")).toContainText("sum is 5");
  // The parent says hello again (it remounted): the frame answers ready, the
  // parent sends the same source, and the frame keeps what it shows.
  await page.evaluate(() => {
    const iframe = document.getElementById("artifact") as HTMLIFrameElement;
    iframe.contentWindow?.postMessage({ type: "hello" }, "*");
  });
  await page.waitForTimeout(500);
  await expect(frame.locator("#ok")).toContainText("sum is 5");
});

test("a frame stops re-announcing once rendered, and ignores messages from other windows", async ({ page }) => {
  const { frame } = await mountArtifact(page, COUNTER);
  await expect(frame.locator("#ok")).toContainText("sum is 4", { timeout: 30_000 });
  const readies = async () =>
    page.evaluate(() => (window as unknown as { __msgs: { type?: string }[] }).__msgs.filter((m) => m.type === "ready").length);
  const before = await readies();
  await page.waitForTimeout(1500);
  expect(await readies()).toBe(before);
  // A render from a window other than the parent (a nested frame of the
  // page) is ignored by the runtime's source check.
  await page.evaluate(() => {
    const other = document.createElement("iframe");
    other.name = "other";
    document.body.appendChild(other);
  });
  const other = page.frame({ name: "other" });
  expect(other).toBeTruthy();
  // Runs in the nested frame's own realm, so that frame is the message's source.
  await other!.evaluate(() => {
    const target = (window.parent.document.getElementById("artifact") as HTMLIFrameElement).contentWindow;
    target?.postMessage({ type: "render", source: "function App(){ return <p id='evil'>evil</p> }" }, "*");
  });
  await page.waitForTimeout(500);
  await expect(frame.locator("#evil")).toHaveCount(0);
  await expect(frame.locator("#ok")).toContainText("sum is 4");
});

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
