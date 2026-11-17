import { describe, expect, it } from 'vitest';
import type { NotebookDoc, PageItem, Stroke } from '../src/core/model';
import { applyOp, inverseOp } from '../src/core/ops';
import { DocumentStore } from '../src/core/store';
import {
  applyMatrix,
  invert,
  isIdentity,
  matrixScale,
  multiply,
  rotateAbout,
  rotationAngle,
  scaleAbout,
  snapAngle,
  transformBounds,
  transformItem,
  transformSelectionOps,
  translate,
  type Matrix,
} from '../src/core/transform';

const stroke = (id: string, pts: [number, number][], width = 2): Stroke => ({
  id,
  tool: 'pen',
  color: '#000',
  width,
  simulatePressure: false,
  points: pts.map(([x, y], i) => ({ x, y, p: 0.5, t: i })),
});

const doc = (): NotebookDoc => ({
  id: 'd',
  pages: [
    {
      id: 'p',
      template: 'blank',
      strokes: [stroke('a', [[0, 0], [100, 0]], 4), stroke('b', [[0, 50], [100, 50]])],
      items: [
        { id: 't', kind: 'text', x: 0, y: 100, w: 100, h: 30, text: 'hi', font: 'sans', size: 20, color: '#000' },
        { id: 's', kind: 'sticky', x: 200, y: 200, w: 100, h: 100, text: '', color: '#ff0', collapsed: true },
      ],
    },
  ],
});

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('matrices', () => {
  it('scale about a point keeps that point fixed', () => {
    const m = scaleAbout(2, { x: 10, y: 20 });
    expect(applyMatrix(m, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(applyMatrix(m, { x: 11, y: 20 })).toEqual({ x: 12, y: 20 });
    expect(matrixScale(m)).toBe(2);
  });

  it('rotation about a point turns around it', () => {
    const m = rotateAbout(Math.PI / 2, { x: 0, y: 0 });
    const p = applyMatrix(m, { x: 1, y: 0 });
    close(p.x, 0);
    close(p.y, 1);
    close(matrixScale(m), 1);
    close(rotationAngle(m), Math.PI / 2);
  });

  it('inverts and composes', () => {
    const m: Matrix = multiply(translate(5, -3), multiply(rotateAbout(0.7, { x: 3, y: 4 }), scaleAbout(1.5, { x: -2, y: 8 })));
    const id = multiply(m, invert(m));
    expect(isIdentity(id, 1e-12)).toBe(true);
    expect(isIdentity(m)).toBe(false);
  });

  it('snaps near right angles', () => {
    expect(snapAngle((88 * Math.PI) / 180)).toBeCloseTo(Math.PI / 2);
    expect(snapAngle(-0.03)).toBe(0);
    expect(snapAngle(0.5)).toBe(0.5);
  });

  it('maps bounds to the box around the transformed corners', () => {
    const b = transformBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, rotateAbout(Math.PI / 4, { x: 5, y: 5 }));
    close(b.maxX - b.minX, 10 * Math.SQRT2);
  });
});

describe('strokes.transformed', () => {
  it('maps points, scales width and keeps other point fields', () => {
    const m = scaleAbout(2, { x: 0, y: 0 });
    const input = doc();
    const d = applyOp(input, { type: 'strokes.transformed', pageId: 'p', ids: ['a'], matrix: m });
    const a = d.pages[0].strokes[0];
    expect(a.points[1]).toEqual({ x: 200, y: 0, p: 0.5, t: 1 });
    expect(a.width).toBe(8);
    expect(d.pages[0].strokes[1]).toBe(input.pages[0].strokes[1]); // untouched strokes are shared
  });

  it('is undone by its inverse (to floating-point precision)', () => {
    const op = { type: 'strokes.transformed' as const, pageId: 'p', ids: ['a', 'b'], matrix: multiply(rotateAbout(1.1, { x: 50, y: 25 }), scaleAbout(0.3, { x: 7, y: 9 })) };
    const back = applyOp(applyOp(doc(), op), inverseOp(op));
    const orig = doc().pages[0].strokes;
    back.pages[0].strokes.forEach((s, i) => {
      close(s.width, orig[i].width);
      s.points.forEach((p, j) => {
        close(p.x, orig[i].points[j].x);
        close(p.y, orig[i].points[j].y);
      });
    });
  });
});

describe('transformItem', () => {
  const text = doc().pages[0].items[0] as Extract<PageItem, { kind: 'text' }>;

  it('scales text boxes, font size included, about the anchor', () => {
    const t = transformItem(text, scaleAbout(2, { x: 0, y: 100 }));
    expect(t).toMatchObject({ x: 0, y: 100, w: 200, h: 60, size: 40 });
  });

  it('moves items without turning them under rotation', () => {
    const t = transformItem(text, rotateAbout(Math.PI, { x: 100, y: 115 }));
    expect(t).toMatchObject({ w: 100, h: 30, size: 20 });
    close(t.x, 100);
    close(t.y, 100);
  });

  it('a collapsed sticky note moves but keeps its size', () => {
    const s = doc().pages[0].items[1];
    const t = transformItem(s, scaleAbout(3, { x: 0, y: 0 }));
    expect(t).toMatchObject({ w: 100, h: 100 });
    expect(t.x).toBeGreaterThan(200);
  });
});

describe('transformSelectionOps', () => {
  it('transforms strokes and items in one undoable step', () => {
    const store = new DocumentStore(doc());
    const ops = transformSelectionOps(store.doc.pages[0], { pageId: 'p', strokeIds: ['a'], itemIds: ['t'] }, scaleAbout(2, { x: 0, y: 0 }));
    expect(ops.map((o) => o.type)).toEqual(['strokes.transformed', 'items.updated']);
    store.dispatch(ops);
    expect(store.doc.pages[0].items[0]).toMatchObject({ size: 40, w: 200 });
    store.undo();
    expect(store.doc.pages[0].items).toEqual(doc().pages[0].items);
    close(store.doc.pages[0].strokes[0].points[1].x, 100);
  });

  it('does nothing for the identity', () => {
    expect(transformSelectionOps(doc().pages[0], { pageId: 'p', strokeIds: ['a'], itemIds: ['t'] }, [1, 0, 0, 1, 0, 0])).toEqual([]);
  });
});
