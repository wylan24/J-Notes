import { describe, expect, it } from 'vitest';
import type { LineItem, NotebookDoc, Page, ShapeItem } from '../src/core/model';
import { anchorPoint, attachAt, attachDrawnLine, attachmentAt, followUpOps, reidItems } from '../src/core/connectors';
import { bendHandle, bendTo, lineEnds, linePath, newLine } from '../src/core/shapeItems';
import { DocumentStore } from '../src/core/store';
import { removeItemsOp, updateItemOp } from '../src/core/ops';
import { duplicateSelection, moveSelectionOps } from '../src/core/selection';
import { rotateAbout, transformItem } from '../src/core/transform';

const style = { color: '#111111', width: 2, dash: 'solid' as const };

const box = (id: string, x: number, y: number, over: Partial<ShapeItem> = {}): ShapeItem => ({ id, kind: 'shape', shape: 'rect', x, y, w: 100, h: 60, color: '#111111', width: 2, ...over });

/** A connector from the right edge of A (at 100, 30) to the left edge of B (at 300, 30). */
function connector(): LineItem {
  return {
    ...newLine({ x: 100, y: 30 }, { x: 300, y: 30 }, style, 'end'),
    id: 'c',
    from: { id: 'a', at: { x: 1, y: 0.5 } },
    to: { id: 'b', at: { x: 0, y: 0.5 } },
  };
}

function setup(): DocumentStore {
  const page: Page = { id: 'p', template: 'blank', strokes: [], items: [box('a', 0, 0), box('b', 300, 0), connector()] };
  return new DocumentStore({ id: 'd', pages: [page] } as NotebookDoc);
}

const pageOf = (s: DocumentStore) => s.doc.pages[0];
const line = (s: DocumentStore) => pageOf(s).items.find((i) => i.id === 'c') as LineItem;

