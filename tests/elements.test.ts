import { describe, expect, it } from 'vitest';
import type { NotebookDoc, Page } from '../src/core/model';
import { PAGE_W } from '../src/core/model';
import { defaultElementName, elementBlobIds, makeElementContent, placeElement } from '../src/core/elements';
import { DocumentStore } from '../src/core/store';
import { strokeBounds } from '../src/core/geometry';

const page = (): Page => ({
  id: 'p',
  template: 'blank',
  strokes: [
    { id: 'a', tool: 'pen', color: '#000', width: 2, simulatePressure: false, points: [{ x: 100, y: 200, p: 0.5, t: 40 }, { x: 150, y: 260, p: 0.5, t: 80 }] },
    { id: 'other', tool: 'pen', color: '#000', width: 2, simulatePressure: false, points: [{ x: 0, y: 0, p: 0.5 }, { x: 1, y: 1, p: 0.5 }] },
  ],
  items: [
    { id: 'img', kind: 'image', x: 160, y: 210, w: 40, h: 30, blobId: 'photo' },
    { id: 'txt', kind: 'text', x: 90, y: 190, w: 60, h: 20, text: 'Mitochondria is the powerhouse', font: 'sans', size: 14, color: '#000' },
  ],
});
const sel = { pageId: 'p', strokeIds: ['a'], itemIds: ['img', 'txt'] };

describe('makeElementContent', () => {
  it('moves the selection to the origin and drops audio timestamps', () => {
    const c = makeElementContent(page(), sel)!;
    expect(c.strokes).toHaveLength(1);
    expect(c.items).toHaveLength(2);
    // Bounds start at the text box's corner (90, 190), less nothing: items have no padding.
    expect(c.items.find((i) => i.id === 'txt')).toMatchObject({ x: 0, y: 0 });
    expect(c.strokes[0].points[0]).toEqual({ x: 10, y: 10, p: 0.5 });
    expect(c.w).toBeCloseTo(200 - 90);
    expect(c.h).toBeCloseTo(strokeBounds(page().strokes[0]).maxY - 190);
  });

  it('returns null for an empty selection', () => {
    expect(makeElementContent(page(), { pageId: 'p', strokeIds: [], itemIds: [] })).toBeNull();
  });

  it('lists the photos it needs', () => {
    expect(elementBlobIds(makeElementContent(page(), sel)!)).toEqual(['photo']);
  });

  it('names an element after its text, or falls back to a number', () => {
    expect(defaultElementName(makeElementContent(page(), sel)!, 3)).toBe('Mitochondria is the…');
    expect(defaultElementName(makeElementContent(page(), { ...sel, itemIds: [] })!, 3)).toBe('Element 4');
  });
});

describe('placeElement', () => {
  const content = () => makeElementContent(page(), sel)!;

  it('centres a copy on the drop point with fresh ids, in one undoable step', () => {
    const doc: NotebookDoc = { id: 'd', pages: [{ id: 'q', template: 'blank', strokes: [], items: [] }] };
    const store = new DocumentStore(doc);
    const placed = placeElement(content(), 'q', { x: 400, y: 500 });
    store.dispatch(placed.ops);
    const q = store.doc.pages[0];
    expect(q.strokes).toHaveLength(1);
    expect(q.items).toHaveLength(2);
    expect(q.strokes[0].id).not.toBe('a');
    expect(q.items.map((i) => i.id)).not.toContain('img');
    expect(placed.selection).toEqual({ pageId: 'q', strokeIds: [q.strokes[0].id], itemIds: q.items.map((i) => i.id) });
    const txt = q.items.find((i) => i.kind === 'text')!;
    expect(txt.x).toBeCloseTo(400 - content().w / 2);
    store.undo();
    expect(store.doc).toEqual(doc);
  });

  it('scales an element down to fit the page, and keeps it on the page', () => {
    const big = { ...content(), w: PAGE_W * 2, h: 100 };
    const placed = placeElement(big, 'q', { x: 10, y: 10 });
    const items = placed.ops.flatMap((o) => (o.type === 'items.added' ? o.items : []));
    for (const it of items) expect(it.x).toBeGreaterThanOrEqual(0);
    const strokes = placed.ops.flatMap((o) => (o.type === 'strokes.added' ? o.strokes : []));
    expect(strokes[0].width).toBeLessThan(2); // the nib scales with the content
  });

  it('placing twice gives two independent copies', () => {
    const a = placeElement(content(), 'q', { x: 300, y: 300 });
    const b = placeElement(content(), 'q', { x: 300, y: 300 });
    expect(a.selection.itemIds).not.toEqual(b.selection.itemIds);
  });
});
