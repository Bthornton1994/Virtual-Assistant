/** WCAG 2 relative luminance for a 6-digit hex color. */
export function relativeLuminance(hex: string): number {
  const n = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(n)) {
    throw new Error(`expected 6-digit hex, got ${hex}`);
  }
  const channel = (start: number) => {
    const c = parseInt(n.slice(start, start + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG 2 contrast ratio between two 6-digit hex colors. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

export function parseCssHexToken(source: string, name: string): string {
  const match = source.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) {
    throw new Error(`missing CSS token --${name}`);
  }
  return match[1];
}
