import type { InputPoint, Stroke } from './model';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Vec {
  x: number;
  y: number;
}

// Strokes are immutable (ops replace them), so caching by identity is safe.
const boundsCache = new WeakMap<Stroke, Bounds>();

export function strokeBounds(s: Stroke): Bounds {
  let b = boundsCache.get(s);
  if (b) return b;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = s.width / 2;
  b = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  boundsCache.set(s, b);
  return b;
}

export function unionBounds(strokes: Stroke[]): Bounds | null {
  if (!strokes.length) return null;
  const out = { ...strokeBounds(strokes[0]) };
  for (const s of strokes) {
    const b = strokeBounds(s);
    out.minX = Math.min(out.minX, b.minX);
    out.minY = Math.min(out.minY, b.minY);
    out.maxX = Math.max(out.maxX, b.maxX);
    out.maxY = Math.max(out.maxY, b.maxY);
  }
  return out;
}

export function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Does a circle of radius r at (x, y) touch the stroke's inked area? */
export function strokeHitsCircle(s: Stroke, x: number, y: number, r: number): boolean {
  const b = strokeBounds(s);
  if (x < b.minX - r || x > b.maxX + r || y < b.minY - r || y > b.maxY + r) return false;
  const reach = r + s.width / 2;
  const reachSq = reach * reach;
  const pts = s.points;
  if (pts.length === 1) return (pts[0].x - x) ** 2 + (pts[0].y - y) ** 2 <= reachSq;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegmentSq(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= reachSq) return true;
  }
  return false;
}

export function pointInPolygon(x: number, y: number, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Strokes with at least half their points inside the lasso are selected. */
export function strokesInLasso(strokes: Stroke[], poly: Vec[]): string[] {
  if (poly.length < 3) return [];
  return strokes
    .filter((s) => {
      let inside = 0;
      for (const p of s.points) if (pointInPolygon(p.x, p.y, poly)) inside++;
      return inside / s.points.length >= 0.5;
    })
    .map((s) => s.id);
}

export function pointsLength(pts: InputPoint[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}
