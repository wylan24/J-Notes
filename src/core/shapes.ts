import type { InputPoint } from './model';
import { distToSegmentSq, pointsLength, type Vec } from './geometry';

// Shape recognition for the Shapes tool and for hold-to-snap with the pen.
// A recognised shape is turned back into ordinary stroke points (shapePaths), so
// the eraser, lasso and undo treat it like any other ink.

export type PolygonKind = 'rectangle' | 'triangle' | 'polygon';

export type Shape =
  | { kind: 'line'; a: Vec; b: Vec }
  | { kind: 'arrow'; tail: Vec; tip: Vec }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation: number }
  | { kind: PolygonKind; points: Vec[] };

const MIN_SIZE = 24; // page units; smaller strokes are never shapes
const SAMPLES = 128;
const MAX_ELLIPSE_ERR = 0.035; // mean deviation / bbox diagonal
const MAX_POLYGON_ERR = 0.025;
const SNAP_ANGLE = (10 * Math.PI) / 180;
const TREMOR = 5; // page units of hand wobble that every tolerance allows, however small the shape

/**
 * "Hold to straighten": if a stroke is roughly straight when the user pauses
 * at its end, return its endpoints so the caller can snap it to a line.
 */
export function detectLine(points: InputPoint[]): { a: InputPoint; b: InputPoint } | null {
  if (points.length < 2) return null;
  const a = points[0];
  const b = points[points.length - 1];
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (chord < MIN_SIZE) return null;
  if (pointsLength(points) / chord > 1.2) return null; // too wiggly / doubles back
  let maxDevSq = 0;
  for (const p of points) maxDevSq = Math.max(maxDevSq, distToSegmentSq(p.x, p.y, a.x, a.y, b.x, b.y));
  return Math.sqrt(maxDevSq) / chord < 0.08 ? { a, b } : null;
}

/** Evenly spaced constant-pressure points along a line (renders with uniform width). */
export function linePoints(a: Vec, b: Vec): InputPoint[] {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / n,
    y: a.y + ((b.y - a.y) * i) / n,
    p: 0.5,
  }));
}

/** Recognise a freehand stroke as a line, arrow, ellipse, rectangle, triangle or polygon. */
export function recognizeShape(points: InputPoint[]): Shape | null {
  if (points.length < 2) return null;
  const size = diag(points);
  if (size < MIN_SIZE) return null;
  const line = detectLine(points);
  if (line) return { kind: 'line', a: xy(line.a), b: xy(line.b) };

  const pts = smooth(resample(points, SAMPLES));
  const loop = closedLoop(pts, size);
  if (!loop) return detectArrow(pts, size) ?? detectArrow([...pts].reverse(), size);

  const ring = resample(loop, SAMPLES);
  const ell = fitEllipse(ring);
  const errE = ell ? meanError(ring, (p) => ellipseDist(ell, p)) / size : Infinity;
  const poly = fitPolygon(ring, size);
  const errP = poly ? meanError(ring, (p) => polygonDist(poly, p)) / size : Infinity;

  // A rough circle also simplifies to a 5–6-gon, so those must fit clearly better than an ellipse.
  // Rounded-corner rectangles fit an ellipse deceptively well, so 3–4-gons only need to fit better.
  const margin = poly && poly.length <= 4 ? 1 : 0.6;
  if (poly && errP < MAX_POLYGON_ERR && errP < errE * margin) return regularizePolygon(poly);
  if (ell && errE < MAX_ELLIPSE_ERR) return snapEllipse(ell);
  return null;
}

