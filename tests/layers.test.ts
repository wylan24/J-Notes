import { describe, expect, it } from 'vitest';
import type { NotebookDoc, Page, PageItem, Stroke } from '../src/core/model';
import {
  activeLayerId,
  addLayerOp,
  BASE_LAYER_ID,
  contentByLayer,
  deleteLayerOps,
  layerNames,
  layerOf,
  moveLayerOp,
  nextLayerName,
  pageLayers,
  placeOnActiveLayers,
  renameLayerOp,
  setLayerFlagOp,
  visibleContent,
  withLayers,
  workingContent,
} from '../src/core/layers';
import { applyOp, inverseOp, replay, type DocOp } from '../src/core/ops';
import { DocumentStore } from '../src/core/store';
import { fromFile, toFile } from '../src/io/notebookFile';

const stroke = (id: string, layerId?: string, extra: Partial<Stroke> = {}): Stroke => ({
  id,
  tool: 'pen',
  color: '#000',
  width: 2,
  points: [
    { x: 10, y: 10, p: 0.5 },
    { x: 50, y: 50, p: 0.5 },
  ],
  simulatePressure: false,
  ...(layerId ? { layerId } : {}),
  ...extra,
});

const sticky = (id: string, layerId?: string): PageItem => ({
  id,
  kind: 'sticky',
  x: 0,
  y: 0,
  w: 40,
  h: 40,
  text: '',
  color: '#ff0',
  collapsed: false,
  ...(layerId ? { layerId } : {}),
});

const twoLayers = (): Page => ({
  id: 'p1',
  template: 'blank',
  layers: [
    { id: BASE_LAYER_ID, name: 'Layer 1' },
    { id: 'L2', name: 'Layer 2' },
  ],
  strokes: [stroke('a'), stroke('b', 'L2'), stroke('c')],
  items: [sticky('s1', 'L2'), sticky('s2')],
});

const docOf = (...pages: Page[]): NotebookDoc => ({ id: 'd', pages });

const apply = (page: Page, ops: DocOp[]) => ops.reduce((d, op) => applyOp(d, op), docOf(page)).pages[0];

describe('layer model', () => {
  it('a page from before layers has one base layer holding everything', () => {
    const page: Page = { id: 'p', template: 'blank', strokes: [stroke('a')], items: [sticky('s')] };
    expect(pageLayers(page)).toEqual([{ id: BASE_LAYER_ID, name: 'Layer 1' }]);
    expect(layerOf(page, page.strokes[0])).toBe(BASE_LAYER_ID);
    const groups = contentByLayer(page);
    expect(groups).toHaveLength(1);
    // A single layer passes the page's own lists through untouched.
    expect(groups[0].strokes).toBe(page.strokes);
    expect(groups[0].items).toBe(page.items);
  });

  it('an old notebook file opens unchanged, with no layers field added', () => {
    const page: Page = { id: 'p', template: 'ruled', strokes: [stroke('a')], items: [] };
    const doc = docOf(page);
    const file = toFile({ id: 'd', title: 'Old', cover: '#000', template: 'ruled', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 1 }, doc);
    const back = fromFile(JSON.parse(JSON.stringify(file)));
    expect(back.doc.pages[0]).toEqual(page);
    expect('layers' in back.doc.pages[0]).toBe(false);
  });

  it('content whose layer is gone counts as on the bottom layer', () => {
    const page = { ...twoLayers(), strokes: [stroke('x', 'deleted')] };
    expect(layerOf(page, page.strokes[0])).toBe(BASE_LAYER_ID);
  });

  it('groups content by layer, bottom to top, keeping z-order within each', () => {
    const groups = contentByLayer(twoLayers());
    expect(groups.map((g) => g.layer.id)).toEqual([BASE_LAYER_ID, 'L2']);
    expect(groups[0].strokes.map((s) => s.id)).toEqual(['a', 'c']);
    expect(groups[0].items.map((it) => it.id)).toEqual(['s2']);
    expect(groups[1].strokes.map((s) => s.id)).toEqual(['b']);
    expect(groups[1].items.map((it) => it.id)).toEqual(['s1']);
  });

  it('leaves hidden layers out of painting and of what can be seen', () => {
    const page = apply(twoLayers(), [setLayerFlagOp(twoLayers(), 'L2', 'hidden', true)!]);
    expect(contentByLayer(page).map((g) => g.layer.id)).toEqual([BASE_LAYER_ID]);
    const seen = visibleContent(page);
    expect(seen.strokes.map((s) => s.id)).toEqual(['a', 'c']);
    expect(seen.items.map((it) => it.id)).toEqual(['s2']);
  });

  it('reordering layers keeps each piece of content on its layer', () => {
    const page = apply(twoLayers(), [moveLayerOp(twoLayers(), 'L2', 0)!]);
    expect(pageLayers(page).map((l) => l.id)).toEqual(['L2', BASE_LAYER_ID]);
    expect(contentByLayer(page)[0].strokes.map((s) => s.id)).toEqual(['b']);
    expect(layerOf(page, stroke('a'))).toBe(BASE_LAYER_ID);
  });
});

