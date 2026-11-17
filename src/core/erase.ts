import type { InputPoint, Page, Stroke } from './model';
import { distToSegmentSq, strokeBounds, type Vec } from './geometry';
import { newId } from './ids';
import { removeStrokesOp, type DocOp } from './ops';

/** Insert points so no two neighbours are more than `step` apart (pressure is interpolated). */
export function resample(points: InputPoint[], step: number): InputPoint[] {
  return resampleTagged(points, step).map((s) => s.pt);
}

/** Like `resample`, but marks which samples are the stroke's own points. */
function resampleTagged(points: InputPoint[], step: number): { pt: InputPoint; orig: boolean }[] {
  if (points.length < 2) return points.map((pt) => ({ pt, orig: true }));
  const out = [{ pt: points[0], orig: true }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ pt: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t }, orig: false });
    }
    out.push({ pt: b, orig: true });
  }
  return out;
}

function nearPath(p: Vec, path: Vec[], reachSq: number): boolean {
  if (path.length === 1) return (p.x - path[0].x) ** 2 + (p.y - path[0].y) ** 2 <= reachSq;
  for (let i = 1; i < path.length; i++) {
    if (distToSegmentSq(p.x, p.y, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y) <= reachSq) return true;
  }
  return false;
}

/**
 * Cut the parts of `s` that an eraser of radius `r` dragged along `path` touches.
 * Returns null if the stroke is untouched, otherwise the surviving pieces
 * (possibly none). Each piece is a new stroke with the original's style.
 */
export function splitStroke(s: Stroke, path: Vec[], r: number): Stroke[] | null {
  if (!path.length) return null;
  const b = strokeBounds(s);
  const reach = r + s.width / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of path) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (maxX + reach < b.minX || minX - reach > b.maxX || maxY + reach < b.minY || minY - reach > b.maxY) return null;

  // Test densely so cuts are precise, but keep only the stroke's own points
  // plus the new cut ends: point spacing drives simulated pressure, so adding
  // points would change how mouse/finger strokes render.
  const reachSq = reach * reach;
  const samples = resampleTagged(s.points, Math.max(1, r / 3));
  const hit = samples.map((smp) => nearPath(smp.pt, path, reachSq));
  if (!hit.includes(true)) return null;
  const runs: InputPoint[][] = [];
  for (let i = 0; i < samples.length; ) {
    if (hit[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < samples.length && !hit[i]) i++;
    const end = i - 1;
    runs.push(samples.slice(start, i).filter((smp, k) => smp.orig || k === 0 || start + k === end).map((smp) => smp.pt));
  }
  return runs.filter((r) => r.length >= 2).map((points) => ({ ...s, id: newId(), points }));
}

/**
 * Ops that replace each original stroke with its surviving pieces, keeping
 * z-order: the pieces land where the original stroke was.
 */
export function replaceStrokesOps(page: Page, pieces: ReadonlyMap<string, Stroke[]>): DocOp[] {
  const removal = removeStrokesOp(page, pieces.keys());
  if (!removal) return [];
  const added: Stroke[] = [];
  const indices: number[] = [];
  let i = 0;
  for (const s of page.strokes) {
    const repl = pieces.get(s.id);
    for (const piece of repl ?? [s]) {
      if (repl) {
        added.push(piece);
        indices.push(i);
      }
      i++;
    }
  }
  return added.length ? [removal, { type: 'strokes.added', pageId: page.id, strokes: added, indices }] : [removal];
}
