// 2D affine transforms for resizing and rotating lasso selections.
import type { InputPoint, ItemPatch, Page, PageItem, Stroke } from './model';
import type { Bounds, Vec } from './geometry';
import { canRotate, itemBounds, normalizeRotation, STICKY_ICON } from './items';
import { updateItemOp, type DocOp } from './ops';
import { lineEnds, lineGeometry } from './shapeItems';
import { detachFromUnmoved } from './connectors';
import { selectedItems, selectedStrokes, type Selection } from './selection';

/** [a, b, c, d, e, f], as in canvas `setTransform`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function applyMatrix(m: Matrix, p: Vec): Vec {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** m ∘ n: apply n, then m. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) throw new Error('Matrix is not invertible');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function isIdentity(m: Matrix, eps = 1e-9): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) <= eps);
}

export const translate = (dx: number, dy: number): Matrix => [1, 0, 0, 1, dx, dy];

export function scaleAbout(k: number, o: Vec): Matrix {
  return [k, 0, 0, k, o.x * (1 - k), o.y * (1 - k)];
}

export function rotateAbout(theta: number, o: Vec): Matrix {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, s, -s, c, o.x - c * o.x + s * o.y, o.y - s * o.x - c * o.y];
}

/** Uniform scale factor (the square root of the area change). */
export const matrixScale = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
export const rotationAngle = (m: Matrix): number => Math.atan2(m[1], m[0]);

const SNAP = (5 * Math.PI) / 180;
/** Snap an angle to the nearest multiple of 90° when within 5° of it. */
export function snapAngle(theta: number): number {
  const q = Math.round(theta / (Math.PI / 2)) * (Math.PI / 2);
  return Math.abs(theta - q) < SNAP ? q + 0 : theta; // + 0 turns -0 into 0
}

/** The axis-aligned box around the transformed corners of `b`. */
export function transformBounds(b: Bounds, m: Matrix): Bounds {
  const pts = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map((p) => applyMatrix(m, p));
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/** Map every point; the nib width scales with the transform so the ink keeps its look. */
export function transformStroke(s: Stroke, m: Matrix): Stroke {
  return {
    ...s,
    width: s.width * matrixScale(m),
    points: s.points.map((p): InputPoint => ({ ...p, ...applyMatrix(m, p) })),
  };
}

/**
 * Items move with their centre and scale uniformly (text boxes scale their font too). Rotating a
 * selection turns photos, text boxes and open sticky notes with it; links, tape and collapsed notes
 * are carried around without turning. A collapsed sticky note keeps its size; its icon is fixed.
 */
export function transformItem<T extends PageItem>(it: T, m: Matrix): T {
  return { ...it, ...itemPatch(it, m) };
}

function itemPatch(it: PageItem, m: Matrix): ItemPatch {
  // A line's ends go where the transform takes them, which also turns it.
  if (it.kind === 'line') {
    const [a, b] = lineEnds(it).map((p) => applyMatrix(m, p));
    return { ...lineGeometry(a, b), width: it.width * matrixScale(m) };
  }
  const b = itemBounds(it);
  const c = applyMatrix(m, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
  if (it.kind === 'sticky' && it.collapsed) return { x: c.x - STICKY_ICON / 2, y: c.y - STICKY_ICON / 2 };
  const k = matrixScale(m);
  const w = it.w * k;
  const h = it.h * k;
  const patch: ItemPatch = { x: c.x - w / 2, y: c.y - h / 2, w, h };
  if (it.kind === 'text') patch.size = it.size * k;
  if (it.kind === 'shape') {
    patch.width = it.width * k;
    if (it.radius !== undefined) patch.radius = it.radius * k;
  }
  const turn = rotationAngle(m);
  if (canRotate(it) && Math.abs(turn) > 1e-9) patch.rotation = normalizeRotation((it.rotation ?? 0) + turn);
  return patch;
}

/** Ops that apply `m` to the selection: one for its strokes, one per item. */
export function transformSelectionOps(page: Page, sel: Selection, m: Matrix): DocOp[] {
  if (isIdentity(m)) return [];
  const ops: DocOp[] = [];
  const ids = selectedStrokes(page, sel).map((s) => s.id);
  if (ids.length) ops.push({ type: 'strokes.transformed', pageId: page.id, ids, matrix: m });
  const moving = new Set(sel.itemIds);
  for (const it of selectedItems(page, sel)) {
    const op = updateItemOp(page, it.id, { ...itemPatch(it, m), ...detachFromUnmoved(it, moving) });
    if (op) ops.push(op);
  }
  return ops;
}
