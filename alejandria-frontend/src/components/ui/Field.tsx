import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/cn";

export const inputClass =
  "w-full rounded-xs border border-[rgba(27,26,23,0.3)] bg-ficha px-3 py-2 text-ink placeholder:text-[rgba(27,26,23,0.5)] shadow-[inset_0_1px_2px_rgba(27,26,23,0.08)] focus:border-brass focus:bg-[#f1eee5]";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(inputClass, "min-h-24 resize-y leading-relaxed", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(inputClass, "appearance-auto pr-8", className)}
    {...props}
  />
));
Select.displayName = "Select";

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  return (
    <div className={cn("space-y-1.5", className)}>
      <LabelPrimitive.Root
        htmlFor={id}
        className="flex items-baseline justify-between gap-3 text-[0.82rem] font-semibold text-ink"
      >
        <span>
          {label}
          {required ? (
            <span className="ml-1 text-oxblood" aria-hidden="true">
              *
            </span>
          ) : null}
        </span>
      </LabelPrimitive.Root>
      {children}
      {hint ? (
        <p className="text-[0.78rem] leading-snug text-[rgba(243,240,250,0.68)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="text-[0.8rem] font-medium text-oxblood" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
