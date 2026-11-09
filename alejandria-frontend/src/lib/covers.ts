export interface SpineDesign {
  background: string;
  spine: string;
  foreground: string;
  ornament: string;
  face: string;
  height: number;
  width: number;
}

const designs: SpineDesign[] = [
  {
    background: "#7A2430",
    spine: "#5d1b25",
    foreground: "#f8f4e8",
    ornament: "#C0A062",
    face: "Playfair Display",
    height: 224,
    width: 48,
  },
  {
    background: "#B5832A",
    spine: "#805d1d",
    foreground: "#1B1A17",
    ornament: "#D9D2BE",
    face: "IBM Plex Sans",
    height: 196,
    width: 40,
  },
  {
    background: "#3E5C76",
    spine: "#29405A",
    foreground: "#f8f4e8",
    ornament: "#C0A062",
    face: "Source Serif 4",
    height: 238,
    width: 54,
  },
  {
    background: "#2F5D50",
    spine: "#214238",
    foreground: "#f8f4e8",
    ornament: "#D9D2BE",
    face: "Playfair Display",
    height: 210,
    width: 44,
  },
  {
    background: "#8A5A44",
    spine: "#684332",
    foreground: "#f8f4e8",
    ornament: "#C0A062",
    face: "Source Serif 4",
    height: 188,
    width: 38,
  },
  {
    background: "#5B4B6B",
    spine: "#443750",
    foreground: "#f8f4e8",
    ornament: "#D9D2BE",
    face: "IBM Plex Sans",
    height: 230,
    width: 50,
  },
];

function hash(input: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export function spineDesign(title: string, genres: string[] = []): SpineDesign {
  const key = `${title.trim().toLocaleLowerCase("es")}|${(genres[0] ?? "")
    .trim()
    .toLocaleLowerCase("es")}`;
  return designs[hash(key) % designs.length];
}

export function spineInitial(title: string): string {
  const first = title.trim().charAt(0);
  return first ? first.toLocaleUpperCase("es") : "A";
}

export function contrastText(background: string): string {
  const hex = background.replace("#", "");
  const channels = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const luminance = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  const relative = 0.2126 * luminance[0] + 0.7152 * luminance[1] + 0.0722 * luminance[2];
  return relative > 0.42 ? "#1B1A17" : "#F8F4E8";
}
