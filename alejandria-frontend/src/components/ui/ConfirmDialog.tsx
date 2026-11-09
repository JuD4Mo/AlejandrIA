import { useState, type ReactNode } from "react";
import { es } from "@/i18n/es";
import { Button } from "./Button";
import { Modal } from "./Modal";

export function ConfirmDialog({
  trigger,
  title,
  body,
  confirmLabel = es.common.confirm,
  cancelLabel = es.common.cancel,
  destructive = false,
  onConfirm,
  loading = false,
}: {
  trigger: ReactNode;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => unknown;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Modal
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={body}
        trigger={trigger}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? "danger" : "primary"}
              loading={loading}
              onClick={async () => {
                await onConfirm();
                setOpen(false);
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <p className="text-[0.9rem] text-[rgba(243,240,250,0.7)]">
          {es.common.confirm} para continuar.
        </p>
      </Modal>
  );
}
