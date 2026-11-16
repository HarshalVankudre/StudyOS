import { render } from "@testing-library/react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { describe, expect, it } from "vitest";
import { rehypeRestrictImages } from "@/lib/markdown-images";
import { rehypeShareScope, shareImageSrc, shareLinkKind } from "./rehype-share";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

// Streamdown's own pipeline, the app's image restriction, then the share
// scope: exactly what ShareRichText composes (minus the heavy code, math and
// mermaid plugins, which do not touch links or images).
const ORIGINS = ["https://studyos.app", "https://app.studyos.app"];
const rehypePlugins = [
  ...Object.values(defaultRehypePlugins),
  rehypeRestrictImages,
  [rehypeShareScope, { token: TOKEN, origins: ORIGINS }] as [
    typeof rehypeShareScope,
    { token: string; origins: string[] },
  ],
];

function renderMarkdown(markdown: string) {
  return render(
    <Streamdown mode="static" rehypePlugins={rehypePlugins}>
      {markdown}
    </Streamdown>,
  );
}

// Streamdown renders a link as its link-safety button (confirm, then open
// in a new tab without a referrer), so "a link" is either element.
const links = (container: HTMLElement) => container.querySelectorAll('a, [data-streamdown="link"]');

describe("links on a shared page", () => {
  it("make a link to another page of the workspace plain text", () => {
    const { container } = renderMarkdown("See [my notes](/app/abc?page=p2) and [more](/s/other).");
    expect(links(container)).toHaveLength(0);
    expect(container.textContent).toContain("See my notes and more.");
  });

  it("make a relative link no link at all", () => {
    const { container } = renderMarkdown("[this](?page=p3) [that](notes.md)");
    expect(links(container)).toHaveLength(0);
    expect(container.textContent).toContain("this");
  });

  it("make a link into the app on StudyOS's own hosts plain text", () => {
    const { container } = renderMarkdown(
      "[open](https://studyos.app/app/abc?page=p2) [feed](https://app.studyos.app/api/calendar/x) [up](HTTPS://STUDYOS.APP/APP)",
    );
    expect(links(container)).toHaveLength(0);
    expect(container.textContent).toContain("open feed up");
  });

  it("keep other sites' /app and /api pages, and StudyOS's public pages", () => {
    const { container } = renderMarkdown(
      "[docs](https://developer.example.com/api/reference) [store](https://apps.example.org/app/123) [pricing](https://studyos.app/pricing)",
    );
    expect([...links(container)].map((l) => l.textContent)).toEqual(["docs", "store", "pricing"]);
  });

  it("keep web links (behind Streamdown's link-safety confirmation)", () => {
    const { container } = renderMarkdown("Read [the paper](https://example.org/paper).");
    const found = links(container);
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toBe("the paper");
  });

  it("mark kept links as user content opening without a referrer (for renderers that use them)", () => {
    const tree = {
      type: "root",
      children: [{ type: "element", tagName: "a", properties: { href: "https://example.org" }, children: [] }],
    };
    rehypeShareScope({ token: TOKEN })(tree);
    expect(tree.children[0].properties).toMatchObject({
      rel: ["nofollow", "ugc", "noopener", "noreferrer"],
      target: "_blank",
    });
  });

  it("classify hrefs", () => {
    expect(shareLinkKind("https://example.org")).toBe("keep");
    expect(shareLinkKind("https://x.y/app")).toBe("keep");
    expect(shareLinkKind("https://x.y/api/v1", ORIGINS)).toBe("keep");
    expect(shareLinkKind("#section")).toBe("anchor");
    expect(shareLinkKind("https://studyos.app/app", ORIGINS)).toBe("text");
    expect(shareLinkKind("https://studyos.app/apple", ORIGINS)).toBe("keep");
    // The same host on another port or scheme is another origin.
    expect(shareLinkKind("http://studyos.app/app/w1", ORIGINS)).toBe("keep");
    for (const href of ["/app/w1", "//studyos.app/app/w1", "?page=p", "notes.md", "mailto:a@b.c", "javascript:alert(1)", undefined]) {
      expect(shareLinkKind(href, ORIGINS), String(href)).toBe("text");
    }
  });
});

describe("images on a shared page", () => {
  it("load an uploaded image through the share's own route", () => {
    const { container } = renderMarkdown("![chart](/api/asset/asset_1)");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`/s/${TOKEN}/asset/asset_1`);
  });

  it("load an absolute asset link through the share's route too", () => {
    const { container } = renderMarkdown("![chart](https://studyos.app/api/asset/asset_2)");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`/s/${TOKEN}/asset/asset_2`);
  });

  it("never load any other path of the site with the visitor's cookies, keeping the alt text", () => {
    const { container } = renderMarkdown("![pixel](/api/agent?x=1) and ![ext](https://evil.example/p.png)");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("pixel and ext");
  });

  it("decide image sources", () => {
    expect(shareImageSrc("data:image/png;base64,AAAA", TOKEN)).toBe("data:image/png;base64,AAAA");
    expect(shareImageSrc("/api/asset/a_b-c", TOKEN)).toBe(`/s/${TOKEN}/asset/a_b-c`);
    expect(shareImageSrc("/icons/x.png", TOKEN)).toBeNull();
    expect(shareImageSrc("/api/asset/../x", TOKEN)).toBeNull();
    expect(shareImageSrc(42, TOKEN)).toBeNull();
  });
});