describe('layer ops', () => {
  it('adding a layer to an old page gives it the base layer plus the new one, and undo removes the field', () => {
    const page: Page = { id: 'p1', template: 'blank', strokes: [], items: [] };
    const { op, id } = addLayerOp(page, undefined, undefined, 'new');
    const after = apply(page, [op]);
    expect(pageLayers(after)).toEqual([
      { id: BASE_LAYER_ID, name: 'Layer 1' },
      { id, name: 'Layer 2' },
    ]);
    const undone = apply(after, [inverseOp(op)]);
    expect(undone).toEqual(page);
    expect('layers' in undone).toBe(false);
  });

  it('adds a new layer just above the given one', () => {
    const page = twoLayers();
    const { op } = addLayerOp(page, BASE_LAYER_ID, 'Ink', 'mid');
    expect(pageLayers(apply(page, [op])).map((l) => l.id)).toEqual([BASE_LAYER_ID, 'mid', 'L2']);
  });

  it('names new layers with the first free number', () => {
    expect(nextLayerName(twoLayers())).toBe('Layer 3');
    expect(nextLayerName({ layers: [{ id: 'a', name: 'Layer 3' }, { id: 'b', name: 'Other' }] })).toBe('Layer 4');
  });

  it('renames, hides and locks, each undoable', () => {
    const page = twoLayers();
    const rename = renameLayerOp(page, 'L2', '  Notes ')!;
    expect(pageLayers(apply(page, [rename]))[1].name).toBe('Notes');
    expect(renameLayerOp(page, 'L2', '   ')).toBeNull();
    const lock = setLayerFlagOp(page, 'L2', 'locked', true)!;
    const locked = apply(page, [lock]);
    expect(pageLayers(locked)[1]).toEqual({ id: 'L2', name: 'Layer 2', locked: true });
    expect(apply(locked, [inverseOp(lock)])).toEqual(page);
    const unlock = setLayerFlagOp(locked, 'L2', 'locked', false)!;
    expect(pageLayers(apply(locked, [unlock]))[1]).toEqual({ id: 'L2', name: 'Layer 2' });
  });

  it('deletes a layer with its content as one step, and undo brings both back in place', () => {
    const page = twoLayers();
    const ops = deleteLayerOps(page, 'L2');
    const after = apply(page, ops);
    expect(pageLayers(after).map((l) => l.id)).toEqual([BASE_LAYER_ID]);
    expect(after.strokes.map((s) => s.id)).toEqual(['a', 'c']);
    expect(after.items.map((it) => it.id)).toEqual(['s2']);
    const undone = apply(after, ops.map(inverseOp).reverse());
    expect(undone).toEqual(page);
  });

  it("won't delete the last layer", () => {
    expect(deleteLayerOps({ id: 'p', template: 'blank', strokes: [stroke('a')], items: [] }, BASE_LAYER_ID)).toEqual([]);
  });

  it('layer changes replay from the event log', () => {
    const page = twoLayers();
    const { op } = addLayerOp(page, undefined, 'Top', 'L3');
    const doc = replay(docOf(page), [
      { docId: 'd', seq: 1, ts: 0, op },
      { docId: 'd', seq: 2, ts: 0, op: setLayerFlagOp(apply(page, [op]), 'L3', 'hidden', true)! },
    ]);
    expect(pageLayers(doc.pages[0]).map((l) => [l.id, !!l.hidden])).toEqual([
      [BASE_LAYER_ID, false],
      ['L2', false],
      ['L3', true],
    ]);
  });
});

