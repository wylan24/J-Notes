import { describe, expect, it } from 'vitest';
import type { NotebookDoc, Stroke } from '../src/core/model';
import { replaceStrokesOps, resample, splitStroke } from '../src/core/erase';
import { DocumentStore } from '../src/core/store';

const stroke = (id: string, pts: [number, number][], width = 2): Stroke => ({
  id,
  tool: 'pen',
  color: '#123',
  width,
  simulatePressure: false,
  penStyle: 'ball',
  points: pts.map(([x, y]) => ({ x, y, p: 0.5 })),
});

describe('resample', () => {
  it('fills gaps and interpolates pressure', () => {
    const out = resample([{ x: 0, y: 0, p: 0 }, { x: 10, y: 0, p: 1 }], 2);
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ x: 0, y: 0, p: 0 });
    expect(out.at(-1)).toEqual({ x: 10, y: 0, p: 1 });
    expect(out[2].x).toBeCloseTo(4);
    expect(out[2].p).toBeCloseTo(0.4);
  });
});

describe('splitStroke', () => {
  const line = stroke('a', [[0, 0], [100, 0]]);

  it('returns null when the eraser misses', () => {
    expect(splitStroke(line, [{ x: 50, y: 40 }], 5)).toBeNull();
  });

  it('cuts a gap through the middle, keeping style on both pieces', () => {
    const pieces = splitStroke(line, [{ x: 50, y: -20 }, { x: 50, y: 20 }], 5)!;
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces;
    expect(Math.max(...left.points.map((p) => p.x))).toBeLessThan(45);
    expect(Math.min(...right.points.map((p) => p.x))).toBeGreaterThan(55);
    for (const p of pieces) {
      expect(p.id).not.toBe('a');
      expect(p).toMatchObject({ color: '#123', width: 2, penStyle: 'ball', tool: 'pen' });
    }
  });

  it('keeps original point spacing, adding only the cut ends', () => {
    const s = stroke('w', [[0, 0], [20, 0], [40, 0], [60, 0], [80, 0], [100, 0]]);
    const [left, right] = splitStroke(s, [{ x: 50, y: -20 }, { x: 50, y: 20 }], 5)!;
    expect(left.points.map((p) => p.x).slice(0, -1)).toEqual([0, 20, 40]);
    expect(right.points.map((p) => p.x).slice(1)).toEqual([60, 80, 100]);
    expect(left.points.at(-1)!.x).toBeGreaterThan(40);
    expect(right.points[0].x).toBeLessThan(60);
  });

  it('trims an end without creating a second piece', () => {
    const pieces = splitStroke(line, [{ x: 100, y: 0 }], 10)!;
    expect(pieces).toHaveLength(1);
    expect(pieces[0].points[0].x).toBe(0);
  });

  it('returns no pieces when the whole stroke is covered', () => {
    expect(splitStroke(stroke('s', [[0, 0], [4, 0]]), [{ x: 2, y: 0 }], 10)).toEqual([]);
  });
});

describe('replaceStrokesOps', () => {
  const doc = (): NotebookDoc => ({
    id: 'd',
    pages: [{ id: 'p', template: 'blank', strokes: [stroke('a', [[0, 0], [100, 0]]), stroke('b', [[0, 20], [100, 20]]), stroke('c', [[0, 40], [100, 40]])] }],
  });

  it('puts pieces where the original was and undoes in one step', () => {
    const store = new DocumentStore(doc());
    const page = store.doc.pages[0];
    const pieces = splitStroke(page.strokes[1], [{ x: 50, y: 0 }, { x: 50, y: 30 }], 4)!;
    store.dispatch(replaceStrokesOps(page, new Map([['b', pieces]])));
    const ids = store.doc.pages[0].strokes.map((s) => s.id);
    expect(ids).toEqual(['a', pieces[0].id, pieces[1].id, 'c']);
    store.undo();
    expect(store.doc).toEqual(doc());
    store.redo();
    expect(store.doc.pages[0].strokes.map((s) => s.id)).toEqual(ids);
  });

  it('removes strokes that were erased completely', () => {
    const store = new DocumentStore(doc());
    const page = store.doc.pages[0];
    store.dispatch(replaceStrokesOps(page, new Map([['a', []], ['c', []]])));
    expect(store.doc.pages[0].strokes.map((s) => s.id)).toEqual(['b']);
    store.undo();
    expect(store.doc).toEqual(doc());
  });
});
