import type { NotebookDoc, Page, Stroke } from './model';

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
  | { type: 'strokes.recolored'; pageId: string; ids: string[]; colors: string[]; previous: string[] };

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
  pages[i] = fn(pages[i]);
  return { ...doc, pages };
}

/** Pure reducer: returns a new doc, sharing untouched pages and strokes. */
export function applyOp(doc: NotebookDoc, op: DocOp): NotebookDoc {
  switch (op.type) {
    case 'page.added': {
      const pages = doc.pages.slice();
      pages.splice(Math.min(op.index, pages.length), 0, op.page);
      return { ...doc, pages };
    }
    case 'page.removed':
      return { ...doc, pages: doc.pages.filter((p) => p.id !== op.page.id) };
    case 'strokes.added':
      return updatePage(doc, op.pageId, (page) => {
        const strokes = page.strokes.slice();
        if (op.indices) {
          // Insert in ascending index order so each lands at its original slot.
          const pairs = op.strokes.map((s, i) => [op.indices![i], s] as const).sort((a, b) => a[0] - b[0]);
          for (const [idx, s] of pairs) strokes.splice(Math.min(idx, strokes.length), 0, s);
        } else {
          strokes.push(...op.strokes);
        }
        return { ...page, strokes };
      });
    case 'strokes.removed': {
      const ids = new Set(op.strokes.map((s) => s.id));
      return updatePage(doc, op.pageId, (page) => ({ ...page, strokes: page.strokes.filter((s) => !ids.has(s.id)) }));
    }
    case 'strokes.translated': {
      const ids = new Set(op.ids);
      return updatePage(doc, op.pageId, (page) => ({
        ...page,
        strokes: page.strokes.map((s) =>
          ids.has(s.id) ? { ...s, points: s.points.map((pt) => ({ x: pt.x + op.dx, y: pt.y + op.dy, p: pt.p })) } : s,
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

export function replay(doc: NotebookDoc, events: DocEvent[]): NotebookDoc {
  return events.reduce((d, e) => applyOp(d, e.op), doc);
}
