import { invert, transformStroke, type Matrix } from './transform';
import { normalizePage, type ItemPatch, type NotebookDoc, type Page, type PageItem, type Recording, type Stroke } from './model';

/**
 * Every change to a notebook is one of these operations. Ops carry enough data
 * to be inverted without looking at prior state, which gives us undo/redo for
 * free and lets the persisted log be replayed deterministically.
 */
export type DocOp =
  | { type: 'page.added'; page: Page; index: number }
  | { type: 'page.removed'; page: Page; index: number }
  | { type: 'strokes.added'; pageId: string; strokes: Stroke[]; indices?: number[] }
  | { type: 'strokes.removed'; pageId: string; strokes: Stroke[]; indices: number[] }
  | { type: 'strokes.translated'; pageId: string; ids: string[]; dx: number; dy: number }
  | { type: 'strokes.recolored'; pageId: string; ids: string[]; colors: string[]; previous: string[] }
  /** Affine transform (resize/rotate) of strokes, as [a, b, c, d, e, f]; undone by the inverse matrix. */
  | { type: 'strokes.transformed'; pageId: string; ids: string[]; matrix: Matrix }
  | { type: 'items.added'; pageId: string; items: PageItem[]; indices?: number[] }
  | { type: 'items.removed'; pageId: string; items: PageItem[]; indices: number[] }
  /** `previous` holds the old value of every patched field (undefined where the field was absent). */
  | { type: 'items.updated'; pageId: string; id: string; patch: ItemPatch; previous: ItemPatch }
  | { type: 'recording.added'; recording: Recording; index?: number }
  | { type: 'recording.removed'; recording: Recording; index: number };

/** A persisted log entry. `seq` is monotonically increasing per document. */
export interface DocEvent {
  docId: string;
  seq: number;
  ts: number;
  op: DocOp;
}

function updatePage(doc: NotebookDoc, pageId: string, fn: (p: Page) => Page): NotebookDoc {
  const i = doc.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return doc; // op targets a page that no longer exists; ignore
  const pages = doc.pages.slice();
  pages[i] = fn(normalizePage(pages[i]));
  return { ...doc, pages };
}

/** Insert values at their recorded indices (ascending, so each lands in its original slot), or append. */
function insertAt<T>(list: T[], values: T[], indices?: number[]): T[] {
  const out = list.slice();
  if (!indices) {
    out.push(...values);
    return out;
  }
  const pairs = values.map((v, i) => [indices[i], v] as const).sort((a, b) => a[0] - b[0]);
  for (const [idx, v] of pairs) out.splice(Math.min(idx, out.length), 0, v);
  return out;
}

/** Apply a patch; an undefined value removes the field, so undoing restores an absent field exactly. */
function patchItem(item: PageItem, patch: ItemPatch): PageItem {
  const next: Record<string, unknown> = { ...item };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return next as unknown as PageItem;
}

/** Pure reducer: returns a new doc, sharing untouched pages and strokes. */
export function applyOp(doc: NotebookDoc, op: DocOp): NotebookDoc {
  switch (op.type) {
    case 'page.added': {
      const pages = doc.pages.slice();
      // Pages added by events logged before items existed have no `items`.
      pages.splice(Math.min(op.index, pages.length), 0, normalizePage(op.page));
      return { ...doc, pages };
    }
    case 'page.removed':
      return { ...doc, pages: doc.pages.filter((p) => p.id !== op.page.id) };
    case 'strokes.added':
      return updatePage(doc, op.pageId, (page) => ({ ...page, strokes: insertAt(page.strokes, op.strokes, op.indices) }));
    case 'strokes.removed': {
      const ids = new Set(op.strokes.map((s) => s.id));
      return updatePage(doc, op.pageId, (page) => ({ ...page, strokes: page.strokes.filter((s) => !ids.has(s.id)) }));
    }
    case 'strokes.translated': {
      const ids = new Set(op.ids);
      return updatePage(doc, op.pageId, (page) => ({
        ...page,
        strokes: page.strokes.map((s) =>
          ids.has(s.id) ? { ...s, points: s.points.map((pt) => ({ ...pt, x: pt.x + op.dx, y: pt.y + op.dy })) } : s,
        ),
      }));
    }
    case 'strokes.recolored': {
      const colors = new Map(op.ids.map((id, i) => [id, op.colors[i]]));
      return updatePage(doc, op.pageId, (page) => ({
        ...page,
        strokes: page.strokes.map((s) => (colors.has(s.id) ? { ...s, color: colors.get(s.id)! } : s)),
      }));
    }
    case 'strokes.transformed': {
      const ids = new Set(op.ids);
      return updatePage(doc, op.pageId, (page) => ({ ...page, strokes: page.strokes.map((s) => (ids.has(s.id) ? transformStroke(s, op.matrix) : s)) }));
    }
    case 'items.added':
      return updatePage(doc, op.pageId, (page) => ({ ...page, items: insertAt(page.items, op.items, op.indices) }));
    case 'items.removed': {
      const ids = new Set(op.items.map((it) => it.id));
      return updatePage(doc, op.pageId, (page) => ({ ...page, items: page.items.filter((it) => !ids.has(it.id)) }));
    }
    case 'recording.added':
      return { ...doc, recordings: insertAt(doc.recordings ?? [], [op.recording], op.index === undefined ? undefined : [op.index]) };
    case 'recording.removed':
      return { ...doc, recordings: (doc.recordings ?? []).filter((r) => r.id !== op.recording.id) };
    case 'items.updated':
      return updatePage(doc, op.pageId, (page) => ({
        ...page,
        items: page.items.map((it) => (it.id === op.id ? patchItem(it, op.patch) : it)),
      }));
  }
}

