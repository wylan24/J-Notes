import { describe, expect, it } from 'vitest';
import {
  blankPage,
  normalizePage,
  orientationOf,
  PAGE_H,
  PAGE_W,
  pageIndexAt,
  pageOffsets,
  pagePaper,
  pageSize,
  pageTops,
  sizeFor,
  type NotebookDoc,
  type NotebookMeta,
  type Page,
  type Stroke,
} from '../src/core/model';
import { fromFile, toFile } from '../src/io/notebookFile';
import { paintPage, PAPER_STYLES } from '../src/render/page';
import { newSticky } from '../src/core/items';
import { clampTarget } from '../src/core/zoomWindow';
import { applyOp, inverseOp, movePageOp, removeStrokesOp, replay, updatePageOp, type DocOp } from '../src/core/ops';
import { DocumentStore } from '../src/core/store';
import { strokeHitsCircle, strokesInLasso } from '../src/core/geometry';
import { detectLine } from '../src/core/shapes';

const stroke = (id: string, pts: [number, number][], width = 2): Stroke => ({
  id,
  tool: 'pen',
  color: '#000',
  width,
  simulatePressure: true,
  points: pts.map(([x, y]) => ({ x, y, p: 0.5 })),
});

const baseDoc = (): NotebookDoc => ({
  id: 'doc',
  pages: [{ id: 'p1', template: 'blank', strokes: [stroke('a', [[0, 0], [10, 0]]), stroke('b', [[0, 20], [10, 20]]), stroke('c', [[0, 40], [10, 40]])], items: [] }],
});

