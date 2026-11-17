import { describe, expect, it } from 'vitest';
import { sizeFor, type NotebookDoc, type Page, type Stroke } from '../src/core/model';
import { changeTemplateOp, clonePage, duplicatePageOp, insertPageOp, pageBlobIds } from '../src/core/pages';
import { DocumentStore } from '../src/core/store';

const stroke = (id: string, rec?: string): Stroke => ({
  id,
  tool: 'pen',
  color: '#000',
  width: 2,
  simulatePressure: false,
  points: [{ x: 1, y: 1, p: 0.5, ...(rec ? { t: 120 } : {}) }],
  ...(rec ? { rec } : {}),
});

const page = (id: string, extra: Partial<Page> = {}): Page => ({
  id,
  template: 'ruled',
  strokes: [stroke(`${id}-s`, 'rec1')],
  items: [{ id: `${id}-img`, kind: 'image', x: 0, y: 0, w: 10, h: 10, blobId: 'photo' }],
  ...extra,
});

const doc = (): NotebookDoc => ({
  id: 'doc',
  pages: [page('a', { size: sizeFor('a5', 'landscape'), paper: 'yellow', template: 'cornell', background: { kind: 'image', blobId: 'tpl' } }), page('b')],
});

describe('page actions', () => {
  it('lists the blobs a page needs', () => {
    expect(pageBlobIds(doc().pages[0]).sort()).toEqual(['photo', 'tpl']);
    expect(pageBlobIds(doc().pages[1])).toEqual(['photo']);
  });

  it('clones with fresh ids, dropping recording links only for another notebook', () => {
    const src = doc().pages[0];
    const same = clonePage(src, { keepRecordings: true });
    expect(same.id).not.toBe(src.id);
    expect(same.strokes[0].id).not.toBe(src.strokes[0].id);
    expect(same.items[0].id).not.toBe(src.items[0].id);
    expect(same.strokes[0].rec).toBe('rec1');
    expect(same).toMatchObject({ template: 'cornell', paper: 'yellow', size: src.size, background: src.background });

    const other = clonePage(src, { keepRecordings: false });
    expect('rec' in other.strokes[0]).toBe(false);
    expect('t' in other.strokes[0].points[0]).toBe(false);
    expect(other.items[0]).toMatchObject({ kind: 'image', blobId: 'photo' });
  });

  it('inserts an empty page before or after, matching the page it sits next to', () => {
    const d = doc();
    const before = insertPageOp(d, 0, 'before')!;
    const after = insertPageOp(d, 0, 'after')!;
    expect(before).toMatchObject({ type: 'page.added', index: 0 });
    expect(after).toMatchObject({ type: 'page.added', index: 1 });
    if (after.type !== 'page.added') throw new Error();
    expect(after.page).toMatchObject({ template: 'cornell', paper: 'yellow', size: { w: 794, h: 559 }, background: { kind: 'image', blobId: 'tpl' }, strokes: [], items: [] });
    expect(insertPageOp(d, 5, 'after')).toBeNull();
  });

  it('makes each action one undo step', () => {
    const store = new DocumentStore(doc());
    const original = store.doc;
    const steps = [
      () => insertPageOp(store.doc, 1, 'before'),
      () => insertPageOp(store.doc, 1, 'after'),
      () => duplicatePageOp(store.doc, 0),
      () => changeTemplateOp(store.doc.pages[0], 'music'),
      () => changeTemplateOp(store.doc.pages[1], { kind: 'image', blobId: 'new' }),
    ];
    for (const step of steps) {
      const before = store.doc;
      store.dispatch([step()!]);
      expect(store.doc).not.toEqual(before);
      store.undo();
      expect(store.doc).toEqual(before);
      store.redo();
    }
    for (let i = 0; i < steps.length; i++) store.undo();
    expect(store.doc).toEqual(original);
  });

  it('switches between built-in and image templates, removing the image when going back', () => {
    const d = doc();
    const toMusic = changeTemplateOp(d.pages[0], 'music')!;
    expect(toMusic).toMatchObject({ patch: { template: 'music', background: undefined }, previous: { template: 'cornell', background: { kind: 'image', blobId: 'tpl' } } });
    const toImage = changeTemplateOp(d.pages[1], { kind: 'image', blobId: 'x' })!;
    expect(toImage).toMatchObject({ patch: { template: 'blank', background: { kind: 'image', blobId: 'x' } } });
    expect(changeTemplateOp(d.pages[1], 'ruled')).toBeNull(); // already ruled, no image
  });

  it('duplicates a page right after itself', () => {
    const op = duplicatePageOp(doc(), 0)!;
    expect(op).toMatchObject({ type: 'page.added', index: 1 });
  });
});
