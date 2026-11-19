// The pencil: ink laid down as overlapping round dabs along the stroke, whose opacity follows
// pressure (pressed harder, darker), filled with a paper-grain texture when painted. Dabs are
// grouped into a few opacity levels so a stroke paints as a handful of fills, not thousands.
import type { InputPoint } from './model';

export const PENCIL_LEVELS = 8;

export interface Dab {
  x: number;
  y: number;
  r: number;
  /** Opacity level, 0..PENCIL_LEVELS-1. */
  level: number;
}

/** The opacity of a level: light pressure is faint, full pressure nearly solid. */
export function pencilAlpha(level: number): number {
  return 0.22 + (0.7 * level) / (PENCIL_LEVELS - 1);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Dabs along a stroke's points, spaced by a fraction of the width. With simulated pressure (mouse,
 * finger) speed stands in for pressure: input arrives at a steady rate, so long gaps mean a fast,
 * light stroke.
 */
export function pencilDabs(points: readonly InputPoint[], width: number, simulatePressure: boolean): Dab[] {
  if (!points.length) return [];
  const spacing = Math.max(0.35, width * 0.3);
  const pressureAt = (i: number): number => {
    if (!simulatePressure) return clamp(points[i].p, 0.05, 1);
    const a = points[Math.max(0, i - 1)];
    const b = points[i];
    const step = Math.hypot(b.x - a.x, b.y - a.y);
    return clamp(1.15 - step / (width * 6 + 4), 0.3, 1);
  };
  const dab = (x: number, y: number, p: number): Dab => ({
    x,
    y,
    r: (width / 2) * (0.75 + 0.25 * p),
    level: clamp(Math.round(((p - 0.05) / 0.95) * (PENCIL_LEVELS - 1)), 0, PENCIL_LEVELS - 1),
  });

  const out: Dab[] = [dab(points[0].x, points[0].y, pressureAt(0))];
  let carry = 0; // distance travelled since the last dab
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const pa = pressureAt(i - 1);
    const pb = pressureAt(i);
    let d = spacing - carry;
    while (d <= len) {
      const t = d / len;
      out.push(dab(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, pa + (pb - pa) * t));
      d += spacing;
    }
    carry = len - (d - spacing);
  }
  return out;
}

/** Dabs grouped by opacity level (empty levels left out). */
export function dabsByLevel(dabs: readonly Dab[]): Map<number, Dab[]> {
  const out = new Map<number, Dab[]>();
  for (const d of dabs) {
    const list = out.get(d.level);
    if (list) list.push(d);
    else out.set(d.level, [d]);
  }
  return out;
}
