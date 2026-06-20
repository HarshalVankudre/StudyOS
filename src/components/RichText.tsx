"use client";

import { memo } from "react";
import { Streamdown } from "streamdown";
import { sanitizeLatexText } from "@/lib/ai/sanitize";
import { streamdownPlugins } from "@/lib/streamdown-plugins";
import { cn } from "@/lib/utils";

export type RichTextProps = {
  text: string;
  className?: string;
};

/**
 * Read-only Markdown + KaTeX renderer for note-block text. Sanitizes stray
 * LaTeX text commands (\texttt{}, \textbf{}, ...) to Markdown at render time so
 * existing AI-generated notes render without a data migration; real $...$ /
 * $$...$$ math is preserved and typeset by KaTeX.
 */
export const RichText = memo(function RichText({ text, className }: RichTextProps) {
  return (
    <Streamdown
      className={cn("[&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      plugins={streamdownPlugins}
    >
      {sanitizeLatexText(text)}
    </Streamdown>
  );
});