describe('ops', () => {
  it('every op is undone exactly by its inverse', () => {
    const doc = baseDoc();
    const page = doc.pages[0];
    const ops: DocOp[] = [
      { type: 'page.added', index: 1, page: { id: 'p2', template: 'grid', strokes: [], items: [] } },
      { type: 'strokes.added', pageId: 'p1', strokes: [stroke('d', [[5, 5], [6, 6]])] },
      removeStrokesOp(page, ['a', 'c'])!,
      { type: 'strokes.translated', pageId: 'p1', ids: ['b'], dx: 5, dy: -3 },
      { type: 'strokes.recolored', pageId: 'p1', ids: ['a', 'b'], colors: ['#f00', '#0f0'], previous: ['#000', '#000'] },
      { type: 'strokes.locked', pageId: 'p1', ids: ['a', 'c'], locked: true },
      { type: 'strokes.reordered', pageId: 'p1', order: ['c', 'a', 'b'], previous: ['a', 'b', 'c'] },
    ];
    for (const op of ops) {
      const after = applyOp(doc, op);
      expect(after).not.toEqual(doc);
      expect(applyOp(after, inverseOp(op))).toEqual(doc);
    }
  });

  it('restores erased strokes at their original z-order', () => {
    const doc = baseDoc();
    const op = removeStrokesOp(doc.pages[0], ['b'])!;
    const restored = applyOp(applyOp(doc, op), inverseOp(op));
    expect(restored.pages[0].strokes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input document', () => {
    const doc = baseDoc();
    const frozen = JSON.stringify(doc);
    applyOp(doc, { type: 'strokes.translated', pageId: 'p1', ids: ['a'], dx: 1, dy: 1 });
    expect(JSON.stringify(doc)).toBe(frozen);
  });

  it('ignores ops for missing pages', () => {
    const doc = baseDoc();
    expect(applyOp(doc, { type: 'strokes.added', pageId: 'nope', strokes: [] })).toBe(doc);
  });
});

describe('DocumentStore', () => {
  it('undo/redo round-trips and emits sequenced events', () => {
    const store = new DocumentStore(baseDoc(), 7);
    const events: number[] = [];
    store.onEvents((e) => events.push(...e.map((x) => x.seq)));
    store.dispatch([{ type: 'strokes.added', pageId: 'p1', strokes: [stroke('z', [[1, 1], [2, 2]])] }]);
    expect(store.doc.pages[0].strokes).toHaveLength(4);
    store.undo();
    expect(store.doc).toEqual(baseDoc());
    expect(store.canRedo).toBe(true);
    store.redo();
    expect(store.doc.pages[0].strokes.at(-1)!.id).toBe('z');
    expect(events).toEqual([8, 9, 10]);
  });

  it('a new action clears the redo stack', () => {
    const store = new DocumentStore(baseDoc());
    store.dispatch([{ type: 'strokes.translated', pageId: 'p1', ids: ['a'], dx: 1, dy: 0 }]);
    store.undo();
    store.dispatch([{ type: 'strokes.translated', pageId: 'p1', ids: ['b'], dx: 1, dy: 0 }]);
    expect(store.canRedo).toBe(false);
  });

  it('replaying the emitted log reproduces the in-memory doc', () => {
    const initial = baseDoc();
    const store = new DocumentStore(initial);
    const log: Parameters<typeof replay>[1] = [];
    store.onEvents((e) => log.push(...e));
    store.dispatch([removeStrokesOp(store.doc.pages[0], ['a'])!]);
    store.dispatch([{ type: 'page.added', index: 1, page: { id: 'p2', template: 'ruled', strokes: [], items: [] } }]);
    store.undo();
    store.dispatch([{ type: 'strokes.translated', pageId: 'p1', ids: ['c'], dx: 3, dy: 3 }]);
    expect(replay(initial, log)).toEqual(store.doc);
  });
});

describe('geometry', () => {
  it('eraser hits account for stroke width', () => {
    const s = stroke('a', [[0, 0], [100, 0]], 10);
    expect(strokeHitsCircle(s, 50, 12, 8)).toBe(true); // 12 <= 8 + 5
    expect(strokeHitsCircle(s, 50, 14, 8)).toBe(false);
    expect(strokeHitsCircle(s, 200, 0, 8)).toBe(false);
  });

  it('lasso selects strokes mostly inside the polygon', () => {
    const inside = stroke('in', [[10, 10], [20, 20], [30, 30]]);
    const outside = stroke('out', [[200, 200], [210, 210]]);
    const straddle = stroke('half', [[90, 50], [95, 50], [150, 50], [160, 50], [170, 50]]);
    const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(strokesInLasso([inside, outside, straddle], square)).toEqual(['in']);
  });

  it('detects near-straight strokes and rejects curves', () => {
    const wobbly = Array.from({ length: 30 }, (_, i) => ({ x: i * 5, y: Math.sin(i) * 2, p: 0.5 }));
    expect(detectLine(wobbly)).not.toBeNull();
    const arc = Array.from({ length: 30 }, (_, i) => ({ x: Math.cos(i / 10) * 100, y: Math.sin(i / 10) * 100, p: 0.5 }));
    expect(detectLine(arc)).toBeNull();
  });
});

describe('page size and paper', () => {
  const v2Page = { id: 'p', template: 'ruled', strokes: [], items: [] } as Page;
  const a5Yellow: Page = { id: 'q', template: 'ruled', strokes: [], items: [], size: sizeFor('a5', 'landscape'), paper: 'yellow' };

  it('reads pages saved before sizes existed as A4 portrait on white', () => {
    expect(pageSize(v2Page)).toEqual({ w: PAGE_W, h: PAGE_H });
    expect(pagePaper(v2Page)).toBe('white');
    expect(normalizePage(v2Page)).toBe(v2Page); // left untouched, so old files round-trip unchanged
  });

  it('builds landscape sizes by swapping the sides', () => {
    expect(sizeFor('a5', 'portrait')).toEqual({ w: 559, h: 794 });
    expect(pageSize(a5Yellow)).toEqual({ w: 794, h: 559 });
    expect(orientationOf(pageSize(a5Yellow))).toBe('landscape');
    expect(pagePaper(a5Yellow)).toBe('yellow');
  });

  it('opens a version-2 file unchanged and keeps sizes through export and import', () => {
    const v2 = { format: 'jnotes-notebook', version: 2, title: 'Old', cover: '#000', template: 'ruled', doc: { id: 'x', pages: [v2Page] } };
    expect(fromFile(JSON.parse(JSON.stringify(v2))).doc.pages).toEqual([v2Page]);
    const meta: NotebookMeta = { id: 'x', title: 'T', cover: '#000', template: 'ruled', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 1 };
    const round = fromFile(JSON.parse(JSON.stringify(toFile(meta, { id: 'x', pages: [a5Yellow] }))));
    expect(round.doc.pages).toEqual([a5Yellow]);
  });

  it('paints an A5 landscape yellow page at its own size', () => {
    const fills: string[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : () => {}),
      set: (t, k, v) => {
        if (k === 'fillStyle') fills.push(v as string);
        t[k] = v;
        return true;
      },
    });
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    paintPage(canvas, a5Yellow, 2, 1); // the PNG export's scale
    expect([canvas.width, canvas.height]).toEqual([794 * 2, 559 * 2]);
    expect(fills[0]).toBe(PAPER_STYLES.yellow.fill);
  });

  it('stacks pages of different heights for scrolling', () => {
    const pages = [{}, { size: sizeFor('a5', 'landscape') }, {}];
    const { tops, height } = pageTops(pages, 0.5, 10);
    expect(tops).toEqual([0, 1123 / 2 + 10, 1123 / 2 + 10 + 559 / 2 + 10]);
    expect(height).toBe(1123 + 559 / 2 + 20);
    expect(pageIndexAt(tops, 0)).toBe(0);
    expect(pageIndexAt(tops, tops[1] - 1)).toBe(0);
    expect(pageIndexAt(tops, tops[1])).toBe(1);
    expect(pageIndexAt(tops, 1e9)).toBe(2);
  });

  it('keeps new items and the zoom window on a smaller page', () => {
    const size = sizeFor('a5', 'landscape');
    const s = newSticky({ x: 2000, y: 2000 }, '#ff0', size);
    expect([s.x + s.w, s.y + s.h]).toEqual([size.w, size.h]);
    const t = clampTarget({ pageId: 'q', x: 5000, y: 5000, w: 280, h: 80 }, size);
    expect(t.x + t.w).toBe(size.w);
    expect(t.y + t.h).toBe(size.h);
  });
});

