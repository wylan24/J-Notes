import { describe, expect, it } from 'vitest';
import { sizeFor, type NotebookDoc, type Page, type Stroke } from '../src/core/model';
import { bookmarkedIndices, changeTemplateOp, clonePage, dropTarget, isBookmarked, toggleBookmarkOp, duplicatePageOp, insertPageOp, pageBlobIds, stackLayout, visibleRange } from '../src/core/pages';
import { applyOp, inverseOp, movePageOp, replay } from '../src/core/ops';
import { fromFile, toFile } from '../src/io/notebookFile';
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

describe('thumbnail sidebar layout', () => {
  // Three pages: tall, short (landscape), tall.
  const heights = [100, 50, 100];
  const { tops, height } = stackLayout(heights, 10);

  it('stacks thumbnails of mixed heights', () => {
    expect(tops).toEqual([0, 110, 170]);
    expect(height).toBe(270);
    expect(stackLayout([], 10)).toEqual({ tops: [], height: 0 });
  });

  it('finds only the thumbnails in view', () => {
    expect(visibleRange(tops, heights, 0, 50)).toEqual([0, 1]);
    expect(visibleRange(tops, heights, 105, 120)).toEqual([1, 2]);
    expect(visibleRange(tops, heights, 150, 1000)).toEqual([1, 3]);
    expect(visibleRange(tops, heights, 2000, 3000)).toEqual([3, 3]);
  });

  it('keeps the visible range small in a 300-page notebook', () => {
    const many = Array.from({ length: 300 }, (_, i) => (i % 7 === 3 ? 80 : 180));
    const layout = stackLayout(many, 12);
    const [start, end] = visibleRange(layout.tops, many, 20000, 20900);
    expect(end - start).toBeLessThanOrEqual(7);
    expect(layout.tops[start] + many[start]).toBeGreaterThanOrEqual(20000);
    expect(layout.tops[end - 1]).toBeLessThanOrEqual(20900);
  });

  it('turns a drop position into the gap shown and the move target', () => {
    // Dragging page 0 down past the middle of page 1 puts it after page 1.
    expect(dropTarget(tops, heights, 140, 0)).toEqual({ slot: 2, to: 1 });
    // Above everything / below everything.
    expect(dropTarget(tops, heights, -20, 2)).toEqual({ slot: 0, to: 0 });
    expect(dropTarget(tops, heights, 500, 0)).toEqual({ slot: 3, to: 2 });
    // Dropping onto its own place is no move.
    expect(dropTarget(tops, heights, 40, 0)).toEqual({ slot: 0, to: 0 });
  });

  it('reorders by drag as one undoable step', () => {
    const d: NotebookDoc = { id: 'd', pages: ['a', 'b', 'c'].map((id) => ({ id, template: 'blank', strokes: [], items: [] })) };
    const store = new DocumentStore(d);
    const { to } = dropTarget(tops, heights, 500, 0);
    store.dispatch([movePageOp(store.doc, 'a', to)!]);
    expect(store.doc.pages.map((p) => p.id)).toEqual(['b', 'c', 'a']);
    store.undo();
    expect(store.doc).toEqual(d);
    expect(applyOp(d, movePageOp(d, 'c', dropTarget(tops, heights, -1, 2).to)!).pages.map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('bookmarks', () => {
  const three = (): NotebookDoc => ({ id: 'd', pages: ['a', 'b', 'c'].map((id) => ({ id, template: 'blank', strokes: [], items: [] })) });

  it('toggles a bookmark with one undoable doc.updated op', () => {
    const d = three();
    const op = toggleBookmarkOp(d, 'c')!;
    expect(op).toEqual({ type: 'doc.updated', patch: { bookmarks: ['c'] }, previous: { bookmarks: undefined } });
    const marked = applyOp(d, op);
    expect(isBookmarked(marked, 'c')).toBe(true);
    expect(applyOp(marked, inverseOp(op))).toEqual(d); // `bookmarks` absent again, not []

    const unmarked = applyOp(marked, toggleBookmarkOp(marked, 'c')!);
    expect('bookmarks' in unmarked).toBe(false);
  });

  it('lists bookmarked pages in page order and follows moves', () => {
    let d = three();
    for (const id of ['c', 'a']) d = applyOp(d, toggleBookmarkOp(d, id)!);
    expect(bookmarkedIndices(d)).toEqual([0, 2]);
    d = applyOp(d, movePageOp(d, 'c', 1)!);
    expect(bookmarkedIndices(d)).toEqual([0, 1]);
    // A deleted page's bookmark is skipped, and comes back if the deletion is undone.
    const removed = applyOp(d, { type: 'page.removed', page: d.pages[0], index: 0 });
    expect(bookmarkedIndices(removed)).toEqual([0]);
  });

  it('replays from the log', () => {
    const d = three();
    const op = toggleBookmarkOp(d, 'b')!;
    expect(replay(d, [{ docId: 'd', seq: 1, ts: 0, op }]).bookmarks).toEqual(['b']);
  });

  it('survives export and import', () => {
    const d = applyOp(three(), toggleBookmarkOp(three(), 'b')!);
    const meta = { id: 'd', title: 'T', cover: '#000', template: 'blank' as const, createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 3 };
    const back = fromFile(JSON.parse(JSON.stringify(toFile(meta, d))));
    expect(back.doc.bookmarks).toEqual(['b']);
    expect(bookmarkedIndices(back.doc)).toEqual([1]);
    // Files without bookmarks import without the field.
    expect('bookmarks' in fromFile(JSON.parse(JSON.stringify(toFile(meta, three())))).doc).toBe(false);
  });
});
