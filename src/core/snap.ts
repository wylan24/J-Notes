// Snapping guides: while a selection is dragged, its edges and centre line up with the edges and
// centres of other objects on the page, the page itself, and the paper's lines and grid.
import type { Bounds } from './geometry';
import { strokeBounds } from './geometry';
import { itemBounds } from './items';
import { pageSize, type Page } from './model';
import type { Selection } from './selection';
import { templateLayout } from './templates';

/** Where a moving box can line up, per axis. `span` is the target's extent along the other axis (for drawing the guide). */
export interface SnapTarget {
  at: number;
  span: [number, number] | null;
}

export interface SnapTargets {
  x: SnapTarget[];
  y: SnapTarget[];
}

/** A guide line to draw: vertical (`axis` x) at x = `at`, or horizontal at y = `at`, from `from` to `to`. */
export interface SnapGuide {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

const edgesX = (b: Bounds) => [b.minX, (b.minX + b.maxX) / 2, b.maxX];
const edgesY = (b: Bounds) => [b.minY, (b.minY + b.maxY) / 2, b.maxY];

/**
 * What a selection on this page can snap to: other objects (items and recognised shapes, not
 * handwriting, which would make every word a magnet), the page's edges and centre, and the
 * paper's lines, grid and dots.
 */
export function snapTargets(page: Page, sel: Selection): SnapTargets {
  const out: SnapTargets = { x: [], y: [] };
  const strokes = new Set(sel.strokeIds);
  const items = new Set(sel.itemIds);
  const objects = [
    ...page.strokes.filter((s) => s.shape && !strokes.has(s.id)).map(strokeBounds),
    ...page.items.filter((it) => !items.has(it.id)).map(itemBounds),
  ];
  for (const b of objects) {
    for (const x of edgesX(b)) out.x.push({ at: x, span: [b.minY, b.maxY] });
    for (const y of edgesY(b)) out.y.push({ at: y, span: [b.minX, b.maxX] });
  }
  const size = pageSize(page);
  for (const x of [0, size.w / 2, size.w]) out.x.push({ at: x, span: null });
  for (const y of [0, size.h / 2, size.h]) out.y.push({ at: y, span: null });
  const layout = templateLayout(page.template, size);
  for (const l of layout.lines) {
    if (l.x1 === l.x2) out.x.push({ at: l.x1, span: [Math.min(l.y1, l.y2), Math.max(l.y1, l.y2)] });
    else if (l.y1 === l.y2) out.y.push({ at: l.y1, span: [Math.min(l.x1, l.x2), Math.max(l.x1, l.x2)] });
  }
  const dotXs = new Set(layout.dots.map((d) => d.x));
  const dotYs = new Set(layout.dots.map((d) => d.y));
  for (const x of dotXs) out.x.push({ at: x, span: null });
  for (const y of dotYs) out.y.push({ at: y, span: null });
  return out;
}

/** The best snap on one axis: the smallest correction within `threshold`, and the targets it lines up with. */
function snapAxis(edges: number[], targets: SnapTarget[], threshold: number): { delta: number; hits: { edge: number; t: SnapTarget }[] } {
  let best = Infinity;
  for (const e of edges) for (const t of targets) if (Math.abs(t.at - e) <= threshold && Math.abs(t.at - e) < Math.abs(best)) best = t.at - e;
  if (best === Infinity) return { delta: 0, hits: [] };
  const hits: { edge: number; t: SnapTarget }[] = [];
  for (const e of edges) for (const t of targets) if (Math.abs(t.at - (e + best)) < 0.01) hits.push({ edge: e + best, t });
  return { delta: best, hits };
}

/**
 * Snap a drag of `box` by (dx, dy): each axis independently moves by the smallest amount, within
 * `threshold` page units, that lines one of the box's edges or its centre up with a target.
 * Returns the snapped offset and guides spanning the box and what it lines up with.
 */
export function snapMove(box: Bounds, dx: number, dy: number, targets: SnapTargets, threshold: number, size: { w: number; h: number }): { dx: number; dy: number; guides: SnapGuide[] } {
  const moved: Bounds = { minX: box.minX + dx, maxX: box.maxX + dx, minY: box.minY + dy, maxY: box.maxY + dy };
  const sx = snapAxis(edgesX(moved), targets.x, threshold);
  const sy = snapAxis(edgesY(moved), targets.y, threshold);
  const final: Bounds = { minX: moved.minX + sx.delta, maxX: moved.maxX + sx.delta, minY: moved.minY + sy.delta, maxY: moved.maxY + sy.delta };
  const guides: SnapGuide[] = [];
  const seen = new Set<string>();
  const add = (g: SnapGuide) => {
    const key = `${g.axis}${g.at.toFixed(2)}`;
    if (seen.has(key)) {
      // Merge with the guide already at this line.
      const i = guides.findIndex((o) => `${o.axis}${o.at.toFixed(2)}` === key);
      guides[i] = { ...guides[i], from: Math.min(guides[i].from, g.from), to: Math.max(guides[i].to, g.to) };
      return;
    }
    seen.add(key);
    guides.push(g);
  };
  for (const { edge, t } of sx.hits) {
    const [a, b] = t.span ?? [0, size.h];
    add({ axis: 'x', at: edge, from: Math.min(a, final.minY), to: Math.max(b, final.maxY) });
  }
  for (const { edge, t } of sy.hits) {
    const [a, b] = t.span ?? [0, size.w];
    add({ axis: 'y', at: edge, from: Math.min(a, final.minX), to: Math.max(b, final.maxX) });
  }
  return { dx: dx + sx.delta, dy: dy + sy.delta, guides };
}
