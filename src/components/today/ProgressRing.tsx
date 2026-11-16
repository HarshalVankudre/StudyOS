import { cn } from "@/lib/utils";

/**
 * "1 of 4 done" as a ring: a soft track with a lime arc that starts at the
 * top, and the count in the middle. No hooks, so it renders on the server
 * (the landing page's sample) as well as in the live Today plan. `label` is
 * the full sentence for screen readers; the figures inside are decorative.
 *
 * `children` replaces the count in the middle (the focus timer's countdown).
 * `decorative` drops the progressbar role, for when the middle already says
 * everything to screen readers (the countdown is a role="timer").
 */
export function ProgressRing({
  done,
  total,
  label,
  caption,
  size = 120,
  decorative = false,
  className,
  children,
}: {
  done: number;
  total: number;
  /** Accessible name, e.g. "Today's plan". */
  label?: string;
  /** The same progress as a sentence, e.g. "1 of 4 done" (read out as the value). */
  caption?: string;
  size?: number;
  decorative?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const stroke = Math.round(size * 0.1);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const a11y = decorative
    ? {}
    : {
        role: "progressbar",
        "aria-label": label,
        "aria-valuemin": 0,
        "aria-valuemax": total,
        "aria-valuenow": done,
        "aria-valuetext": caption,
      };

  return (
    <div
      {...a11y}
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden focusable="false">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-2"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
          className="stroke-lime transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
        />
      </svg>
      {children ?? (
        <span aria-hidden className="font-display text-[1.6rem] leading-none tabular-nums text-ink">
          {done}
          <span className="mx-0.5 text-ink-faint">/</span>
          {total}
        </span>
      )}
    </div>
  );
}
