import { contrastText, spineDesign, spineInitial } from "@/lib/covers";
import { cn } from "@/lib/cn";
import { es } from "@/i18n/es";

export function Cover({
  title,
  genres = [],
  className,
  size = "md",
  showInitial = true,
}: {
  title: string;
  genres?: string[];
  className?: string;
  size?: "sm" | "md" | "lg";
  showInitial?: boolean;
}) {
  const design = spineDesign(title, genres);
  const genre = genres[0];
  return (
    <div
      role="img"
      aria-label={`Lomo tipográfico de «${title}»`}
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden rounded-[2px] border border-black/20 shadow-[var(--shadow-lift)]",
        size === "sm" && "h-[170px] w-9",
        size === "md" && "h-[210px] w-11",
        size === "lg" && "h-[238px] w-[54px]",
        className,
      )}
      style={{
        backgroundColor: design.background,
        color: contrastText(design.background),
        fontFamily: design.face,
        height: `${size === "sm" ? design.height - 30 : size === "lg" ? design.height : design.height - 10}px`,
        width: `${size === "sm" ? Math.max(34, design.width - 8) : size === "lg" ? design.width : Math.max(38, design.width - 4)}px`,
      }}
    >
      <span className="absolute inset-x-0 top-3 h-1" style={{ backgroundColor: design.ornament }} aria-hidden="true" />
      <span className="absolute inset-x-0 bottom-5 h-px" style={{ backgroundColor: design.ornament }} aria-hidden="true" />
      <span
        className="absolute inset-x-0 bottom-0 flex h-4 items-center justify-center text-[0.55rem]"
        style={{ backgroundColor: design.spine }}
        aria-hidden="true"
      >
        {showInitial ? spineInitial(title) : ""}
      </span>
      <span
        className="spine-title absolute left-1/2 top-1/2 max-h-[88%] -translate-x-1/2 -translate-y-1/2 overflow-hidden text-center text-[0.78rem] leading-none"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        {title}
      </span>
      <span className="sr-only">{genre ? `${genre}. ` : ""}{es.common.snapshot}</span>
    </div>
  );
}
