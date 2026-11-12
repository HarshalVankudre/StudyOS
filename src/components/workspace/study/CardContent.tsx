"use client";

import { RichText } from "@/components/RichText";
import { cn } from "@/lib/utils";

/**
 * One side of a flashcard: Markdown + $math$ rendered with the app's rich
 * text renderer. Line breaks the student typed are kept.
 */
export function CardContent({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("w-full min-w-0 break-words [&_li]:whitespace-pre-line [&_p]:whitespace-pre-line", className)}>
      <RichText text={text} />
    </div>
  );
}
