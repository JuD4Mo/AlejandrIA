import { cn } from "@/lib/cn";

type Tone = "neutral" | "good" | "warn" | "bad" | "quiet";

const tones: Record<Tone, string> = {
  neutral:
    "border-[rgba(243,240,250,0.25)] bg-[rgba(243,240,250,0.05)] text-ink",
  good: "border-[rgba(51,69,59,0.4)] bg-[rgba(51,69,59,0.1)] text-[#2c4034]",
  warn: "border-[rgba(122,95,34,0.45)] bg-[rgba(168,134,59,0.14)] text-[#67501d]",
  bad: "border-[rgba(107,32,36,0.4)] bg-[rgba(107,32,36,0.1)] text-oxblood",
  quiet:
    "border-transparent bg-transparent text-[rgba(243,240,250,0.6)]",
};

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
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
