// A straight-edge overlay. Geometry is in any one coordinate space (the UI uses screen pixels);
// edges can be mapped into page space with `mapEdge` since the mapping is a uniform scale + offset.
import type { Vec } from './geometry';

export interface Ruler {
  cx: number;
  cy: number;
  /** Radians, clockwise on screen. Snapped to 45° steps when close. */
  angle: number;
  /** The unsnapped angle, so small turns add up rather than sticking at a snap point. */
  free?: number;
  length: number;
  width: number;
}

/** One long side: a point on it, its direction, and the normal pointing away from the ruler. */
export interface Edge {
  p: Vec;
  dir: Vec;
  normal: Vec;
  /** Half the ruler's length: how far the edge extends either side of `p`. */
  half: number;
}

const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v); // no -0 or 6e-17 from cos/sin

export function rulerEdges(r: Ruler): [Edge, Edge] {
  const dir = { x: clean(Math.cos(r.angle)), y: clean(Math.sin(r.angle)) };
  const up = { x: clean(dir.y), y: clean(-dir.x) }; // the side above the ruler when level
  const h = r.width / 2;
  const edge = (n: Vec): Edge => ({ p: { x: r.cx + n.x * h, y: r.cy + n.y * h }, dir, normal: n, half: r.length / 2 });
  return [edge(up), edge({ x: clean(-up.x), y: clean(-up.y) })];
}

/** The edge `pt` is next to: outside the ruler (or just inside its border), within `reach`, and alongside it. */
export function edgeNear(pt: Vec, edges: readonly Edge[], reach: number): Edge | null {
  let best: Edge | null = null;
  let bestD = Infinity;
  for (const e of edges) {
    const d = dot(sub(pt, e.p), e.normal);
    const along = Math.abs(dot(sub(pt, e.p), e.dir));
    if (d < -4 || d > reach || along > e.half + reach) continue;
    if (Math.abs(d) < bestD) [best, bestD] = [e, Math.abs(d)];
  }
  return best;
}

/** The point on `e` nearest `pt`, moved `offset` outward (half the nib width keeps ink against the edge). */
export function projectToEdge(pt: Vec, e: Edge, offset: number): Vec {
  const t = dot(sub(pt, e.p), e.dir);
  return { x: e.p.x + e.dir.x * t + e.normal.x * offset, y: e.p.y + e.dir.y * t + e.normal.y * offset };
}

/** Move an edge into another space related by a uniform scale `k` and offset (directions are unchanged). */
export function mapEdge(e: Edge, map: (v: Vec) => Vec, k: number): Edge {
  return { ...e, p: map(e.p), half: e.half * k };
}

const SNAP = (1.5 * Math.PI) / 180;
const snap45 = (a: number) => {
  const q = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  return Math.abs(a - q) < SNAP ? q + 0 : a;
};

/** Set the angle, snapping to multiples of 45° (horizontal, diagonal, vertical) when close. */
export function setRulerAngle(r: Ruler, angle: number): Ruler {
  return { ...r, angle: snap45(angle), free: angle };
}

/** Turn by `delta` from the unsnapped angle. */
export function rotateRuler(r: Ruler, delta: number): Ruler {
  return setRulerAngle(r, (r.free ?? r.angle) + delta);
}

/** Two fingers moved from `from` to `to`: translate by their midpoint and turn by their angle. */
export function twoFingerRuler(r: Ruler, from: [Vec, Vec], to: [Vec, Vec]): Ruler {
  const mid = (p: [Vec, Vec]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const ang = (p: [Vec, Vec]) => Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
  const m0 = mid(from), m1 = mid(to);
  return rotateRuler({ ...r, cx: r.cx + m1.x - m0.x, cy: r.cy + m1.y - m0.y }, ang(to) - ang(from));
}

/** The angle shown on the ruler, in whole degrees within 0–179 (a ruler has no front or back). */
export function rulerDegrees(r: Ruler): number {
  const d = Math.round((r.angle * 180) / Math.PI) % 180;
  return d < 0 ? d + 180 : d;
}
