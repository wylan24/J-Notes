// Locking content, and arranging it front to back.
import type { Page } from './model';
import { updateItemOp, type DocOp } from './ops';
import type { Selection } from './selection';

/** The page with its locked content left out: what the eraser, lasso and tools can act on. */
export function unlockedContent(page: Page): Page {
  if (!page.strokes.some((s) => s.locked) && !page.items.some((it) => it.locked)) return page;
  return { ...page, strokes: page.strokes.filter((s) => !s.locked), items: page.items.filter((it) => !it.locked) };
}

export function countLocked(page: Page): number {
  return page.strokes.filter((s) => s.locked).length + page.items.filter((it) => it.locked).length;
}

function lockOps(page: Page, strokeIds: ReadonlySet<string>, itemIds: ReadonlySet<string>, locked: boolean): DocOp[] {
  const ops: DocOp[] = [];
  const strokes = page.strokes.filter((s) => strokeIds.has(s.id) && !!s.locked !== locked).map((s) => s.id);
  if (strokes.length) ops.push({ type: 'strokes.locked', pageId: page.id, ids: strokes, locked });
  for (const it of page.items) {
    if (!itemIds.has(it.id) || !!it.locked === locked) continue;
    const op = updateItemOp(page, it.id, { locked: locked ? true : undefined });
    if (op) ops.push(op);
  }
  return ops;
}

/** Lock (or unlock) what is selected; together the ops are one undo step. */
export function lockSelectionOps(page: Page, sel: Selection, locked = true): DocOp[] {
  return lockOps(page, new Set(sel.strokeIds), new Set(sel.itemIds), locked);
}

/** Unlock everything locked on the page. */
export function unlockAllOps(page: Page): DocOp[] {
  return lockOps(page, new Set(page.strokes.map((s) => s.id)), new Set(page.items.map((it) => it.id)), false);
}

export type Arrange = 'front' | 'back';

/** Ids with the chosen ones moved to the top (end) or bottom (start), keeping their order among themselves. */
export function arrangedOrder(ids: readonly string[], chosen: ReadonlySet<string>, where: Arrange): string[] {
  const picked = ids.filter((id) => chosen.has(id));
  const rest = ids.filter((id) => !chosen.has(id));
  return where === 'front' ? [...rest, ...picked] : [...picked, ...rest];
}

/**
 * Bring the selection to the front or send it to the back. Ink and items stack separately (photos
 * and text sit under ink, sticky notes and tape over it), so each is arranged within its own stack.
 */
export function arrangeSelectionOps(page: Page, sel: Selection, where: Arrange): DocOp[] {
  const ops: DocOp[] = [];
  const strokes = page.strokes.map((s) => s.id);
  const strokeOrder = arrangedOrder(strokes, new Set(sel.strokeIds), where);
  if (strokeOrder.some((id, i) => id !== strokes[i])) ops.push({ type: 'strokes.reordered', pageId: page.id, order: strokeOrder, previous: strokes });
  const items = page.items.map((it) => it.id);
  const itemOrder = arrangedOrder(items, new Set(sel.itemIds), where);
  if (itemOrder.some((id, i) => id !== items[i])) ops.push({ type: 'items.reordered', pageId: page.id, order: itemOrder, previous: items });
  return ops;
}
