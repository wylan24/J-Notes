// Dashed and dotted lines: a stroke's points cut into dashes, or reduced to evenly spaced dots,
// measured along the line so the rhythm is even however fast it was drawn.
import type { InputPoint } from './model';

/** Dash and gap lengths for a line of this width, in page units. */
export function dashLengths(width: number): { on: number; off: number } {
  return { on: Math.max(5, width * 4), off: Math.max(4, width * 2.6) };
}

/** Distance between dot centres for a line of this width. */
export function dotSpacing(width: number): number {
  return Math.max(4, width * 2.4);
}

const lerp = (a: InputPoint, b: InputPoint, t: number): InputPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t });

/** The parts of a line that are drawn, `on` long with `off` gaps, starting with a dash. */
export function splitDashes(points: readonly InputPoint[], on: number, off: number): InputPoint[][] {
  if (points.length < 2) return points.length ? [[points[0]]] : [];
  const out: InputPoint[][] = [];
  let drawing = true;
  let left = on; // distance until the current dash or gap ends
  let current: InputPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1];
    const b = points[i];
    let len = Math.hypot(b.x - a.x, b.y - a.y);
    while (len > left) {
      const cut = lerp(a, b, left / len);
      if (drawing) {
        current.push(cut);
        out.push(current);
      } else current = [cut];
      len -= left;
      a = cut;
      drawing = !drawing;
      left = drawing ? on : off;
    }
    left -= len;
    if (drawing) current.push(b);
  }
  if (drawing && current.length > 1) out.push(current);
  return out;
}

/** Dot centres every `spacing` along a line, starting at its first point. */
export function dotCentres(points: readonly InputPoint[], spacing: number): InputPoint[] {
  if (!points.length) return [];
  const out = [points[0]];
  let left = spacing;
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1];
    const b = points[i];
    let len = Math.hypot(b.x - a.x, b.y - a.y);
    while (len >= left) {
      const dot = lerp(a, b, left / len);
      out.push(dot);
      len -= left;
      a = dot;
      left = spacing;
    }
    left -= len;
  }
  return out;
}

/** A dot as a polygon (smoothed into a circle when painted). */
export function dotPolygon(c: { x: number; y: number }, r: number, sides = 12): number[][] {
  return Array.from({ length: sides }, (_, i) => {
    const t = (i / sides) * Math.PI * 2;
    return [c.x + Math.cos(t) * r, c.y + Math.sin(t) * r];
  });
}