export function inverseOp(op: DocOp): DocOp {
  switch (op.type) {
    case 'page.added':
      return { type: 'page.removed', page: op.page, index: op.index };
    case 'page.removed':
      return { type: 'page.added', page: op.page, index: op.index };
    case 'strokes.added':
      return { type: 'strokes.removed', pageId: op.pageId, strokes: op.strokes, indices: op.indices ?? [] };
    case 'strokes.removed':
      return { type: 'strokes.added', pageId: op.pageId, strokes: op.strokes, indices: op.indices.length ? op.indices : undefined };
    case 'strokes.translated':
      return { ...op, dx: -op.dx, dy: -op.dy };
    case 'strokes.recolored':
      return { ...op, colors: op.previous, previous: op.colors };
    case 'strokes.transformed':
      return { ...op, matrix: invert(op.matrix) };
    case 'items.added':
      return { type: 'items.removed', pageId: op.pageId, items: op.items, indices: op.indices ?? [] };
    case 'items.removed':
      return { type: 'items.added', pageId: op.pageId, items: op.items, indices: op.indices.length ? op.indices : undefined };
    case 'items.updated':
      return { ...op, patch: op.previous, previous: op.patch };
    case 'recording.added':
      return { type: 'recording.removed', recording: op.recording, index: op.index ?? -1 };
    case 'recording.removed':
      return { type: 'recording.added', recording: op.recording, index: op.index < 0 ? undefined : op.index };
  }
}

/** Build a removal op from current state, recording original z-order indices. */
export function removeStrokesOp(page: Page, ids: Iterable<string>): DocOp | null {
  const set = new Set(ids);
  const strokes: Stroke[] = [];
  const indices: number[] = [];
  page.strokes.forEach((s, i) => {
    if (set.has(s.id)) {
      strokes.push(s);
      indices.push(i);
    }
  });
  return strokes.length ? { type: 'strokes.removed', pageId: page.id, strokes, indices } : null;
}

/** Build an item removal op from current state, recording original z-order indices. */
export function removeItemsOp(page: Page, ids: Iterable<string>): DocOp | null {
  const set = new Set(ids);
  const items: PageItem[] = [];
  const indices: number[] = [];
  page.items.forEach((it, i) => {
    if (set.has(it.id)) {
      items.push(it);
      indices.push(i);
    }
  });
  return items.length ? { type: 'items.removed', pageId: page.id, items, indices } : null;
}

/** Build an update op, recording the current value of each patched field so it can be undone. */
export function updateItemOp(page: Page, id: string, patch: ItemPatch): DocOp | null {
  const item = page.items.find((it) => it.id === id);
  if (!item) return null;
  const current = item as unknown as Record<string, unknown>;
  const previous = Object.fromEntries(Object.keys(patch).map((k) => [k, current[k]])) as ItemPatch;
  return { type: 'items.updated', pageId: page.id, id, patch, previous };
}

export function replay(doc: NotebookDoc, events: DocEvent[]): NotebookDoc {
  return events.reduce((d, e) => applyOp(d, e.op), doc);
}
