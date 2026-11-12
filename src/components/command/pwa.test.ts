import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LOCALES } from "@/lib/i18n/config";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("web app manifest", () => {
  const m = manifest();
  it("installs as a standalone app that starts in /app", () => {
    expect(m).toMatchObject({ name: "StudyOS", start_url: "/app", display: "standalone" });
    expect(m.background_color).toBe("#0b0b0a");
    expect(m.theme_color).toBe("#0b0b0a");
  });
  it("points at icons that exist, including maskable ones", () => {
    for (const icon of m.icons ?? []) expect(existsSync(join(root, "public", icon.src))).toBe(true);
    expect(m.icons?.some((i) => i.purpose === "maskable" && i.sizes === "512x512")).toBe(true);
    expect(m.icons?.some((i) => i.purpose === "any" && i.sizes === "192x192")).toBe(true);
  });
});

describe("service worker", () => {
  const sw = read("public/sw.js");
  it("precaches only the static offline page and its icon", () => {
    expect(sw).toContain('const OFFLINE_URL = "/offline.html";');
    expect(sw).toContain('const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];');
    // The only cache writes are the install-time precache.
    expect(sw.match(/cache\.(put|add)\w*\(/g)).toEqual(["cache.addAll("]);
    expect(sw).not.toMatch(/\/api\//);
  });
  it("answers navigations from the network, falling back offline", () => {
    expect(sw).toContain('request.mode === "navigate"');
    expect(sw).toContain("fetch(request).catch(() => caches.match(OFFLINE_URL))");
  });
});

describe("offline page", () => {
  const html = read("public/offline.html");
  const json = /<script id="strings" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "{}";
  const strings = JSON.parse(json) as Record<string, { title: string; body: string; retry: string }>;

  it("carries the dictionaries' offline strings for every language", async () => {
    for (const { code } of LOCALES) {
      const dict = await getDictionary(code);
      expect(strings[code], code).toEqual(dict.offline);
    }
  });
  it("loads nothing from the network but its cached icon", () => {
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect([...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1])).toEqual(["/icons/icon-192.png"]);
  });
});
