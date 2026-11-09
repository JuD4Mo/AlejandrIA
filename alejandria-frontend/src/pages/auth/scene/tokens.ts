export const EASE = [0.2, 0.8, 0.2, 1] as const;

export type SceneMode = "idle" | "focus" | "busy" | "error";

export const CLOTH = {
  oxblood: "#7A2430",
  ochre: "#B5832A",
  slate: "#3E5C76",
  pine: "#2F5D50",
  russet: "#8A5A44",
  plum: "#5B4B6B",
  sand: "#C0A062",
  navy: "#29405A",
  moss: "#5F6B4D",
  rust: "#9A4B2E",
  bone: "#D9D2BE",
  charcoal: "#3A3A3A",
} as const;

const PAPER = "#F4F1E6";
const INK = "#1B1A17";

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

export function contrastRatio(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

export function readableOn(background: string): string {
  return contrastRatio(background, PAPER) >= contrastRatio(background, INK)
    ? PAPER
    : INK;
}
