import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  className?: string;
}) {
  return (
    <header className={cn("mb-8 border-b border-[rgba(243,240,250,0.18)] pb-6", className)}>
      {back ? (
        <Link
          to={back.to}
          className="mb-4 inline-flex items-center gap-1.5 text-[0.82rem] font-semibold text-brass-text underline decoration-[rgba(122,95,34,0.4)] underline-offset-4 hover:text-oxblood"
        >
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <h1 className="display-title text-4xl text-ink sm:text-5xl">{title}</h1>
          {description ? (
            <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-[rgba(243,240,250,0.74)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
