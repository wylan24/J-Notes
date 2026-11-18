// Colour picking: HSV for the wheel, HEX in and out, pixels from the page, and custom swatches.
import { parseHexColor } from './folders';

export { parseHexColor };

/** Hue in degrees 0..360, saturation and value 0..1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function hexToHsv(hex: string): Hsv {
  const c = parseHexColor(hex) ?? '#000000';
  const n = parseInt(c.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

/**
 * The wheel: hue goes round (0° at the right, counter-clockwise), saturation grows from the centre
 * to the rim. A point outside the rim picks the colour at the rim.
 */
export function wheelToHs(x: number, y: number, radius: number): { h: number; s: number } {
  const h = ((Math.atan2(-y, x) * 180) / Math.PI + 360) % 360;
  return { h, s: Math.min(1, Math.hypot(x, y) / radius) };
}

export function hsToWheel(h: number, s: number, radius: number): { x: number; y: number } {
  const a = (h * Math.PI) / 180;
  return { x: Math.cos(a) * s * radius, y: -Math.sin(a) * s * radius };
}

/** A page pixel's colour. Pixels are opaque on paper; a transparent one reads as white. */
export function pixelToHex(rgba: ArrayLike<number>): string {
  const a = rgba[3] / 255;
  const mix = (c: number) => c * a + 255 * (1 - a);
  return rgbToHex(mix(rgba[0]), mix(rgba[1]), mix(rgba[2]));
}

export const MAX_SWATCHES = 10;

/** Add a colour to the custom swatches (newest last). An existing one moves to the end; the oldest go past the limit. */
export function addSwatch(list: readonly string[], color: string): string[] {
  const c = parseHexColor(color);
  if (!c) return [...list];
  return [...list.filter((x) => x !== c), c].slice(-MAX_SWATCHES);
}

export function normalizeSwatches(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const c = typeof v === 'string' ? parseHexColor(v) : null;
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(-MAX_SWATCHES);
}

/**
 * How ink of `hex` shows on dark paper, on screen: dark colours have their lightness turned over
 * (black becomes near-white, navy becomes light blue) so they stay readable; light and bright
 * colours are left alone. The stored colour, and exports, are unchanged.
 */
export function forDarkPaper(hex: string): string {
  const norm = parseHexColor(hex);
  if (!norm) return hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(norm.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  if (luminance >= 0.15) return hex;
  // To HSL, flip the lightness, and back.
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const L = Math.min(0.92, Math.max(0.55, 1 - l));
  const C = (1 - Math.abs(2 * L - 1)) * s;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - C / 2;
  const [r1, g1, b1] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
  return rgbToHex(Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255));
}
