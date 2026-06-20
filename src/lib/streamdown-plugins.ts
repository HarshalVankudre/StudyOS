import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";

/**
 * Streamdown plugin set shared by the AI chat (message.tsx) and the note-block
 * renderer (RichText). Single source of truth so both render identically:
 * Markdown + KaTeX math (single- and double-dollar) + code + mermaid + CJK.
 */
export const streamdownPlugins = {
  cjk,
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid,
};
