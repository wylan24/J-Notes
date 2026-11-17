import { describe, expect, it } from 'vitest';
import type { ImageItem, NotebookDoc, Page, StickyItem, Stroke, TextItem } from '../src/core/model';
import { normalizeDoc } from '../src/core/model';
import { applyOp, inverseOp, removeItemsOp, replay, updateItemOp, type DocEvent, type DocOp } from '../src/core/ops';
import { DocumentStore } from '../src/core/store';
import { splitStroke } from '../src/core/erase';
import { deleteSelectionOps, duplicateSelection, moveSelectionOps, selectInLasso, selectionBounds } from '../src/core/selection';

const text = (id: string, x = 0, y = 0): TextItem => ({ id, kind: 'text', x, y, w: 100, h: 40, text: 'hi', font: 'sans-serif', size: 16, color: '#000' });
const image = (id: string, x = 0, y = 0): ImageItem => ({ id, kind: 'image', x, y, w: 50, h: 50, blobId: `blob-${id}` });
const sticky = (id: string, x = 0, y = 0): StickyItem => ({ id, kind: 'sticky', x, y, w: 80, h: 80, text: '', color: '#ffe680', collapsed: false });
const stroke = (id: string, pts: [number, number][]): Stroke => ({
  id,
  tool: 'pen',
  color: '#000',
  width: 2,
  simulatePressure: false,
  points: pts.map(([x, y], i) => ({ x, y, p: 0.5, t: i * 10 })),
});

const doc = (): NotebookDoc => ({
  id: 'd',
  pages: [{ id: 'p', template: 'blank', strokes: [stroke('s', [[10, 10], [20, 20]])], items: [text('a'), image('b', 200, 200), sticky('c', 400, 400)] }],
});
const page = (d: NotebookDoc): Page => d.pages[0];

describe('item ops', () => {
  it('every item op is undone exactly by its inverse', () => {
    const d = doc();
    const ops: DocOp[] = [
      { type: 'items.added', pageId: 'p', items: [text('z', 5, 5)] },
      removeItemsOp(page(d), ['a', 'c'])!,
      updateItemOp(page(d), 'a', { x: 30, y: 40, text: 'changed' })!,
    ];
    for (const op of ops) {
      const after = applyOp(d, op);
      expect(after).not.toEqual(d);
      expect(applyOp(after, inverseOp(op))).toEqual(d);
    }
  });

  it('restores removed items at their original z-order', () => {
    const d = doc();
    const op = removeItemsOp(page(d), ['a', 'c'])!;
    const restored = applyOp(applyOp(d, op), inverseOp(op));
    expect(page(restored).items.map((it) => it.id)).toEqual(['a', 'b', 'c']);
  });

  it('records previous values, and undoing removes fields that were absent', () => {
    const d = doc();
    const op = updateItemOp(page(d), 'c', { collapsed: true, text: 'note' })!;
    expect(op).toMatchObject({ patch: { collapsed: true, text: 'note' }, previous: { collapsed: false, text: '' } });
    // A field the item doesn't have yet (an image has no `color`).
    const add = updateItemOp(page(d), 'b', { color: '#f00' })!;
    expect(add).toMatchObject({ previous: { color: undefined } });
    const undone = applyOp(applyOp(d, add), inverseOp(add));
    expect('color' in page(undone).items[1]).toBe(false);
  });

  it('returns null for missing items and leaves other pages alone', () => {
    expect(updateItemOp(page(doc()), 'nope', { x: 1 })).toBeNull();
    expect(removeItemsOp(page(doc()), ['nope'])).toBeNull();
    const d = doc();
    expect(applyOp(d, { type: 'items.added', pageId: 'missing', items: [text('q')] })).toBe(d);
  });

  it('a group of stroke and item ops undoes and redoes as one step', () => {
    const store = new DocumentStore(doc());
    const d = store.doc;
    store.dispatch([
      { type: 'strokes.translated', pageId: 'p', ids: ['s'], dx: 5, dy: 5 },
      updateItemOp(page(d), 'a', { x: 5, y: 5 })!,
      { type: 'items.added', pageId: 'p', items: [sticky('n')] },
    ]);
    const after = store.doc;
    store.undo();
    expect(store.doc).toEqual(doc());
    store.redo();
    expect(store.doc).toEqual(after);
  });
});

