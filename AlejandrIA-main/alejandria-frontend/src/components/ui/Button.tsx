import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "brass";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-brass text-ink border border-brass hover:bg-[#d0ad60] invalid:opacity-60",
  secondary:
    "bg-transparent text-ficha border border-[rgba(232,228,216,0.34)] hover:border-lamp hover:bg-[rgba(232,228,216,0.1)]",
  ghost:
    "bg-transparent text-ficha border border-transparent hover:bg-[rgba(232,228,216,0.1)]",
  danger:
    "bg-transparent text-overdue-red border border-[rgba(166,38,43,0.5)] hover:bg-[rgba(166,38,43,0.1)]",
  brass:
    "bg-brass text-ink border border-brass hover:bg-[#d0ad60]",
};

const sizes: Record<Size, string> = {
  sm: "min-h-8 px-3 py-1 text-[0.8rem]",
  md: "min-h-10 px-4 py-2 text-[0.92rem]",
  lg: "min-h-12 px-6 py-3 text-[1rem]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      asChild = false,
      icon,
      children,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const Component = asChild ? Slot : "button";
    const content = loading ? (
      <Spinner className="size-4" />
    ) : icon ? (
      <>
        {icon}
        {children}
      </>
    ) : (
      children
    );
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : type}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xs font-body font-semibold tracking-[0.005em] transition-colors disabled:cursor-not-allowed disabled:opacity-55",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {content}
      </Component>
    );
  },
);
Button.displayName = "Button";
