import type { Page, PageItem, Stroke } from './model';
import { pointInPolygon, strokeBounds, strokesInLasso, type Bounds, type Vec } from './geometry';
import { newId } from './ids';
import { itemBounds } from './items';
import { removeItemsOp, removeStrokesOp, updateItemOp, type DocOp } from './ops';

/** A lasso selection on one page: strokes and page items. */
export interface Selection {
  pageId: string;
  strokeIds: string[];
  itemIds: string[];
}

/** Items whose centre is inside the lasso are selected. */
export function itemsInLasso(items: PageItem[], poly: Vec[]): string[] {
  if (poly.length < 3) return [];
  return items
    .filter((it) => {
      const b = itemBounds(it);
      return pointInPolygon((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, poly);
    })
    .map((it) => it.id);
}

/** Select what the lasso encloses, or null if it encloses nothing. */
export function selectInLasso(page: Page, poly: Vec[]): Selection | null {
  const strokeIds = strokesInLasso(page.strokes, poly);
  const itemIds = itemsInLasso(page.items, poly);
  return strokeIds.length || itemIds.length ? { pageId: page.id, strokeIds, itemIds } : null;
}

export function selectedStrokes(page: Page, sel: Selection): Stroke[] {
  const ids = new Set(sel.strokeIds);
  return page.strokes.filter((s) => ids.has(s.id));
}

export function selectedItems(page: Page, sel: Selection): PageItem[] {
  const ids = new Set(sel.itemIds);
  return page.items.filter((it) => ids.has(it.id));
}

export function selectionBounds(page: Page, sel: Selection): Bounds | null {
  const all = [...selectedStrokes(page, sel).map(strokeBounds), ...selectedItems(page, sel).map(itemBounds)];
  if (!all.length) return null;
  return all.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

export function deleteSelectionOps(page: Page, sel: Selection): DocOp[] {
  return [removeStrokesOp(page, sel.strokeIds), removeItemsOp(page, sel.itemIds)].filter((op): op is DocOp => !!op);
}

export function moveSelectionOps(page: Page, sel: Selection, dx: number, dy: number): DocOp[] {
  const ops: DocOp[] = [];
  const strokeIds = selectedStrokes(page, sel).map((s) => s.id);
  if (strokeIds.length) ops.push({ type: 'strokes.translated', pageId: page.id, ids: strokeIds, dx, dy });
  for (const it of selectedItems(page, sel)) {
    const op = updateItemOp(page, it.id, { x: it.x + dx, y: it.y + dy });
    if (op) ops.push(op);
  }
  return ops;
}

/** Copies of the selection, offset by (dx, dy), and a selection of the copies. */
export function duplicateSelection(page: Page, sel: Selection, dx: number, dy: number): { ops: DocOp[]; selection: Selection } {
  const strokes = selectedStrokes(page, sel).map((s) => ({ ...s, id: newId(), points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }));
  const items = selectedItems(page, sel).map((it) => ({ ...it, id: newId(), x: it.x + dx, y: it.y + dy }));
  const ops: DocOp[] = [];
  if (strokes.length) ops.push({ type: 'strokes.added', pageId: page.id, strokes });
  if (items.length) ops.push({ type: 'items.added', pageId: page.id, items });
  return { ops, selection: { pageId: page.id, strokeIds: strokes.map((s) => s.id), itemIds: items.map((it) => it.id) } };
}
