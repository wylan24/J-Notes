// Placing notebook content on PDF pages, for export. Pure, so the geometry can be tested.
//
// Notebook content is in page units with a top-left origin (y down), on the page as displayed.
// A PDF page has its own user space (points, y up) and may be shown rotated by /Rotate and offset
// by its crop box. A placement maps the first into the second, in the form pdf-lib's draw calls take:
// an origin point plus a rotation, with lengths scaled by `s`.

/** Points per page unit: page units are 1/96 in, points 1/72 in. */
export const UNITS_TO_PT = 72 / 96;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface Placement {
  /** Where page-unit point (p, q) lands in PDF user space. */
  at: (p: number, q: number) => [number, number];
  /** Degrees, counter-clockwise, as pdf-lib's `rotate` option. */
  rotate: Rotation;
  /** Points per page unit. */
  s: number;
}

export function normaliseRotation(deg: number): Rotation {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return r as Rotation;
}

/**
 * The placement for a page whose visible area is `box` (its crop box, in points) shown rotated
 * clockwise by `rotation`. Each case maps the displayed top-left corner and axes onto user space.
 */
export function placement(box: Box, rotation: number, s = UNITS_TO_PT): Placement {
  const { x, y, width: w, height: h } = box;
  const rotate = normaliseRotation(rotation);
  switch (rotate) {
    case 0: // displayed right = user +x, displayed down = user -y
      return { rotate, s, at: (p, q) => [x + p * s, y + h - q * s] };
    case 90: // right = +y, down = +x
      return { rotate, s, at: (p, q) => [x + q * s, y + p * s] };
    case 180: // right = -x, down = +y
      return { rotate, s, at: (p, q) => [x + w - p * s, y + q * s] };
    case 270: // right = -y, down = -x
      return { rotate, s, at: (p, q) => [x + w - q * s, y + h - p * s] };
  }
}

/** The page size as displayed, in page units, for a crop box shown at `rotation`. */
export function displayedSize(box: Box, rotation: number, s = UNITS_TO_PT): { w: number; h: number } {
  const quarter = normaliseRotation(rotation) % 180 !== 0;
  return { w: (quarter ? box.height : box.width) / s, h: (quarter ? box.width : box.height) / s };
}

/**
 * Parse a page range like "1-3, 7, 10-" into 0-based page indices, in order and without repeats.
 * Numbers are 1-based and clamped to the notebook; an open end means "to the last page".
 * Returns null if any part isn't a number or range.
 */
export function parsePageRange(text: string, pageCount: number): number[] | null {
  const out: number[] = [];
  const seen = new Set<number>();
  const parts = text.split(',').map((t) => t.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const m = /^(\d*)\s*(?:[-–]\s*(\d*))?$/.exec(part);
    if (!m || (!m[1] && m[2] === undefined)) return null;
    const isRange = part.includes('-') || part.includes('–');
    const a = m[1] ? Number(m[1]) : 1;
    const b = isRange ? (m[2] ? Number(m[2]) : pageCount) : a;
    const lo = Math.max(1, Math.min(a, b));
    const hi = Math.min(pageCount, Math.max(a, b));
    for (let n = lo; n <= hi; n++) {
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n - 1);
      }
    }
  }
  return out;
}

/** A #rgb or #rrggbb colour as 0..1 channels; black if unreadable. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
