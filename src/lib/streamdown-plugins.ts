import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { defaultRehypePlugins } from "streamdown";
import { rehypeRestrictImages } from "@/lib/markdown-images";

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

/**
 * Streamdown's own rehype pipeline (raw HTML, sanitize, harden) plus our image
 * restriction last. Streamdown's default harden step allows images from any
 * URL (`allowedImagePrefixes: ["*"]`); rehypeRestrictImages narrows that to
 * the app's own origin and asset routes (see src/lib/markdown-images.ts).
 * Passing `rehypePlugins` replaces Streamdown's defaults, so they are listed
 * here explicitly.
 */
export const streamdownRehypePlugins = [
  ...Object.values(defaultRehypePlugins),
  rehypeRestrictImages,
];