/** Constant-pressure point paths that draw the shape. Arrows are two paths (shaft and head). */
export function shapePaths(shape: Shape): InputPoint[][] {
  switch (shape.kind) {
    case 'line':
      return [linePoints(shape.a, shape.b)];
    case 'arrow': {
      const { tail, tip } = shape;
      const len = Math.hypot(tip.x - tail.x, tip.y - tail.y);
      if (len < 1e-6) return [linePoints(tail, tip)];
      const ux = (tail.x - tip.x) / len;
      const uy = (tail.y - tip.y) / len;
      const head = Math.min(36, Math.max(10, len * 0.22));
      const barb = (sign: number): Vec => {
        const a = sign * (Math.PI / 7);
        const c = Math.cos(a), s = Math.sin(a);
        return { x: tip.x + (ux * c - uy * s) * head, y: tip.y + (ux * s + uy * c) * head };
      };
      return [linePoints(tail, tip), [...linePoints(barb(1), tip), ...linePoints(tip, barb(-1)).slice(1)]];
    }
    case 'ellipse': {
      const { cx, cy, rx, ry, rotation } = shape;
      // Ramanujan's perimeter approximation, sampled every ~5 units.
      const h = ((rx - ry) / (rx + ry)) ** 2;
      const perim = Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
      const n = Math.max(24, Math.ceil(perim / 5));
      const c = Math.cos(rotation), s = Math.sin(rotation);
      return [
        Array.from({ length: n + 1 }, (_, i) => {
          const t = ((i % n) / n) * Math.PI * 2;
          const x = Math.cos(t) * rx;
          const y = Math.sin(t) * ry;
          return { x: cx + x * c - y * s, y: cy + x * s + y * c, p: 0.5 };
        }),
      ];
    }
    default: {
      const v = shape.points;
      const out: InputPoint[] = [];
      for (let i = 0; i < v.length; i++) {
        const seg = linePoints(v[i], v[(i + 1) % v.length]);
        out.push(...(i ? seg.slice(1) : seg));
      }
      return [out];
    }
  }
}

/** The point a closed shape scales about. */
export function shapeCenter(shape: Shape): Vec {
  switch (shape.kind) {
    case 'line':
      return mid(shape.a, shape.b);
    case 'arrow':
      return mid(shape.tail, shape.tip);
    case 'ellipse':
      return { x: shape.cx, y: shape.cy };
    default: {
      const v = shape.points;
      return { x: v.reduce((s, p) => s + p.x, 0) / v.length, y: v.reduce((s, p) => s + p.y, 0) / v.length };
    }
  }
}

/** Uniformly scale a shape by k about `c`. */
export function transformShape(shape: Shape, c: Vec, k: number): Shape {
  const f = (p: Vec): Vec => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k });
  switch (shape.kind) {
    case 'line':
      return { ...shape, a: f(shape.a), b: f(shape.b) };
    case 'arrow':
      return { ...shape, tail: f(shape.tail), tip: f(shape.tip) };
    case 'ellipse': {
      const q = f({ x: shape.cx, y: shape.cy });
      return { ...shape, cx: q.x, cy: q.y, rx: shape.rx * k, ry: shape.ry * k };
    }
    default:
      return { ...shape, points: shape.points.map(f) };
  }
}

// --- helpers -------------------------------------------------------------------

