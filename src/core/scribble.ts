// Scribble to erase: scribbling back and forth over ink rubs it out, as you would on paper.
//
// A scribble is told apart from handwriting by its sweeps: it goes back and forth across its own
// width many times, and each sweep runs (nearly) end to end. Letters like m, w and z, zigzag
// lines, loops and spirals reverse direction too, but their reversals are short, travel steadily
// sideways, or shrink inwards. Only strokes the scribble covers are erased, so a scribble over
// empty paper is kept as ink.
import type { Vec } from './geometry';
import type { Stroke } from './model';

/** Full end-to-end sweeps needed along the scribble's length. */
const MIN_SWEEPS = 5;
/** Across its width (up-and-down over a word), more sweeps and tight packing are needed. */
const MIN_SWEEPS_ACROSS = 6;
/** A reversal only counts once the pen has come back this fraction of the extent. */
const HYSTERESIS = 0.15;
/** A sweep is full when both its ends are within this fraction of the opposite ends of the extent. */
const END_SLACK = 0.3;
/** Across-width sweeps must advance at most this fraction of their length each time. */
const MAX_ADVANCE = 0.22;
/** Smallest scribble, in page units: anything smaller is a dot or a tiny letter. */
const MIN_EXTENT = 10;
/** A zigzag's turns cancel out; loops and spirals keep turning one way. More full turns than this is not a scribble. */
const MAX_NET_TURNS = 2;

interface Axes {
  mean: Vec;
  major: Vec;
  minor: Vec;
}

/** The scribble's main direction and the one across it (principal axes of its points). */
function axes(pts: readonly Vec[]): Axes {
  const n = pts.length;
  const mean = { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  let xx = 0, xy = 0, yy = 0;
  for (const p of pts) {
    const dx = p.x - mean.x, dy = p.y - mean.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const major = { x: Math.cos(angle), y: Math.sin(angle) };
  return { mean, major, minor: { x: -major.y, y: major.x } };
}

interface Sweep {
  from: number;
  to: number;
  /** Where along the other axis the sweep ended (for measuring how far each sweep advances). */
  across: number;
}

/** Back-and-forth sweeps of the projected positions `a` (with `b` the other axis), ignoring jitter below `h`. */
function sweeps(a: readonly number[], b: readonly number[], h: number): Sweep[] {
  const out: Sweep[] = [];
  let start = a[0];
  let extreme = a[0];
  let extremeIdx = 0;
  let dir = 0;
  for (let i = 1; i < a.length; i++) {
    const v = a[i];
    if (dir === 0) {
      if (Math.abs(v - start) > h) {
        dir = Math.sign(v - start);
        extreme = v;
        extremeIdx = i;
      }
      continue;
    }
    if ((v - extreme) * dir > 0) {
      extreme = v;
      extremeIdx = i;
    } else if (Math.abs(v - extreme) > h) {
      out.push({ from: start, to: extreme, across: b[extremeIdx] });
      start = extreme;
      dir = -dir;
      extreme = v;
      extremeIdx = i;
    }
  }
  if (dir !== 0) out.push({ from: start, to: extreme, across: b[extremeIdx] });
  return out;
}

/** Count sweeps that run end to end along `a`. With `packed`, they must also advance little along `b`. */
function fullSweeps(a: readonly number[], b: readonly number[], packed: boolean): number {
  const lo = Math.min(...a), hi = Math.max(...a);
  const extent = hi - lo;
  if (extent < MIN_EXTENT) return 0;
  const slack = extent * END_SLACK;
  const near = (v: number, end: number) => Math.abs(v - end) <= slack;
  const list = sweeps(a, b, extent * HYSTERESIS);
  let count = 0;
  list.forEach((s, i) => {
    const endToEnd = (near(s.from, lo) && near(s.to, hi)) || (near(s.from, hi) && near(s.to, lo));
    if (!endToEnd) return;
    if (packed && i > 0 && Math.abs(s.across - list[i - 1].across) > MAX_ADVANCE * Math.abs(s.to - s.from)) return;
    count++;
  });
  // Mostly full sweeps: a spiral or a word with one long stroke has many partial ones.
  return count >= list.length * 0.7 ? count : 0;
}

/**
 * How many full turns the path makes overall, counting left turns against right ones. Measured on a
 * thinned-out path so jitter between neighbouring points doesn't add up.
 */
export function netTurns(points: readonly Vec[]): number {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const step = Math.max(2, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.03);
  const thin: Vec[] = [points[0]];
  for (const p of points) if (Math.hypot(p.x - thin[thin.length - 1].x, p.y - thin[thin.length - 1].y) >= step) thin.push(p);
  let total = 0;
  let prev: number | null = null;
  for (let i = 1; i < thin.length; i++) {
    const a = Math.atan2(thin[i].y - thin[i - 1].y, thin[i].x - thin[i - 1].x);
    if (prev !== null) {
      let d = a - prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      total += d;
    }
    prev = a;
  }
  return total / (2 * Math.PI);
}

/** Whether a stroke's points look like a scribble meant to erase. */
export function isScribble(points: readonly Vec[]): boolean {
  if (points.length < 12) return false;
  // Loops (l, e, cursive o) and spirals wind round; a scribble zigzags.
  if (Math.abs(netTurns(points)) > MAX_NET_TURNS) return false;
  const { mean, major, minor } = axes(points);
  const a = points.map((p) => (p.x - mean.x) * major.x + (p.y - mean.y) * major.y);
  const b = points.map((p) => (p.x - mean.x) * minor.x + (p.y - mean.y) * minor.y);
  return fullSweeps(a, b, false) >= MIN_SWEEPS || fullSweeps(b, a, true) >= MIN_SWEEPS_ACROSS;
}

/** Convex hull, counter-clockwise (monotone chain). */
export function convexHull(points: readonly Vec[]): Vec[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function inside(poly: readonly Vec[], p: Vec): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Share of a stroke's points that must lie under the scribble for it to be erased. */
const COVERED = 0.6;

/** Ids of the strokes a scribble covers: most of each one's points lie within the scribble's area. */
export function scribbledStrokes(scribble: readonly Vec[], strokes: readonly Stroke[]): string[] {
  const hull = convexHull(scribble);
  if (hull.length < 3) return [];
  return strokes
    .filter((s) => {
      if (!s.points.length) return false;
      const step = Math.max(1, Math.floor(s.points.length / 40));
      let n = 0, hit = 0;
      for (let i = 0; i < s.points.length; i += step) {
        n++;
        if (inside(hull, s.points[i])) hit++;
      }
      return hit / n >= COVERED;
    })
    .map((s) => s.id);
}

