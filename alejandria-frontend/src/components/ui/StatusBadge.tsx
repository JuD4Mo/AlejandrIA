import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "good" | "warn" | "bad" | "quiet";

const tones: Record<Tone, string> = {
  neutral: "badge",
  good: "badge--good",
  warn: "badge--warn",
  bad: "badge--bad",
  quiet: "badge--quiet",
};

/** Colours come from the surrounding surface (see theme.css `.badge*`). */
export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-xs border px-2 py-0.5 text-[0.7rem] font-semibold leading-tight",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
