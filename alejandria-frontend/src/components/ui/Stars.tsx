import { es } from "@/i18n/es";
import { cn } from "@/lib/cn";

export function Stars({
  value,
  onChange,
  readOnly = false,
  disabled = false,
  size = "md",
  className,
}: {
  value: number;
  onChange?: (rating: number) => void;
  readOnly?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dimensions =
    size === "sm" ? "text-lg" : size === "lg" ? "text-3xl" : "text-2xl";
  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      role={readOnly ? "img" : "group"}
      aria-label={es.meta.ratingStars.replace("{{rating}}", String(value))}
    >
      {[1, 2, 3, 4, 5].map((rating) => {
        const filled = rating <= value;
        if (readOnly) {
          return (
            <span
              key={rating}
              aria-hidden="true"
              className={cn(
                dimensions,
                filled ? "text-brass" : "text-[rgba(243,240,250,0.2)]",
              )}
            >
              ★
            </span>
          );
        }
        return (
          <button
            key={rating}
            type="button"
            disabled={disabled}
            aria-label={es.meta.starButton.replace(
              "{{rating}}",
              String(rating),
            )}
            aria-pressed={filled}
            onClick={() => onChange?.(rating)}
            className={cn(
              "leading-none transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50",
              dimensions,
              filled ? "text-brass" : "text-[rgba(243,240,250,0.22)]",
            )}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}
