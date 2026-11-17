import { describe, expect, it } from 'vitest';
import type { NotebookDoc, Stroke } from '../src/core/model';
import { applyOp, inverseOp, removeStrokesOp, replay, type DocOp } from '../src/core/ops';
import { DocumentStore } from '../src/core/store';
import { strokeHitsCircle, strokesInLasso } from '../src/core/geometry';
import { detectLine } from '../src/core/shapes';

const stroke = (id: string, pts: [number, number][], width = 2): Stroke => ({
  id,
  tool: 'pen',
  color: '#000',
  width,
  simulatePressure: true,
  points: pts.map(([x, y]) => ({ x, y, p: 0.5 })),
});

const baseDoc = (): NotebookDoc => ({
  id: 'doc',
  pages: [{ id: 'p1', template: 'blank', strokes: [stroke('a', [[0, 0], [10, 0]]), stroke('b', [[0, 20], [10, 20]]), stroke('c', [[0, 40], [10, 40]])] }],
});

describe('ops', () => {
  it('every op is undone exactly by its inverse', () => {
    const doc = baseDoc();
    const page = doc.pages[0];
    const ops: DocOp[] = [
      { type: 'page.added', index: 1, page: { id: 'p2', template: 'grid', strokes: [] } },
      { type: 'strokes.added', pageId: 'p1', strokes: [stroke('d', [[5, 5], [6, 6]])] },
      removeStrokesOp(page, ['a', 'c'])!,
      { type: 'strokes.translated', pageId: 'p1', ids: ['b'], dx: 5, dy: -3 },
      { type: 'strokes.recolored', pageId: 'p1', ids: ['a', 'b'], colors: ['#f00', '#0f0'], previous: ['#000', '#000'] },
    ];
    for (const op of ops) {
      const after = applyOp(doc, op);
      expect(after).not.toEqual(doc);
      expect(applyOp(after, inverseOp(op))).toEqual(doc);
    }
  });

  it('restores erased strokes at their original z-order', () => {
    const doc = baseDoc();
    const op = removeStrokesOp(doc.pages[0], ['b'])!;
    const restored = applyOp(applyOp(doc, op), inverseOp(op));
    expect(restored.pages[0].strokes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input document', () => {
    const doc = baseDoc();
    const frozen = JSON.stringify(doc);
    applyOp(doc, { type: 'strokes.translated', pageId: 'p1', ids: ['a'], dx: 1, dy: 1 });
    expect(JSON.stringify(doc)).toBe(frozen);
  });

  it('ignores ops for missing pages', () => {
    const doc = baseDoc();
    expect(applyOp(doc, { type: 'strokes.added', pageId: 'nope', strokes: [] })).toBe(doc);
  });
});

describe('DocumentStore', () => {
  it('undo/redo round-trips and emits sequenced events', () => {
    const store = new DocumentStore(baseDoc(), 7);
    const events: number[] = [];
    store.onEvents((e) => events.push(...e.map((x) => x.seq)));
    store.dispatch([{ type: 'strokes.added', pageId: 'p1', strokes: [stroke('z', [[1, 1], [2, 2]])] }]);
    expect(store.doc.pages[0].strokes).toHaveLength(4);
    store.undo();
    expect(store.doc).toEqual(baseDoc());
    expect(store.canRedo).toBe(true);
    store.redo();
    expect(store.doc.pages[0].strokes.at(-1)!.id).toBe('z');
    expect(events).toEqual([8, 9, 10]);
  });

  it('a new action clears the redo stack', () => {
    const store = new DocumentStore(baseDoc());
    store.dispatch([{ type: 'strokes.translated', pageId: 'p1', ids: ['a'], dx: 1, dy: 0 }]);
    store.undo();
    store.dispatch([{ type: 'strokes.translated', pageId: 'p1', ids: ['b'], dx: 1, dy: 0 }]);
    expect(store.canRedo).toBe(false);
  });

  it('replaying the emitted log reproduces the in-memory doc', () => {
    const initial = baseDoc();
    const store = new DocumentStore(initial);
    const log: Parameters<typeof replay>[1] = [];
    store.onEvents((e) => log.push(...e));
    store.dispatch([removeStrokesOp(store.doc.pages[0], ['a'])!]);
    store.dispatch([{ type: 'page.added', index: 1, page: { id: 'p2', template: 'ruled', strokes: [] } }]);
    store.undo();
    store.dispatch([{ type: 'strokes.translated', pageId: 'p1', ids: ['c'], dx: 3, dy: 3 }]);
    expect(replay(initial, log)).toEqual(store.doc);
  });
});

describe('geometry', () => {
  it('eraser hits account for stroke width', () => {
    const s = stroke('a', [[0, 0], [100, 0]], 10);
    expect(strokeHitsCircle(s, 50, 12, 8)).toBe(true); // 12 <= 8 + 5
    expect(strokeHitsCircle(s, 50, 14, 8)).toBe(false);
    expect(strokeHitsCircle(s, 200, 0, 8)).toBe(false);
  });

  it('lasso selects strokes mostly inside the polygon', () => {
    const inside = stroke('in', [[10, 10], [20, 20], [30, 30]]);
    const outside = stroke('out', [[200, 200], [210, 210]]);
    const straddle = stroke('half', [[90, 50], [95, 50], [150, 50], [160, 50], [170, 50]]);
    const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(strokesInLasso([inside, outside, straddle], square)).toEqual(['in']);
  });

  it('detects near-straight strokes and rejects curves', () => {
    const wobbly = Array.from({ length: 30 }, (_, i) => ({ x: i * 5, y: Math.sin(i) * 2, p: 0.5 }));
    expect(detectLine(wobbly)).not.toBeNull();
    const arc = Array.from({ length: 30 }, (_, i) => ({ x: Math.cos(i / 10) * 100, y: Math.sin(i / 10) * 100, p: 0.5 }));
    expect(detectLine(arc)).toBeNull();
  });
});
