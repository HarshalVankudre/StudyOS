import { cn } from "@/lib/utils";

/**
 * The StudyOS mark: a stack of three sheets, the two upper ones in ink (the
 * text colour, so it follows the theme) and the bottom one in lime. It sits
 * before the wordmark in every header and is decorative there, since the
 * word "StudyOS" next to it is the link's name.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={cn("h-[1.15em] w-[1.15em] shrink-0", className)}
    >
      <path d="M12 1.5 21.5 6.6 12 11.7 2.5 6.6Z" fill="currentColor" />
      <path d="M2.5 10.2 12 15.3l9.5-5.1v3.1L12 18.4l-9.5-5.1Z" fill="currentColor" />
      <path d="M2.5 15.2 12 20.3l9.5-5.1v2.2L12 22.5l-9.5-5.1Z" fill="var(--accent)" />
    </svg>
  );
}
