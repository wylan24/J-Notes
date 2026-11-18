import { describe, expect, it } from 'vitest';
import type { LineItem, Page, ShapeItem } from '../src/core/model';
import { cornerRadius, itemFromShape, lineEnds, lineGeometry, lineStrokes, newLine, shapeOutline, touchesCircle } from '../src/core/shapeItems';
import { itemAt, itemBounds, pointOnItem, resizeItem, canRotate } from '../src/core/items';
import { rotateAbout, scaleAbout, transformItem, transformSelectionOps } from '../src/core/transform';
import { countContent, deleteContentOps } from '../src/core/contentKinds';
import { lassoAllowsItem } from '../src/core/lasso';
import { applyOp, inverseOp, updateItemOp } from '../src/core/ops';
import { decodeClip } from '../src/core/clipboard';

const style = { color: '#111111', width: 3, dash: 'solid' as const };

function rect(over: Partial<ShapeItem> = {}): ShapeItem {
  return { id: 's1', kind: 'shape', shape: 'rect', x: 100, y: 100, w: 200, h: 100, color: '#111111', width: 3, ...over };
}

function pageWith(...items: Page['items']): Page {
  return { id: 'p', template: 'blank', strokes: [], items };
}

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('recognised shapes become items', () => {
  it('turns an axis-aligned rectangle into an unturned rect item', () => {
    const it = itemFromShape(
      {
        kind: 'rectangle',
        points: [
          { x: 10, y: 20 },
          { x: 110, y: 20 },
          { x: 110, y: 80 },
          { x: 10, y: 80 },
        ],
      },
      { ...style, fill: '#fdf0a6' },
    ) as ShapeItem;
    expect(it).toMatchObject({ kind: 'shape', shape: 'rect', x: 10, y: 20, w: 100, h: 60, fill: '#fdf0a6' });
    expect(it.rotation).toBeUndefined();
  });

  it('keeps a turned rectangle turned, about its own centre', () => {
    const th = 0.3, c = Math.cos(th), s = Math.sin(th);
    const corner = (u: number, v: number) => ({ x: 200 + u * c - v * s, y: 200 + u * s + v * c });
    const it = itemFromShape({ kind: 'rectangle', points: [corner(-50, -20), corner(50, -20), corner(50, 20), corner(-50, 20)] }, style) as ShapeItem;
    close(it.rotation!, th);
    close(it.w, 100);
    close(it.h, 40);
    close(it.x + it.w / 2, 200);
    close(it.y + it.h / 2, 200);
  });

  it('turns ellipses, polygons, lines and arrows into the matching items', () => {
    const e = itemFromShape({ kind: 'ellipse', cx: 50, cy: 60, rx: 40, ry: 20, rotation: 0 }, style) as ShapeItem;
    expect(e).toMatchObject({ shape: 'ellipse', x: 10, y: 40, w: 80, h: 40 });
    expect(e.rotation).toBeUndefined();

    const tri = itemFromShape(
      {
        kind: 'triangle',
        points: [
          { x: 0, y: 100 },
          { x: 50, y: 0 },
          { x: 100, y: 100 },
        ],
      },
      style,
    ) as ShapeItem;
    expect(tri).toMatchObject({ shape: 'polygon', x: 0, y: 0, w: 100, h: 100 });
    expect(tri.points).toEqual([
      { x: 0, y: 1 },
      { x: 0.5, y: 0 },
      { x: 1, y: 1 },
    ]);

    const line = itemFromShape({ kind: 'line', a: { x: 30, y: 10 }, b: { x: 0, y: 40 } }, style) as LineItem;
    expect(line.kind).toBe('line');
    expect(lineEnds(line)).toEqual([
      { x: 30, y: 10 },
      { x: 0, y: 40 },
    ]);
    const arrow = itemFromShape({ kind: 'arrow', tail: { x: 0, y: 0 }, tip: { x: 100, y: 0 } }, style) as LineItem;
    expect(arrow.arrow).toBe('end');
    expect(lineStrokes(arrow)).toHaveLength(2); // shaft and head
  });

  it('records a dashed style and leaves solid unset', () => {
    expect(itemFromShape({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, { ...style, dash: 'dotted' }).dash).toBe('dotted');
    expect('dash' in itemFromShape({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, style)).toBe(false);
  });
});

describe('shape outlines', () => {
  it('closes the outline and keeps rounded corners inside the box', () => {
    const r = rect({ radius: 16 });
    const out = shapeOutline(r);
    expect(out[0]).toEqual(out[out.length - 1]);
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(r.x - 1e-9);
      expect(p.x).toBeLessThanOrEqual(r.x + r.w + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(r.y - 1e-9);
      expect(p.y).toBeLessThanOrEqual(r.y + r.h + 1e-9);
    }
    // No point sits in the very corner.
    expect(out.some((p) => p.x === r.x && p.y === r.y)).toBe(false);
  });

  it('limits the corner radius to half the shorter side', () => {
    expect(cornerRadius(rect({ radius: 500 }))).toBe(50);
    expect(cornerRadius(rect())).toBe(0);
  });
});

describe('lines', () => {
  it('stores level lines with no height and keeps them level when resized', () => {
    const l = newLine({ x: 10, y: 50 }, { x: 110, y: 50 }, style);
    expect(l.h).toBe(0);
    const bigger = resizeItem(l, 200, 40, () => 0);
    expect(bigger.h).toBe(0);
    expect(lineEnds(bigger)[1]).toEqual({ x: 210, y: 50 });
  });

  it('is hit near its path, not across its box', () => {
    const l = newLine({ x: 0, y: 0 }, { x: 100, y: 100 }, style);
    expect(pointOnItem(l, { x: 50, y: 52 })).toBe(true);
    expect(pointOnItem(l, { x: 90, y: 10 })).toBe(false);
    expect(itemAt(pageWith(l), { x: 50, y: 52 })?.id).toBe(l.id);
  });

  it('bounds include the arrowhead and ink width', () => {
    const l = newLine({ x: 0, y: 50 }, { x: 100, y: 50 }, style, 'end');
    const b = itemBounds(l);
    expect(b.minY).toBeLessThan(45); // the head's barbs spread above and below the shaft
    expect(b.maxX).toBeCloseTo(101.5);
  });

  it('turns with a rotated selection by moving its ends', () => {
    const l = newLine({ x: 0, y: 0 }, { x: 100, y: 0 }, style);
    expect(canRotate(l)).toBe(false);
    const turned = transformItem(l, rotateAbout(Math.PI / 2, { x: 0, y: 0 }));
    const [a, b] = lineEnds(turned);
    close(a.x, 0);
    close(b.x, 0);
    close(b.y, 100);
    const scaled = transformItem(l, scaleAbout(2, { x: 0, y: 0 }));
    expect(scaled.width).toBe(6);
  });
});

describe('shapes with the other tools', () => {
  it('scale outline width and corner radius, and turn, with the selection', () => {
    const r = rect({ radius: 10 });
    const out = transformItem(r, scaleAbout(2, { x: 0, y: 0 }));
    expect(out).toMatchObject({ w: 400, h: 200, width: 6, radius: 20 });
    const turned = transformItem(r, rotateAbout(0.5, { x: 200, y: 150 }));
    close(turned.rotation!, 0.5);
  });

  it('the eraser touches outlines, and fills only when filled', () => {
    const empty = rect();
    expect(touchesCircle(empty, { x: 100, y: 150 }, 4)).toBe(true);
    expect(touchesCircle(empty, { x: 200, y: 150 }, 4)).toBe(false);
    expect(touchesCircle(rect({ fill: '#eeeeee' }), { x: 200, y: 150 }, 4)).toBe(true);
    // Turned a quarter: the box's left edge is now 50 units further right.
    const turned = rect({ rotation: Math.PI / 2 });
    expect(touchesCircle(turned, { x: 100, y: 150 }, 4)).toBe(false);
    expect(touchesCircle(turned, { x: 200, y: 50 }, 4)).toBe(true);
  });

  it('count as shapes for Delete specific items and the lasso filter', () => {
    const page = pageWith(rect(), newLine({ x: 0, y: 0 }, { x: 10, y: 10 }, style), { id: 't', kind: 'tape', x: 0, y: 0, w: 10, h: 10, color: '#000000' });
    expect(countContent(page).shapes).toBe(2);
    const ops = deleteContentOps(page, 'shapes');
    const after = ops.reduce((p, op) => applyOp({ id: 'd', pages: [p] }, op).pages[0], page);
    expect(after.items.map((i) => i.kind)).toEqual(['tape']);
    expect(lassoAllowsItem(['handwriting'], rect())).toBe(true);
    expect(lassoAllowsItem(['text', 'image'], rect())).toBe(false);
  });

  it('style changes undo exactly, including an absent fill', () => {
    const page = pageWith(rect());
    const doc = { id: 'd', pages: [page] };
    const op = updateItemOp(page, 's1', { fill: '#cfe1ff', radius: 16 })!;
    const filled = applyOp(doc, op);
    expect(filled.pages[0].items[0]).toMatchObject({ fill: '#cfe1ff', radius: 16 });
    const back = applyOp(filled, inverseOp(op));
    expect(back.pages[0].items[0]).toEqual(rect());
  });

  it('transformSelectionOps produces one undoable op per shape', () => {
    const page = pageWith(rect(), newLine({ x: 0, y: 0 }, { x: 10, y: 0 }, style));
    const ops = transformSelectionOps(page, { pageId: 'p', strokeIds: [], itemIds: page.items.map((i) => i.id) }, scaleAbout(2, { x: 0, y: 0 }));
    expect(ops).toHaveLength(2);
  });

  it('copy and paste carries shapes and lines', () => {
    const json = JSON.stringify({ app: 'jnotes', v: 1, content: { strokes: [], items: [rect(), lineGeometryItem()], w: 300, h: 200 }, blobs: [] });
    expect(decodeClip(json)?.content.items.map((i) => i.kind)).toEqual(['shape', 'line']);
  });
});

function lineGeometryItem(): LineItem {
  return { id: 'l1', kind: 'line', ...lineGeometry({ x: 0, y: 0 }, { x: 20, y: 0 }), color: '#111111', width: 2 };
}
