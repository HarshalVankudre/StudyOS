"use client";

import { RichText } from "@/components/RichText";
import { cn } from "@/lib/utils";
import type { SourceRef } from "@/lib/workspace/types";
import { SourceChip } from "./SourceChip";

/**
 * One side of a flashcard: Markdown + $math$ rendered with the app's rich
 * text renderer. Line breaks the student typed are kept. Pass `source` to show
 * where the card came from (a small chip under the text).
 */
export function CardContent({
  text,
  className,
  source,
}: {
  text: string;
  className?: string;
  source?: SourceRef;
}) {
  return (
    <div className={cn("w-full min-w-0 break-words [&_li]:whitespace-pre-line [&_p]:whitespace-pre-line", className)}>
      <RichText text={text} />
      {source && (
        <div className="mt-2 flex justify-center">
          <SourceChip source={source} />
        </div>
      )}
    </div>
  );
}
