import { describe, expect, it } from 'vitest';
import { snapMove, snapTargets } from '../src/core/snap';
import type { Page, PageItem, Stroke } from '../src/core/model';

const img = (id: string, x: number, y: number, w = 100, h = 50): PageItem => ({ id, kind: 'image', x, y, w, h, blobId: 'b' }) as PageItem;
const ink = (id: string, shape = false, x = 300): Stroke => ({ id, tool: 'pen', color: '#000', width: 0, simulatePressure: false, shape, points: [{ x, y: 300, p: 0.5 }, { x: x + 50, y: 333, p: 0.5 }] });
const blank = (extra: Partial<Page> = {}): Page => ({ id: 'p', template: 'blank', strokes: [], items: [img('a', 200, 100), img('moving', 0, 400, 60, 40)], ...extra });
const sel = { pageId: 'p', strokeIds: [], itemIds: ['moving'] };
const box = { minX: 0, minY: 400, maxX: 60, maxY: 440 };
const SIZE = { w: 794, h: 1123 };

describe('snap targets', () => {
  it('include other objects and the page, not the selection or handwriting', () => {
    const t = snapTargets(blank({ strokes: [ink('hand', false, 600), ink('shape', true)] }), sel);
    const xs = t.x.map((s) => s.at);
    expect(xs).toEqual(expect.arrayContaining([200, 250, 300, 325, 350, 0, 397, 794]));
    expect(xs).not.toContain(30); // the selection's own centre
    expect(xs).not.toContain(600); // handwriting isn't a target
  });

  it('include the paper lines', () => {
    const ruled = snapTargets(blank({ template: 'ruled' }), sel);
    expect(ruled.y.map((s) => s.at)).toContain(112 + 32);
    const grid = snapTargets(blank({ template: 'grid' }), sel);
    expect(grid.x.map((s) => s.at)).toContain(28 * 3);
  });
});

describe('snapMove', () => {
  const targets = snapTargets(blank(), sel);

  it('lines a left edge up with an object within the threshold, and draws a guide across both', () => {
    const r = snapMove(box, 196, 0, targets, 6, SIZE);
    expect(r.dx).toBe(200);
    expect(r.dy).toBe(0);
    expect(r.guides).toContainEqual({ axis: 'x', at: 200, from: 100, to: 440 });
  });

  it('snaps centres to centres', () => {
    // Moving box centre x = 30 + dx; the object's centre is 250.
    expect(snapMove(box, 223, 0, targets, 6, SIZE).dx).toBe(220);
  });

  it('leaves the move alone when nothing is near', () => {
    const r = snapMove(box, 120, 37, targets, 6, SIZE);
    expect(r).toEqual({ dx: 120, dy: 37, guides: [] });
  });

  it('snaps each axis on its own, picking the nearest target', () => {
    // Top edge 400 + dy near the object's bottom (150) and the page centre (561.5).
    const r = snapMove(box, 197, -248, targets, 6, SIZE);
    expect(r.dx).toBe(200);
    expect(r.dy).toBe(-250);
  });

  it('a page-centre guide runs the full page', () => {
    const r = snapMove(box, 364, 0, targets, 6, SIZE); // centre 394 → 397
    expect(r.dx).toBe(367);
    expect(r.guides).toContainEqual({ axis: 'x', at: 397, from: 0, to: 1123 });
  });
});
