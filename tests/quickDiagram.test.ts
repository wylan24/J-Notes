import { describe, expect, it } from 'vitest';
import type { LineItem, NotebookDoc, Page, ShapeItem } from '../src/core/model';
import { QUICK_GAP, quickConnectOps } from '../src/core/connectors';
import { lineEnds } from '../src/core/shapeItems';
import { DocumentStore } from '../src/core/store';
import { updateItemOp } from '../src/core/ops';

const A4 = { w: 794, h: 1123 };
const shape = (over: Partial<ShapeItem> = {}): ShapeItem => ({ id: 's', kind: 'shape', shape: 'ellipse', x: 100, y: 100, w: 120, h: 80, color: '#2557c7', width: 3, fill: '#cfe1ff', ...over });
const pageWith = (...items: Page['items']): Page => ({ id: 'p', template: 'blank', strokes: [], items });

describe('quick diagramming', () => {
  it('adds a copy beside the shape, joined by an arrow, in one step', () => {
    const made = quickConnectOps(pageWith(shape()), 's', 'e', A4)!;
    expect(made.ops).toHaveLength(1);
    const op = made.ops[0];
    if (op.type !== 'items.added') throw new Error(op.type);
    const [copy, line] = op.items as [ShapeItem, LineItem];
    expect(copy).toMatchObject({ id: made.copyId, shape: 'ellipse', x: 100 + 120 + QUICK_GAP, y: 100, fill: '#cfe1ff' });
    expect(line).toMatchObject({ arrow: 'end', color: '#2557c7', from: { id: 's', at: { x: 1, y: 0.5 } }, to: { id: made.copyId, at: { x: 0, y: 0.5 } } });
    expect(lineEnds(line)).toEqual([
      { x: 220, y: 140 },
      { x: 280, y: 140 },
    ]);
  });

  it('goes the way the shape is turned', () => {
    const made = quickConnectOps(pageWith(shape({ rotation: Math.PI / 2 })), 's', 'e', A4)!;
    const op = made.ops[0];
    if (op.type !== 'items.added') throw new Error(op.type);
    // Turned a quarter, its right side faces down the page.
    expect(op.items[0].x).toBeCloseTo(100);
    expect(op.items[0].y).toBeCloseTo(100 + 120 + QUICK_GAP);
  });

  it('keeps the copy on the page', () => {
    const made = quickConnectOps(pageWith(shape({ x: 10 })), 's', 'w', A4)!;
    const op = made.ops[0];
    if (op.type !== 'items.added') throw new Error(op.type);
    expect(op.items[0].x).toBe(0);
  });

  it('only works on shapes, and never copies a lock', () => {
    const text = { id: 't', kind: 'text' as const, x: 0, y: 0, w: 50, h: 20, text: 'hi', font: 'sans', size: 16, color: '#000000' };
    expect(quickConnectOps(pageWith(text), 't', 'e', A4)).toBeNull();
    const made = quickConnectOps(pageWith(shape({ locked: true })), 's', 's', A4)!;
    const op = made.ops[0];
    if (op.type !== 'items.added') throw new Error(op.type);
    expect(op.items[0].locked).toBeUndefined();
  });

  it('the new connector follows either shape afterwards', () => {
    const store = new DocumentStore({ id: 'd', pages: [pageWith(shape())] } as NotebookDoc);
    const made = quickConnectOps(store.doc.pages[0], 's', 's', A4)!;
    store.dispatch(made.ops);
    store.dispatch([updateItemOp(store.doc.pages[0], made.copyId, { x: 400 })!]);
    const line = store.doc.pages[0].items.find((i) => i.kind === 'line') as LineItem;
    expect(lineEnds(line)[1]).toEqual({ x: 460, y: 100 + 80 + QUICK_GAP });
  });
});
