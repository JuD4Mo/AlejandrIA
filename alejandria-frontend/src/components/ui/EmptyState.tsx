import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "paper-panel flex flex-col items-start gap-3 px-6 py-8 sm:px-8",
        className,
      )}
    >
      {icon ? <div className="text-brass-text">{icon}</div> : null}
      <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
      {body ? (
        <p className="max-w-xl text-[0.92rem] leading-relaxed text-[rgba(243,240,250,0.72)]">
          {body}
        </p>
      ) : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
