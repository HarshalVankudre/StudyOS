"use client";

import { createContext, memo, useContext, useMemo, type ReactNode } from "react";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { Streamdown } from "streamdown";
import { sanitizeLatexText } from "@/lib/ai/sanitize";
import { rehypeShareScope, type ShareScopeOptions } from "@/lib/share/rehype-share";
import { streamdownRehypePlugins } from "@/lib/streamdown-plugins";
import { cn } from "@/lib/utils";

/**
 * The plugins of a shared page's Markdown: the app's set
 * (lib/streamdown-plugins) without Mermaid, which turns someone else's text
 * into a diagram by running its own renderer on it. Math, code highlighting
 * (no code is run) and CJK stay. A Mermaid block shows as its source.
 */
const SHARE_PLUGINS = {
  cjk,
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
};

const NO_ORIGINS: readonly string[] = [];
const ShareOriginsContext = createContext<readonly string[]>(NO_ORIGINS);

/** StudyOS's own origins for the shared page's links (from the server, so both renders agree). */
export function ShareOriginsProvider({ origins, children }: { origins: readonly string[]; children: ReactNode }) {
  return <ShareOriginsContext value={origins}>{children}</ShareOriginsContext>;
}

/**
 * Markdown + math on a shared page: the app's own renderer (RichText) with
 * one more step, rehypeShareScope, so uploaded images load through the
 * share's asset route, other images do not load at all and links into
 * StudyOS read as plain text (lib/share/rehype-share.ts). The text takes its
 * direction from itself, like RichText.
 */
export const ShareRichText = memo(function ShareRichText({
  text,
  token,
  className,
}: {
  text: string;
  token: string;
  className?: string;
}) {
  const origins = useContext(ShareOriginsContext);
  const rehypePlugins = useMemo(
    () => [
      ...streamdownRehypePlugins,
      [rehypeShareScope, { token, origins }] as [typeof rehypeShareScope, ShareScopeOptions],
    ],
    [token, origins],
  );
  return (
    <div dir="auto" className="contents">
      <Streamdown
        mode="static"
        className={cn("[&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
        plugins={SHARE_PLUGINS}
        rehypePlugins={rehypePlugins}
      >
        {sanitizeLatexText(text)}
      </Streamdown>
    </div>
  );
});
