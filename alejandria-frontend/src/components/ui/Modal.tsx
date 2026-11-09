import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  trigger?: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      ) : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgba(35,26,18,0.48)] backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-[rgba(243,240,250,0.24)] bg-surface p-6 text-ink shadow-[var(--shadow-dialog)] sm:p-8",
            wide ? "max-w-3xl" : "max-w-lg",
          )}
        >
          <div className="mb-5 border-b border-[rgba(243,240,250,0.16)] pb-4">
            <DialogPrimitive.Title className="display-title text-3xl">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-2 text-[0.9rem] leading-relaxed text-[rgba(243,240,250,0.72)]">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {children}
          {footer ? (
            <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-[rgba(243,240,250,0.16)] pt-5">
              {footer}
            </div>
          ) : null}
          <DialogPrimitive.Close
            className="absolute right-4 top-3 p-1 text-[rgba(243,240,250,0.62)] hover:text-ink"
            aria-label="Cerrar"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ×
            </span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