const xy = (p: Vec): Vec => ({ x: p.x, y: p.y });
const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function diag(pts: Vec[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/** n points evenly spaced by arc length, so drawing speed doesn't bias the fits. */
function resample(pts: Vec[], n: number): Vec[] {
  const total = pointsLength(pts as InputPoint[]);
  if (total === 0) return [xy(pts[0])];
  const step = total / (n - 1);
  const out: Vec[] = [xy(pts[0])];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = dist(a, b);
    while (carry + seg >= step && out.length < n) {
      const t = (step - carry) / seg;
      a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(a);
      seg = dist(a, b);
      carry = 0;
    }
    carry += seg;
  }
  while (out.length < n) out.push(xy(pts[pts.length - 1]));
  return out;
}

/** Light moving-average smoothing that keeps the endpoints fixed. */
function smooth(pts: Vec[]): Vec[] {
  return pts.map((p, i) => {
    if (i < 2 || i > pts.length - 3) return p;
    let x = 0, y = 0;
    for (let k = -2; k <= 2; k++) {
      x += pts[i + k].x;
      y += pts[i + k].y;
    }
    return { x: x / 5, y: y / 5 };
  });
}

/**
 * If the stroke ends near where it started, return the single loop it traces.
 * Overdraw (the pen running past the start) is trimmed off.
 */
function closedLoop(pts: Vec[], size: number): Vec[] | null {
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (dist(first, last) <= 0.25 * size) return pts;
  // Overdraw is short; a long tail after closing is handwriting (an "e"), not a shape.
  const tail = Math.floor(pts.length * 0.8);
  const head = Math.ceil(pts.length * 0.2);
  let bestEnd = -1, bestEndD = Infinity;
  for (let j = tail; j < pts.length; j++) {
    const d = dist(first, pts[j]);
    if (d < bestEndD) [bestEnd, bestEndD] = [j, d];
  }
  if (bestEndD <= 0.12 * size) return pts.slice(0, bestEnd + 1);
  let bestStart = -1, bestStartD = Infinity;
  for (let i = 0; i < head; i++) {
    const d = dist(last, pts[i]);
    if (d < bestStartD) [bestStart, bestStartD] = [i, d];
  }
  if (bestStartD <= 0.12 * size) return pts.slice(bestStart);
  return null;
}

function meanError(pts: Vec[], f: (p: Vec) => number): number {
  return pts.reduce((s, p) => s + f(p), 0) / pts.length;
}

// --- ellipses ---

type Ellipse = Extract<Shape, { kind: 'ellipse' }>;

/** Principal axes from the second moments; radii from the extents along those axes. */
function fitEllipse(pts: Vec[]): Ellipse | null {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const rotation = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(rotation), s = Math.sin(rotation);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of pts) {
    const u = (p.x - mx) * c + (p.y - my) * s;
    const v = -(p.x - mx) * s + (p.y - my) * c;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const rx = (maxU - minU) / 2;
  const ry = (maxV - minV) / 2;
  if (rx < 1 || ry < 1) return null;
  const cu = (maxU + minU) / 2;
  const cv = (maxV + minV) / 2;
  return { kind: 'ellipse', cx: mx + cu * c - cv * s, cy: my + cu * s + cv * c, rx, ry, rotation };
}

/** Radial distance from p to the ellipse boundary (a good approximation for fit scoring). */
function ellipseDist(e: Ellipse, p: Vec): number {
  const c = Math.cos(e.rotation), s = Math.sin(e.rotation);
  const dx = p.x - e.cx, dy = p.y - e.cy;
  const u = dx * c + dy * s;
  const v = -dx * s + dy * c;
  const r = Math.hypot(u / e.rx, v / e.ry);
  const rho = Math.hypot(u, v);
  return r === 0 ? Math.min(e.rx, e.ry) : Math.abs(rho - rho / r);
}

/** Near-circles become circles; near-axis-aligned ellipses become axis-aligned. */
function snapEllipse(e: Ellipse): Ellipse {
  if (Math.min(e.rx, e.ry) / Math.max(e.rx, e.ry) >= 0.88) {
    const r = (e.rx + e.ry) / 2;
    return { ...e, rx: r, ry: r, rotation: 0 };
  }
  let { rx, ry, rotation } = e;
  if (Math.abs(rotation) > Math.PI / 4) {
    [rx, ry] = [ry, rx];
    rotation -= Math.sign(rotation) * (Math.PI / 2);
  }
  if (Math.abs(rotation) < SNAP_ANGLE) rotation = 0;
  return { ...e, rx, ry, rotation };
}

// --- polygons and arrows ---

/** Ramer–Douglas–Peucker; returns indices of the kept vertices (always includes both ends). */
function rdp(pts: Vec[], eps: number, lo = 0, hi = pts.length - 1, out: number[] = [lo]): number[] {
  let maxD = 0, idx = -1;
  for (let i = lo + 1; i < hi; i++) {
    const d = Math.sqrt(distToSegmentSq(pts[i].x, pts[i].y, pts[lo].x, pts[lo].y, pts[hi].x, pts[hi].y));
    if (d > maxD) [maxD, idx] = [d, i];
  }
  if (maxD > eps) {
    rdp(pts, eps, lo, idx, out);
    rdp(pts, eps, idx, hi, out);
  } else {
    out.push(hi);
  }
  return out;
}

/** Interior angle at b, in radians (π = straight). */
function angleAt(a: Vec, b: Vec, c: Vec): number {
  const v1 = Math.atan2(a.y - b.y, a.x - b.x);
  const v2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(v1 - v2);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/** Simplify a closed loop to its corners, or null if it doesn't look like a 3–8-gon. */
function fitPolygon(ring: Vec[], size: number): Vec[] | null {
  // Start at the point farthest from the centroid: on a polygon that's always a corner.
  const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
  let start = 0;
  ring.forEach((p, i) => {
    if (Math.hypot(p.x - cx, p.y - cy) > Math.hypot(ring[start].x - cx, ring[start].y - cy)) start = i;
  });
  const rotated = [...ring.slice(start), ...ring.slice(0, start), ring[start]];
  const v = rdp(rotated, Math.max(TREMOR, 0.045 * size)).slice(0, -1).map((i) => rotated[i]);

  // Drop near-straight vertices and merge vertices that sit on top of each other.
  for (let changed = true; changed && v.length >= 3; ) {
    changed = false;
    for (let i = 0; i < v.length && v.length >= 3; i++) {
      const prev = v[(i - 1 + v.length) % v.length];
      const next = v[(i + 1) % v.length];
      if (angleAt(prev, v[i], next) > (150 * Math.PI) / 180 || dist(v[i], next) < 0.08 * size) {
        v.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return v.length >= 3 && v.length <= 8 ? v : null;
}

function polygonDist(poly: Vec[], p: Vec): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    best = Math.min(best, distToSegmentSq(p.x, p.y, a.x, a.y, b.x, b.y));
  }
  return Math.sqrt(best);
}

/** Triangles stay as drawn; four roughly right angles become a true rectangle. */
function regularizePolygon(v: Vec[]): Shape {
  if (v.length === 3) return { kind: 'triangle', points: v };
  if (v.length !== 4) return { kind: 'polygon', points: v };
  const right = v.every((p, i) => Math.abs(angleAt(v[(i + 3) % 4], p, v[(i + 1) % 4]) - Math.PI / 2) < (20 * Math.PI) / 180);
  if (!right) return { kind: 'polygon', points: v };

  // Dominant edge direction modulo 90°, averaged on the 4θ circle and weighted by edge length.
  let sx = 0, sy = 0;
  for (let i = 0; i < 4; i++) {
    const a = v[i], b = v[(i + 1) % 4];
    const th = Math.atan2(b.y - a.y, b.x - a.x);
    const len = dist(a, b);
    sx += Math.cos(4 * th) * len;
    sy += Math.sin(4 * th) * len;
  }
  let th = Math.atan2(sy, sx) / 4;
  if (Math.abs(th) < SNAP_ANGLE) th = 0;
  const c = Math.cos(th), s = Math.sin(th);

  // In the rectangle's frame, each side is the mean of the two corners nearest it.
  const us = v.map((p) => p.x * c + p.y * s).sort((a, b) => a - b);
  const vs = v.map((p) => -p.x * s + p.y * c).sort((a, b) => a - b);
  const u0 = (us[0] + us[1]) / 2, u1 = (us[2] + us[3]) / 2;
  const v0 = (vs[0] + vs[1]) / 2, v1 = (vs[2] + vs[3]) / 2;
  const back = (u: number, w: number): Vec => ({ x: u * c - w * s, y: u * s + w * c });
  return { kind: 'rectangle', points: [back(u0, v0), back(u1, v0), back(u1, v1), back(u0, v1)] };
}

/**
 * An arrow is a straight shaft followed by a small head clustered around its end
 * that has barbs on both sides of the shaft and none in front of the tip.
 */
function detectArrow(pts: Vec[], size: number): Shape | null {
  const idx = rdp(pts, Math.max(TREMOR, 0.04 * size));
  if (idx.length < 4) return null;
  const tail = pts[0];
  for (let k = 1; k <= idx.length - 3; k++) {
    const tip = pts[idx[k]];
    const len = dist(tail, tip);
    if (len < 40) continue;
    let maxDev = 0;
    for (let i = 0; i <= idx[k]; i++) maxDev = Math.max(maxDev, Math.sqrt(distToSegmentSq(pts[i].x, pts[i].y, tail.x, tail.y, tip.x, tip.y)));
    // Same straightness as hold-to-straighten. Once the shaft has bent, later tips only make it worse.
    if (maxDev > Math.max(1.6 * TREMOR, 0.08 * len)) return null;

    const ux = (tail.x - tip.x) / len, uy = (tail.y - tip.y) / len;
    let left = false, right = false, ok = true, reach = 0;
    for (let i = idx[k] + 1; i < pts.length; i++) {
      const dx = pts[i].x - tip.x, dy = pts[i].y - tip.y;
      const d = Math.hypot(dx, dy);
      const along = dx * ux + dy * uy; // > 0 means behind the tip, toward the tail
      const across = dx * uy - dy * ux;
      if (d > 0.45 * len || along < -0.12 * len) {
        ok = false;
        break;
      }
      reach = Math.max(reach, d);
      if (across > 0.04 * len) left = true;
      if (across < -0.04 * len) right = true;
    }
    if (ok && left && right && reach > 0.06 * len) return { kind: 'arrow', tail, tip };
  }
  return null;
}