describe('new notebook setup', () => {
  it('builds the first page from the chosen size, orientation, paper and template', () => {
    expect(blankPage('p', { template: 'grid', size: sizeFor('letter', 'landscape'), paper: 'dark' })).toEqual({
      id: 'p',
      template: 'grid',
      strokes: [],
      items: [],
      size: { w: 1056, h: 816 },
      paper: 'dark',
    });
  });

  it('leaves default size and paper unstored, like pages saved before they existed', () => {
    expect(blankPage('p', { template: 'ruled', size: sizeFor('a4', 'portrait'), paper: 'white' })).toEqual({ id: 'p', template: 'ruled', strokes: [], items: [] });
  });

  it('gives pages added later the setup of the page they follow', () => {
    const first = blankPage('p1', { template: 'dotted', size: sizeFor('a5', 'landscape'), paper: 'yellow' });
    const next = blankPage('p2', { template: 'dotted', size: pageSize(first), paper: pagePaper(first) });
    expect(next).toEqual({ ...first, id: 'p2' });
  });
});

describe('page moves and updates', () => {
  const blank = (id: string): Page => ({ id, template: 'blank', strokes: [], items: [] });
  const fourPages = (): NotebookDoc => ({ id: 'doc', pages: ['a', 'b', 'c', 'd'].map(blank) });
  const order = (d: NotebookDoc) => d.pages.map((p) => p.id).join('');

  it('moves a page forward and back, and its inverse puts it back', () => {
    const doc = fourPages();
    for (const [id, to, expected] of [['a', 2, 'bcad'], ['d', 0, 'dabc'], ['b', 99, 'acdb'], ['c', 1, 'acbd']] as const) {
      const op = movePageOp(doc, id, to)!;
      const moved = applyOp(doc, op);
      expect(order(moved)).toBe(expected);
      expect(applyOp(moved, inverseOp(op))).toEqual(doc);
    }
    expect(movePageOp(doc, 'b', 1)).toBeNull(); // already there
    expect(movePageOp(doc, 'zz', 0)).toBeNull();
  });

  it('records the old value of each changed field, including absent ones', () => {
    const page = blank('a');
    const op = updatePageOp(page, { template: 'cornell', size: sizeFor('a5', 'landscape'), paper: 'white' })!;
    // paper 'white' differs from absent, so it is recorded; previous holds undefined for absent fields.
    expect(op).toEqual({
      type: 'page.updated',
      pageId: 'a',
      patch: { template: 'cornell', size: { w: 794, h: 559 }, paper: 'white' },
      previous: { template: 'blank', size: undefined, paper: undefined },
    });
    expect(updatePageOp(page, { template: 'blank' })).toBeNull();
  });

  it('undoes and redoes moves and updates through the store, restoring absent fields exactly', () => {
    const store = new DocumentStore(fourPages());
    const original = store.doc;
    store.dispatch([movePageOp(store.doc, 'a', 3)!]);
    store.dispatch([updatePageOp(store.doc.pages[0], { paper: 'dark', background: { kind: 'image', blobId: 'img' } })!]);
    const after = store.doc;
    expect(order(after)).toBe('bcda');
    expect(after.pages[0]).toMatchObject({ id: 'b', paper: 'dark', background: { kind: 'image', blobId: 'img' } });

    store.undo();
    expect(store.doc.pages[0]).toEqual(blank('b'));
    expect('paper' in store.doc.pages[0]).toBe(false);
    store.undo();
    expect(store.doc).toEqual(original);
    store.redo();
    store.redo();
    expect(store.doc).toEqual(after);
  });

  it('replays logged moves and updates to the same document', () => {
    const doc = fourPages();
    const ops = [movePageOp(doc, 'c', 0)!];
    const mid = applyOp(doc, ops[0]);
    ops.push(updatePageOp(mid.pages[0], { template: 'music' })!);
    const live = ops.reduce(applyOp, doc);
    const events = ops.map((op, i) => ({ docId: 'doc', seq: i + 1, ts: 0, op }));
    expect(replay(doc, events)).toEqual(live);
    expect(order(live)).toBe('cabd');
    expect(live.pages[0].template).toBe('music');
  });
});

describe('page layout direction', () => {
  // Portrait A4, landscape A5, portrait A4.
  const pages = [{}, { size: sizeFor('a5', 'landscape') }, {}];

  it('lays pages side by side by their widths', () => {
    const { starts, length } = pageOffsets(pages, 1, 10, 'horizontal');
    expect(starts).toEqual([0, 794 + 10, 794 + 10 + 794 + 10]);
    expect(length).toBe(794 * 3 + 20);
    expect(pageIndexAt(starts, 900)).toBe(1);
  });

  it('stacks pages by their heights, as before', () => {
    expect(pageOffsets(pages, 0.5, 10).starts).toEqual(pageTops(pages, 0.5, 10).tops);
  });
});
