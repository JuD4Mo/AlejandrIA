export const EASE = [0.2, 0.8, 0.2, 1] as const;

export type SceneMode = "idle" | "focus" | "busy" | "error";

/** Spine cloth palette (decorative). Every entry must pass 4.5:1 with readableOn(). */
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

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Picks paper or ink, whichever reads better on the given cloth color. */
export function readableOn(bg: string): string {
  return contrastRatio(bg, PAPER) >= contrastRatio(bg, INK) ? PAPER : INK;
}
