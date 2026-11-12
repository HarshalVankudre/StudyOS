"use client";

import { memo } from "react";
import { Streamdown } from "streamdown";
import { sanitizeLatexText } from "@/lib/ai/sanitize";
import { streamdownPlugins, streamdownRehypePlugins } from "@/lib/streamdown-plugins";
import { cn } from "@/lib/utils";

export type RichTextProps = {
  text: string;
  className?: string;
};

/**
 * Read-only Markdown + KaTeX renderer for note-block text. Sanitizes stray
 * LaTeX text commands (\texttt{}, \textbf{}, ...) to Markdown at render time so
 * existing AI-generated notes render without a data migration; real $...$ /
 * $...$ math is preserved and typeset by KaTeX.
 *
 * The text is the student’s (or the AI’s) content, so it takes its direction
 * from itself (dir="auto"), not from the interface language: English notes
 * stay left-to-right in the Arabic interface and vice versa.
 */
export const RichText = memo(function RichText({ text, className }: RichTextProps) {
  return (
    <div dir="auto" className="contents">
      <Streamdown
        className={cn("[&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
        plugins={streamdownPlugins}
        // Images only from our own origin and asset routes (no exfiltration).
        rehypePlugins={streamdownRehypePlugins}
      >
        {sanitizeLatexText(text)}
      </Streamdown>
    </div>
  );
});
