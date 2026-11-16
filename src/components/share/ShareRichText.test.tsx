import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

// The renderer itself is covered by rehype-share.test.tsx; here, what it is given.
vi.mock("streamdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("streamdown")>();
  return {
    ...actual,
    Streamdown: (props: Record<string, unknown>) => {
      m.props.push(props);
      return <div>{String(props.children)}</div>;
    },
  };
});

import { rehypeShareScope } from "@/lib/share/rehype-share";
import { ShareOriginsProvider, ShareRichText } from "./ShareRichText";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

beforeEach(() => {
  m.props.length = 0;
});

describe("ShareRichText", () => {
  it("renders math, code and CJK but never loads Mermaid", () => {
    render(<ShareRichText text={"```mermaid\ngraph TD; A-->B\n```"} token={TOKEN} />);
    const plugins = m.props[0].plugins as Record<string, unknown>;
    expect(Object.keys(plugins).sort()).toEqual(["cjk", "code", "math"]);
    expect(plugins).not.toHaveProperty("mermaid");
  });

  it("scopes links and images with the share's token and StudyOS's own origins", () => {
    render(
      <ShareOriginsProvider origins={["https://studyos.app"]}>
        <ShareRichText text="[x](https://studyos.app/app/w)" token={TOKEN} />
      </ShareOriginsProvider>,
    );
    const rehype = m.props[0].rehypePlugins as unknown[];
    expect(rehype[rehype.length - 1]).toEqual([rehypeShareScope, { token: TOKEN, origins: ["https://studyos.app"] }]);
  });
});
