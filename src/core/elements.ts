// Elements: a library of saved selections that can be placed on any page of any notebook.
import { DEFAULT_PAGE_SIZE, type Page, type PageSize, type PageItem, type Stroke } from './model';
import type { Vec } from './geometry';
import { newId } from './ids';
import type { DocOp } from './ops';
import { selectedItems, selectedStrokes, selectionBounds, type Selection } from './selection';
import { transformItem, transformStroke, type Matrix } from './transform';

/** An element's drawing: strokes and items with their bounding box's top-left at (0, 0). */
export interface ElementContent {
  strokes: Stroke[];
  items: PageItem[];
  w: number;
  h: number;
}

export interface SavedElement extends ElementContent {
  id: string;
  name: string;
  createdAt: number;
  /** PNG data URL for the library grid. */
  thumbnail: string;
  /** Photo bytes the items refer to; blobs live per notebook, so an element carries its own copies. */
  blobs: { id: string; type: string; bytes: ArrayBuffer }[];
}

/** The selection, moved so its bounds start at the origin. Audio timestamps are dropped: they mean nothing elsewhere. */
export function makeElementContent(page: Page, sel: Selection): ElementContent | null {
  const b = selectionBounds(page, sel);
  if (!b) return null;
  const m: Matrix = [1, 0, 0, 1, -b.minX, -b.minY];
  const strokes = selectedStrokes(page, sel).map((s) => {
    const { rec: _rec, ...moved } = transformStroke(s, m);
    return { ...moved, points: moved.points.map(({ x, y, p }) => ({ x, y, p })) };
  });
  return { strokes, items: selectedItems(page, sel).map((it) => transformItem(it, m)), w: b.maxX - b.minX, h: b.maxY - b.minY };
}

export function elementBlobIds(c: ElementContent): string[] {
  return [...new Set(c.items.flatMap((it) => (it.kind === 'image' ? [it.blobId] : [])))];
}

/** The element's first text, shortened at a word, or "Element n". */
export function defaultElementName(c: ElementContent, existing: number): string {
  const text = c.items
    .map((it) => (it.kind === 'text' || it.kind === 'sticky' ? it.text.trim().replace(/\s+/g, ' ') : ''))
    .find(Boolean);
  if (!text) return `Element ${existing + 1}`;
  if (text.length <= 20) return text;
  const cut = text.slice(0, 20);
  const space = cut.lastIndexOf(' ');
  return `${space > 8 ? cut.slice(0, space) : cut}…`;
}

/**
 * Ops that add a copy of the element centred on `center` (kept on the page, scaled down if it
 * doesn't fit), with fresh ids, and a selection of the copy.
 */
export function placeElement(
  c: ElementContent,
  pageId: string,
  center: Vec,
  size: PageSize = DEFAULT_PAGE_SIZE,
): { ops: DocOp[]; selection: Selection } {
  const k = Math.min(1, (size.w * 0.9) / Math.max(1, c.w), (size.h * 0.9) / Math.max(1, c.h));
  const w = c.w * k, h = c.h * k;
  const x = Math.min(Math.max(0, center.x - w / 2), size.w - w);
  const y = Math.min(Math.max(0, center.y - h / 2), size.h - h);
  const m: Matrix = [k, 0, 0, k, x, y];
  const strokes = c.strokes.map((s) => ({ ...transformStroke(s, m), id: newId() }));
  const items = c.items.map((it) => ({ ...transformItem(it, m), id: newId() }));
  const ops: DocOp[] = [];
  if (strokes.length) ops.push({ type: 'strokes.added', pageId, strokes });
  if (items.length) ops.push({ type: 'items.added', pageId, items });
  return { ops, selection: { pageId, strokeIds: strokes.map((s) => s.id), itemIds: items.map((it) => it.id) } };
}
