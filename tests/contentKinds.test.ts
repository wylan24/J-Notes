import { describe, expect, it } from 'vitest';
import { countContent, deleteContentOps, inkKind, INK_KINDS, normalizeEraseKinds, toggleEraseKind } from '../src/core/contentKinds';
import type { NotebookDoc, Page, Stroke } from '../src/core/model';
import { DocumentStore } from '../src/core/store';

const stroke = (id: string, extra: Partial<Stroke> = {}): Stroke => ({ id, tool: 'pen', color: '#000', width: 2, simulatePressure: false, points: [{ x: 0, y: 0, p: 0.5 }], ...extra });
const page: Page = {
  id: 'p',
  template: 'blank',
  strokes: [stroke('pen1'), stroke('hl', { tool: 'highlighter' }), stroke('sq', { shape: true }), stroke('pen2', { penStyle: 'pencil' })],
  items: [
    { id: 't', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'x', font: 'sans', size: 12, color: '#000' },
    { id: 'tape', kind: 'tape', x: 0, y: 0, w: 10, h: 10, color: '#fc0' },
    { id: 'n', kind: 'sticky', x: 0, y: 0, w: 10, h: 10, text: '', color: '#ff0', collapsed: false },
  ],
};

describe('kinds of ink', () => {
  it('classes strokes as pen, highlighter or shapes', () => {
    expect(page.strokes.map(inkKind)).toEqual(['pen', 'highlighter', 'shapes', 'pen']);
  });

  it('reads the saved eraser filter, turning the old "highlighter only" into just the highlighter', () => {
    expect(normalizeEraseKinds(undefined)).toEqual(INK_KINDS);
    expect(normalizeEraseKinds(undefined, true)).toEqual(['highlighter']);
    expect(normalizeEraseKinds(['shapes', 'pen', 'nonsense'])).toEqual(['pen', 'shapes']);
    expect(normalizeEraseKinds([])).toEqual(INK_KINDS);
  });

  it('turns kinds on and off, never leaving the eraser with nothing to erase', () => {
    expect(toggleEraseKind(['pen', 'highlighter'], 'pen')).toEqual(['highlighter']);
    expect(toggleEraseKind(['highlighter'], 'highlighter')).toEqual(['highlighter']);
    expect(toggleEraseKind(['shapes'], 'pen')).toEqual(['pen', 'shapes']);
  });
});

describe('delete specific items', () => {
  it('counts what is on a page', () => {
    expect(countContent(page)).toMatchObject({ pen: 2, highlighter: 1, shapes: 1, text: 1, tape: 1, sticky: 1, image: 0, link: 0 });
  });

  it('deletes one kind, leaving the rest, as one undo step', () => {
    const doc: NotebookDoc = { id: 'd', pages: [page] };
    const store = new DocumentStore(doc);
    store.dispatch(deleteContentOps(store.doc.pages[0], 'highlighter'));
    expect(store.doc.pages[0].strokes.map((s) => s.id)).toEqual(['pen1', 'sq', 'pen2']);
    store.dispatch(deleteContentOps(store.doc.pages[0], 'tape'));
    expect(store.doc.pages[0].items.map((i) => i.id)).toEqual(['t', 'n']);
    store.undo();
    store.undo();
    expect(store.doc).toEqual(doc);
  });

  it('deletes everything on the page, and nothing when there is none of a kind', () => {
    const store = new DocumentStore({ id: 'd', pages: [page] });
    expect(deleteContentOps(page, 'image')).toEqual([]);
    store.dispatch(deleteContentOps(store.doc.pages[0], 'all'));
    expect(store.doc.pages[0].strokes).toEqual([]);
    expect(store.doc.pages[0].items).toEqual([]);
    store.undo();
    expect(store.doc.pages[0]).toEqual(page);
  });
});