describe('attachments', () => {
  it('turn with the item they are on', () => {
    const turned = box('a', 0, 0, { rotation: Math.PI });
    const p = anchorPoint(turned, { x: 1, y: 0.5 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(30);
  });

  it('attach to the nearest point on the outline, wherever the end is dropped', () => {
    expect(attachAt(box('a', 0, 0), { x: 90, y: 30 }).at).toEqual({ x: 1, y: 0.5 });
    const page: Page = { id: 'p', template: 'blank', strokes: [], items: [box('a', 0, 0)] };
    expect(attachmentAt(page, { x: 50, y: 5 }, 8)?.at).toEqual({ x: 0.5, y: 0 });
    expect(attachmentAt(page, { x: 200, y: 200 }, 8)).toBeNull();
  });

  it('a drawn line attaches only ends drawn on an edge, and never both to one item', () => {
    const page: Page = { id: 'p', template: 'blank', strokes: [], items: [box('a', 0, 0), box('b', 300, 0)] };
    const drawn = attachDrawnLine(page, newLine({ x: 103, y: 28 }, { x: 297, y: 33 }, style), 8);
    expect(drawn.from?.id).toBe('a');
    expect(drawn.to?.id).toBe('b');
    expect(lineEnds(drawn)[0]).toEqual({ x: 100, y: 28 });

    // Underlining inside a box leaves the line free.
    const inside = attachDrawnLine(page, newLine({ x: 20, y: 40 }, { x: 80, y: 40 }, style), 8);
    expect(inside.from).toBeUndefined();
    expect(inside.to).toBeUndefined();

    // Across a box from one edge to the other: one end attaches.
    const across = attachDrawnLine(page, newLine({ x: 0, y: 30 }, { x: 100, y: 30 }, style), 8);
    expect(across.from?.id).toBe('a');
    expect(across.to).toBeUndefined();
  });
});

describe('following', () => {
  it('moves the connector with its shape, in the same undo step', () => {
    const s = setup();
    s.dispatch([updateItemOp(pageOf(s), 'b', { x: 300, y: 200 })!]);
    expect(lineEnds(line(s))[1]).toEqual({ x: 300, y: 230 });
    expect(lineEnds(line(s))[0]).toEqual({ x: 100, y: 30 });
    s.undo();
    expect(lineEnds(line(s))[1]).toEqual({ x: 300, y: 30 });
    expect(s.canUndo).toBe(false);
    s.redo();
    expect(lineEnds(line(s))[1]).toEqual({ x: 300, y: 230 });
  });

  it('follows a shape that is turned', () => {
    const s = setup();
    s.dispatch([updateItemOp(pageOf(s), 'b', { rotation: Math.PI })!]);
    expect(lineEnds(line(s))[1].x).toBeCloseTo(400);
  });

  it('lets go when the shape is deleted, and holds on again on undo', () => {
    const s = setup();
    s.dispatch([removeItemsOp(pageOf(s), ['b'])!]);
    expect(line(s).to).toBeUndefined();
    expect(lineEnds(line(s))[1]).toEqual({ x: 300, y: 30 });
    s.undo();
    expect(line(s).to?.id).toBe('b');
  });

  it('adds nothing when nothing attached moved', () => {
    const s = setup();
    expect(followUpOps(s.doc, [{ type: 'items.updated', pageId: 'p', id: 'a', patch: {}, previous: {} }])).toEqual([]);
  });

  it('a connector moved on its own lets go of both shapes', () => {
    const s = setup();
    s.dispatch(moveSelectionOps(pageOf(s), { pageId: 'p', strokeIds: [], itemIds: ['c'] }, 0, 100));
    expect(line(s).from).toBeUndefined();
    expect(line(s).to).toBeUndefined();
    expect(lineEnds(line(s))[0]).toEqual({ x: 100, y: 130 });
  });

  it('a connector moved with its shapes stays attached', () => {
    const s = setup();
    s.dispatch(moveSelectionOps(pageOf(s), { pageId: 'p', strokeIds: [], itemIds: ['a', 'b', 'c'] }, 10, 10));
    expect(line(s).from?.id).toBe('a');
    expect(lineEnds(line(s))[1]).toEqual({ x: 310, y: 40 });
  });
});

describe('copies', () => {
  it('a duplicated diagram connects the copies, not the originals', () => {
    const s = setup();
    const dup = duplicateSelection(pageOf(s), { pageId: 'p', strokeIds: [], itemIds: ['a', 'b', 'c'] }, 24, 24);
    s.dispatch(dup.ops);
    const copy = pageOf(s).items.find((i) => i.kind === 'line' && i.id !== 'c') as LineItem;
    expect(dup.selection.itemIds).toContain(copy.from!.id);
    expect(dup.selection.itemIds).toContain(copy.to!.id);
    expect(lineEnds(copy)[0]).toEqual({ x: 124, y: 54 });
  });

  it('a connector copied alone is free', () => {
    const [copy] = reidItems([connector()]);
    expect(copy.id).not.toBe('c');
    expect((copy as LineItem).from).toBeUndefined();
  });
});

describe('routes', () => {
  const base = newLine({ x: 0, y: 0 }, { x: 200, y: 100 }, style);

  it('curved lines bulge, and the bend handle sits on the curve', () => {
    const curved: LineItem = { ...base, route: 'curved' };
    const path = linePath(curved);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 200, y: 100 });
    const h = bendHandle(curved);
    expect(path.some((p) => Math.hypot(p.x - h.x, p.y - h.y) < 1e-9)).toBe(true);
  });

  it('dragging the bend handle puts it where it was dropped', () => {
    const curved = { ...base, ...bendTo(base, { x: 60, y: 90 }) };
    expect(curved.route).toBe('curved');
    const h = bendHandle(curved);
    expect(h.x).toBeCloseTo(60);
    expect(h.y).toBeCloseTo(90);
    const elbow: LineItem = { ...base, route: 'elbow' };
    const slid = { ...elbow, ...bendTo(elbow, { x: 150, y: 0 }) };
    expect(linePath(slid)[1]).toEqual({ x: 150, y: 0 });
  });

  it('elbows run across first when the ends are further apart sideways', () => {
    expect(linePath({ ...base, route: 'elbow' })).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
  });

  it('a bend keeps its shape when the line is turned', () => {
    const curved: LineItem = { ...base, ...bendTo(base, { x: 60, y: 90 }) };
    const turned = transformItem(curved, rotateAbout(Math.PI / 2, { x: 0, y: 0 }));
    const h = bendHandle(turned);
    expect(h.x).toBeCloseTo(-90);
    expect(h.y).toBeCloseTo(60);
  });
});