describe('tools and the active layer', () => {
  it('the active layer is the chosen one while it exists, otherwise the top', () => {
    expect(activeLayerId(twoLayers())).toBe('L2');
    expect(activeLayerId(twoLayers(), BASE_LAYER_ID)).toBe(BASE_LAYER_ID);
    expect(activeLayerId(twoLayers(), 'gone')).toBe('L2');
  });

  it('tools work only on the unlocked content of the active layer', () => {
    const page = { ...twoLayers(), strokes: [...twoLayers().strokes, stroke('d', 'L2', { locked: true })] };
    const base = workingContent(page, BASE_LAYER_ID);
    expect(base.strokes.map((s) => s.id)).toEqual(['a', 'c']);
    expect(base.items.map((it) => it.id)).toEqual(['s2']);
    const top = workingContent(page, 'L2');
    expect(top.strokes.map((s) => s.id)).toEqual(['b']);
    expect(top.items.map((it) => it.id)).toEqual(['s1']);
  });

  it('tools find nothing on a hidden or locked layer', () => {
    for (const flag of ['hidden', 'locked'] as const) {
      const page = apply(twoLayers(), [setLayerFlagOp(twoLayers(), 'L2', flag, true)!]);
      const work = workingContent(page, 'L2');
      expect(work.strokes).toEqual([]);
      expect(work.items).toEqual([]);
    }
  });

  it('a page with one layer is passed through as it is', () => {
    const page: Page = { id: 'p', template: 'blank', strokes: [stroke('a')], items: [] };
    expect(workingContent(page, BASE_LAYER_ID)).toBe(page);
  });

  it('puts added content on the active layer; base-layer content carries no layer id', () => {
    const doc = docOf(twoLayers());
    const ops: DocOp[] = [
      { type: 'strokes.added', pageId: 'p1', strokes: [stroke('n')] },
      { type: 'items.added', pageId: 'p1', items: [sticky('i', 'other-page-layer')] },
      { type: 'page.moved', pageId: 'p1', from: 0, to: 0 },
    ];
    const onTop = placeOnActiveLayers(doc, ops, () => undefined);
    expect((onTop[0] as { strokes: Stroke[] }).strokes[0].layerId).toBe('L2');
    expect((onTop[1] as { items: PageItem[] }).items[0].layerId).toBe('L2');
    expect(onTop[2]).toBe(ops[2]);
    const onBase = placeOnActiveLayers(doc, ops, () => BASE_LAYER_ID);
    expect('layerId' in (onBase[0] as { strokes: Stroke[] }).strokes[0]).toBe(false);
    expect('layerId' in (onBase[1] as { items: PageItem[] }).items[0]).toBe(false);
    // Nothing to change: the same op comes back.
    expect(placeOnActiveLayers(doc, [ops[0]], () => BASE_LAYER_ID)[0]).toBe(ops[0]);
  });

  it('the store adds new content to the chosen layer, and undo and redo keep it there', () => {
    const store = new DocumentStore(docOf(twoLayers()));
    store.setActiveLayer('p1', BASE_LAYER_ID);
    expect(store.activeLayer('p1')).toBe(BASE_LAYER_ID);
    store.dispatch([{ type: 'strokes.added', pageId: 'p1', strokes: [stroke('n', 'L2')] }]);
    expect(layerOf(store.doc.pages[0], store.doc.pages[0].strokes.at(-1)!)).toBe(BASE_LAYER_ID);
    store.setActiveLayer('p1', 'L2');
    store.dispatch([{ type: 'strokes.added', pageId: 'p1', strokes: [stroke('m')] }]);
    expect(store.doc.pages[0].strokes.at(-1)!.layerId).toBe('L2');
    store.undo();
    store.undo();
    store.redo();
    store.redo();
    expect(store.doc.pages[0].strokes.slice(-2).map((s) => [s.id, layerOf(store.doc.pages[0], s)])).toEqual([
      ['n', BASE_LAYER_ID],
      ['m', 'L2'],
    ]);
  });

  it('a page whose chosen layer was deleted falls back to its top layer', () => {
    const store = new DocumentStore(docOf(twoLayers()));
    store.setActiveLayer('p1', BASE_LAYER_ID);
    const { op, id } = addLayerOp(store.doc.pages[0], undefined, 'Top', 'L3');
    store.dispatch([op]);
    store.setActiveLayer('p1', id);
    store.dispatch(deleteLayerOps(store.doc.pages[0], id));
    expect(store.activeLayer('p1')).toBe('L2');
  });
});

describe('exporting chosen layers', () => {
  it('keeps only the chosen layers, shown, even if hidden on the page', () => {
    const page = apply(twoLayers(), [setLayerFlagOp(twoLayers(), 'L2', 'hidden', true)!]);
    const only = withLayers(page, (l) => l.id === 'L2');
    expect(pageLayers(only)).toEqual([{ id: 'L2', name: 'Layer 2' }]);
    expect(only.strokes.map((s) => s.id)).toEqual(['b']);
    expect(only.items.map((it) => it.id)).toEqual(['s1']);
    expect(contentByLayer(only).map((g) => g.layer.id)).toEqual(['L2']);
  });

  it('lists layer names across pages once each, for choosing in a multi-page export', () => {
    const other: Page = { id: 'p2', template: 'blank', strokes: [], items: [], layers: [{ id: 'x', name: 'Layer 1' }, { id: 'y', name: 'Answers' }] };
    expect(layerNames([twoLayers(), other])).toEqual(['Layer 1', 'Layer 2', 'Answers']);
  });
});
