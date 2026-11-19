import { describe, expect, it } from 'vitest';
import type { NotebookDoc, Page } from '../src/core/model';
import { applyOp, inverseOp } from '../src/core/ops';
import { countTape, newTape, removeAllTapeOps, TAPE_THICKNESS, tapeAt, tapeRect, toggleRevealed } from '../src/core/tape';
import { normalizePrefs, TOOLBAR_ITEMS } from '../src/core/toolbarPrefs';
import { DocumentStore } from '../src/core/store';

describe('tape', () => {
  it('covers the box a drag spans', () => {
    expect(tapeRect({ x: 10, y: 10 }, { x: 110, y: 60 })).toEqual({ x: 10, y: 10, w: 100, h: 50 });
    expect(tapeRect({ x: 110, y: 60 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, w: 100, h: 50 });
  });

  it('makes a swipe along a line into a strip thick enough to cover it', () => {
    const r = tapeRect({ x: 0, y: 100 }, { x: 200, y: 104 })!;
    expect(r.h).toBe(TAPE_THICKNESS);
    expect(r.y + r.h / 2).toBe(102); // centred on the swipe
  });

  it('ignores drags too short to be tape (they are taps)', () => {
    expect(tapeRect({ x: 0, y: 0 }, { x: 5, y: 5 })).toBeNull();
  });

  const page = (id: string, n: number): Page => ({ id, template: 'blank', strokes: [], items: Array.from({ length: n }, (_, i) => ({ ...newTape({ x: i * 50, y: 0, w: 40, h: 20 }, '#fc0'), id: `${id}t${i}` })) });

  it('finds the top-most strip under a point', () => {
    const p = page('p', 2);
    p.items.push({ ...newTape({ x: 0, y: 0, w: 100, h: 20 }, '#0cf'), id: 'top' });
    expect(tapeAt(p, { x: 10, y: 10 })?.id).toBe('top');
    expect(tapeAt(p, { x: 10, y: 50 })).toBeNull();
  });

  it('removes all tape in the notebook as one undoable step', () => {
    const doc: NotebookDoc = { id: 'd', pages: [page('a', 2), page('b', 0), page('c', 1)] };
    doc.pages[0].items.splice(1, 0, { id: 'note', kind: 'sticky', x: 0, y: 0, w: 50, h: 50, text: 'keep', color: '#ff0', collapsed: false });
    expect(countTape(doc)).toBe(3);
    const store = new DocumentStore(doc);
    store.dispatch(removeAllTapeOps(store.doc));
    expect(countTape(store.doc)).toBe(0);
    expect(store.doc.pages[0].items.map((it) => it.id)).toEqual(['note']);
    store.undo();
    expect(store.doc).toEqual(doc); // strips back in their original places
    for (const op of removeAllTapeOps(doc)) expect(applyOp(applyOp(doc, op), inverseOp(op))).toEqual(doc);
  });

  it('shows and covers strips', () => {
    let r = toggleRevealed(new Set(), 'a');
    expect(r.has('a')).toBe(true);
    r = toggleRevealed(r, 'a');
    expect(r.has('a')).toBe(false);
  });

  it('adds the Tape tool to toolbars saved before it existed', () => {
    const before = TOOLBAR_ITEMS.filter((i) => i !== 'tape');
    const prefs = normalizePrefs({ order: before, hidden: [] });
    expect(prefs.order).toContain('tape');
    expect(prefs.order.indexOf('tape')).toBe(prefs.order.indexOf('laser') + 1);
  });
});
