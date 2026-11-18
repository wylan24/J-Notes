import { describe, expect, it } from 'vitest';
import { arrangeSelectionOps, arrangedOrder, countLocked, lockSelectionOps, unlockAllOps, unlockedContent } from '../src/core/arrange';
import { countContent, deleteContentOps } from '../src/core/contentKinds';
import { selectWithLasso, rectPolygon, LASSO_KINDS } from '../src/core/lasso';
import type { NotebookDoc, Page, PageItem, Stroke } from '../src/core/model';
import { applyOp, inverseOp, type DocOp } from '../src/core/ops';
import { DocumentStore } from '../src/core/store';

const stroke = (id: string): Stroke => ({ id, tool: 'pen', color: '#000', width: 2, simulatePressure: false, points: [{ x: 10, y: 10, p: 0.5 }, { x: 20, y: 10, p: 0.5 }] });
const text = (id: string): PageItem => ({ id, kind: 'text', x: 0, y: 0, w: 30, h: 20, text: id, font: 'sans', size: 12, color: '#000' });
const page: Page = { id: 'p', template: 'blank', strokes: [stroke('a'), stroke('b'), stroke('c')], items: [text('x'), text('y'), text('z')] };
const doc: NotebookDoc = { id: 'd', pages: [page] };
const run = (ops: DocOp[], d: NotebookDoc = doc) => ops.reduce(applyOp, d);
const undo = (ops: DocOp[], d: NotebookDoc) => [...ops].reverse().map(inverseOp).reduce(applyOp, d);
const ids = (d: NotebookDoc) => ({ strokes: d.pages[0].strokes.map((s) => s.id), items: d.pages[0].items.map((it) => it.id) });

describe('arrange', () => {
  it('moves the chosen ids to the top or bottom, keeping their own order', () => {
    expect(arrangedOrder(['a', 'b', 'c', 'd'], new Set(['c', 'a']), 'front')).toEqual(['b', 'd', 'a', 'c']);
    expect(arrangedOrder(['a', 'b', 'c', 'd'], new Set(['d', 'b']), 'back')).toEqual(['b', 'd', 'a', 'c']);
  });

  it('brings ink and items to the front within their own stacks, and undoes exactly', () => {
    const ops = arrangeSelectionOps(page, { pageId: 'p', strokeIds: ['a'], itemIds: ['x'] }, 'front');
    const after = run(ops);
    expect(ids(after)).toEqual({ strokes: ['b', 'c', 'a'], items: ['y', 'z', 'x'] });
    expect(ids(undo(ops, after))).toEqual(ids(doc));
  });

  it('does nothing when the selection is already there', () => {
    expect(arrangeSelectionOps(page, { pageId: 'p', strokeIds: ['c'], itemIds: ['z'] }, 'front')).toEqual([]);
    expect(arrangeSelectionOps(page, { pageId: 'p', strokeIds: ['a'], itemIds: [] }, 'back')).toEqual([]);
  });

  it('a replayed reorder keeps content added since', () => {
    const ops = arrangeSelectionOps(page, { pageId: 'p', strokeIds: [], itemIds: ['x'] }, 'back');
    const withNew = applyOp(doc, { type: 'items.added', pageId: 'p', items: [text('new')] });
    expect(ids(run(ops, withNew)).items).toEqual(['x', 'y', 'z', 'new']);
  });
});

describe('lock', () => {
  const sel = { pageId: 'p', strokeIds: ['a'], itemIds: ['x'] };
  const locked = run(lockSelectionOps(page, sel));

  it('locks strokes and items as one undoable step', () => {
    expect(countLocked(locked.pages[0])).toBe(2);
    const store = new DocumentStore(doc);
    store.dispatch(lockSelectionOps(page, sel));
    store.undo();
    expect(countLocked(store.doc.pages[0])).toBe(0);
    expect(store.doc.pages[0].strokes[0]).not.toHaveProperty('locked');
    expect(store.doc.pages[0].items[0]).not.toHaveProperty('locked');
  });

  it('only builds ops for content not already locked', () => {
    expect(lockSelectionOps(locked.pages[0], sel)).toEqual([]);
  });

  it('the lasso and Delete items pass over locked content', () => {
    const p = locked.pages[0];
    const all = selectWithLasso(unlockedContent(p), rectPolygon({ x: -5, y: -5 }, { x: 100, y: 100 }), LASSO_KINDS);
    expect(all).toEqual({ pageId: 'p', strokeIds: ['b', 'c'], itemIds: ['y', 'z'] });
    expect(countContent(p).pen).toBe(2);
    const cleared = run(deleteContentOps(p, 'all'), locked);
    expect(ids(cleared)).toEqual({ strokes: ['a'], items: ['x'] });
  });

  it('unlock all unlocks the page and undoes back to locked', () => {
    const ops = unlockAllOps(locked.pages[0]);
    const open = run(ops, locked);
    expect(countLocked(open.pages[0])).toBe(0);
    expect(countLocked(undo(ops, open).pages[0])).toBe(2);
  });
});
