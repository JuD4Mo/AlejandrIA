import { Button } from "./ui/Button";

export function LoadMore({
  onClick,
  loading = false,
  label,
  note,
}: {
  onClick: () => void;
  loading?: boolean;
  label: string;
  note?: string;
}) {
  return (
    <div className="mt-6 flex flex-col items-center gap-2 border-t border-line pt-6">
      {note ? (
        <p className="text-[0.78rem] text-fg-subtle">{note}</p>
      ) : null}
      <Button variant="secondary" onClick={onClick} loading={loading}>
        {label}
      </Button>
    </div>
  );
}
