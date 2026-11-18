// Tape: strips laid over notes to hide them, for testing yourself. Tap a strip to see what is under
// it, tap again to cover it. Whether a strip is showing is a viewing state, not part of the notebook.
import type { Vec } from './geometry';
import { newId } from './ids';
import type { NotebookDoc, Page, TapeItem } from './model';
import type { DocOp } from './ops';

export const TAPE_COLORS = ['#f4c95d', '#8ec5ea', '#a6d79b', '#f3a6bf', '#b9b4ad'];
/** A swipe makes a strip at least this thick, in page units. */
export const TAPE_THICKNESS = 26;
/** Shorter drags than this are taps, not tape. */
export const TAPE_MIN_LENGTH = 12;

/**
 * The strip a drag from `a` to `b` lays down: the box they span, at least TAPE_THICKNESS across
 * (so a quick swipe along a line of text covers it). Null for a drag too short to be tape.
 */
export function tapeRect(a: Vec, b: Vec): { x: number; y: number; w: number; h: number } | null {
  if (Math.hypot(b.x - a.x, b.y - a.y) < TAPE_MIN_LENGTH) return null;
  let x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  let w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  if (h < TAPE_THICKNESS) {
    y -= (TAPE_THICKNESS - h) / 2;
    h = TAPE_THICKNESS;
  }
  if (w < TAPE_THICKNESS) {
    x -= (TAPE_THICKNESS - w) / 2;
    w = TAPE_THICKNESS;
  }
  return { x, y, w, h };
}

export function newTape(rect: { x: number; y: number; w: number; h: number }, color: string): TapeItem {
  return { id: newId(), kind: 'tape', ...rect, color };
}

/** The top-most strip under a point. */
export function tapeAt(page: Page, pt: Vec): TapeItem | null {
  for (let i = page.items.length - 1; i >= 0; i--) {
    const it = page.items[i];
    if (it.kind === 'tape' && pt.x >= it.x && pt.x <= it.x + it.w && pt.y >= it.y && pt.y <= it.y + it.h) return it;
  }
  return null;
}

export function countTape(doc: NotebookDoc): number {
  return doc.pages.reduce((n, p) => n + p.items.filter((it) => it.kind === 'tape').length, 0);
}

/** Ops removing every strip in the notebook; dispatched together they are one undo step. */
export function removeAllTapeOps(doc: NotebookDoc): DocOp[] {
  const ops: DocOp[] = [];
  for (const page of doc.pages) {
    const items: TapeItem[] = [];
    const indices: number[] = [];
    page.items.forEach((it, i) => {
      if (it.kind === 'tape') {
        items.push(it);
        indices.push(i);
      }
    });
    if (items.length) ops.push({ type: 'items.removed', pageId: page.id, items, indices });
  }
  return ops;
}

/** Show or cover one strip. */
export function toggleRevealed(revealed: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(revealed);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