describe('old-format notebooks', () => {
  // Pages as saved before items existed.
  const legacyPage = (id: string) => ({ id, template: 'blank', strokes: [] }) as unknown as Page;

  it('normalises pages without items to an empty list', () => {
    const d = normalizeDoc({ id: 'd', pages: [legacyPage('p')] });
    expect(page(d).items).toEqual([]);
    const current = doc();
    expect(normalizeDoc(current)).toBe(current); // already current: unchanged identity
  });

  it('replays logged page.added events from before items existed', () => {
    const events: DocEvent[] = [
      { docId: 'd', seq: 1, ts: 0, op: { type: 'page.added', index: 0, page: legacyPage('old') } },
      { docId: 'd', seq: 2, ts: 0, op: { type: 'items.added', pageId: 'old', items: [text('t')] } },
    ];
    const d = replay({ id: 'd', pages: [] }, events);
    expect(page(d).items.map((it) => it.id)).toEqual(['t']);
  });

  it('item ops on a page that somehow lacks items still apply', () => {
    const d = applyOp({ id: 'd', pages: [legacyPage('p')] }, { type: 'items.added', pageId: 'p', items: [text('t')] });
    expect(page(d).items).toHaveLength(1);
  });
});

describe('point timestamps', () => {
  it('survive moving a stroke', () => {
    const d = applyOp(doc(), { type: 'strokes.translated', pageId: 'p', ids: ['s'], dx: 1, dy: 1 });
    expect(page(d).strokes[0].points.map((p) => p.t)).toEqual([0, 10]);
  });

  it('are interpolated at partial-erase cut points', () => {
    const s = stroke('s', [[0, 0], [100, 0]]);
    s.points[1].t = 100;
    const pieces = splitStroke(s, [{ x: 50, y: 0 }], 5)!;
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) for (const p of piece.points) expect(p.t).toBeCloseTo(p.x, 5);
  });
});

describe('lasso selection with items', () => {
  const box = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  it('selects strokes and items whose centre is inside', () => {
    const sel = selectInLasso(page(doc()), box(0, 0, 260, 260));
    expect(sel).toEqual({ pageId: 'p', strokeIds: ['s'], itemIds: ['a', 'b'] });
    expect(selectInLasso(page(doc()), box(600, 600, 700, 700))).toBeNull();
  });

  it('bounds cover both strokes and items', () => {
    const b = selectionBounds(page(doc()), { pageId: 'p', strokeIds: ['s'], itemIds: ['b'] })!;
    expect(b.minX).toBeLessThanOrEqual(10);
    expect(b.maxX).toBe(250);
  });

  it('moves, duplicates and deletes the whole selection in one undoable step', () => {
    const sel = { pageId: 'p', strokeIds: ['s'], itemIds: ['a', 'b'] };
    const store = new DocumentStore(doc());

    store.dispatch(moveSelectionOps(page(store.doc), sel, 10, -5));
    expect(page(store.doc).items[1]).toMatchObject({ x: 210, y: 195 });
    expect(page(store.doc).strokes[0].points[0]).toMatchObject({ x: 20, y: 5 });

    const dup = duplicateSelection(page(store.doc), sel, 24, 24);
    store.dispatch(dup.ops);
    expect(page(store.doc).items).toHaveLength(5);
    expect(dup.selection.itemIds).toHaveLength(2);
    expect(dup.selection.itemIds).not.toContain('a');

    store.dispatch(deleteSelectionOps(page(store.doc), dup.selection));
    expect(page(store.doc).items).toHaveLength(3);
    store.undo();
    store.undo();
    store.undo();
    expect(store.doc).toEqual(doc());
  });
});
