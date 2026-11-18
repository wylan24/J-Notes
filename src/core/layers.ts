// Page layers. A page's content is grouped into layers, painted bottom to top. Content records its
// layer in `layerId`; content without one (everything from before layers) is on the base layer.
// Content whose layer no longer exists counts as on the bottom layer, so nothing can go missing.
import { newId } from './ids';
import type { Layer, NotebookDoc, Page, PageItem, Stroke } from './model';
import { removeItemsOp, removeStrokesOp, updatePageOp, type DocOp } from './ops';

/** The id of the layer every page starts with. Content on it has no `layerId`. */
export const BASE_LAYER_ID = 'base';

const BASE_LAYER: Layer = { id: BASE_LAYER_ID, name: 'Layer 1' };

/** The page's layers, bottom to top; a page that never had layers has the one base layer. */
export function pageLayers(page: Pick<Page, 'layers'>): Layer[] {
  return page.layers?.length ? page.layers : [BASE_LAYER];
}

/** The id of the layer a stroke or item is on. */
export function layerOf(page: Pick<Page, 'layers'>, x: { layerId?: string }): string {
  const layers = pageLayers(page);
  const id = x.layerId ?? BASE_LAYER_ID;
  return layers.some((l) => l.id === id) ? id : layers[0].id;
}

/** A copy of a stroke or item on layer `id` (the same object when it is already there). */
export function onLayer<T extends { layerId?: string }>(x: T, id: string): T {
  if ((x.layerId ?? BASE_LAYER_ID) === id) return x;
  if (id !== BASE_LAYER_ID) return { ...x, layerId: id };
  const { layerId: _l, ...rest } = x;
  return rest as T;
}

/**
 * The layer new content goes on and tools act on: the chosen layer when the page still has it,
 * otherwise the top layer.
 */
export function activeLayerId(page: Pick<Page, 'layers'>, chosen?: string | null): string {
  const layers = pageLayers(page);
  return chosen && layers.some((l) => l.id === chosen) ? chosen : layers[layers.length - 1].id;
}

export function findLayer(page: Pick<Page, 'layers'>, id: string): Layer | undefined {
  return pageLayers(page).find((l) => l.id === id);
}

/** Whether tools may draw on or edit layer `id`: it exists, and is neither hidden nor locked. */
export function layerEditable(page: Pick<Page, 'layers'>, id: string): boolean {
  const l = findLayer(page, id);
  return !!l && !l.hidden && !l.locked;
}

export interface LayerContent {
  layer: Layer;
  strokes: Stroke[];
  items: PageItem[];
}

/**
 * The page's content grouped by layer, bottom to top, each group keeping the page's z-order.
 * `include` picks the layers (by default, the ones not hidden).
 */
export function contentByLayer(page: Page, include: (l: Layer) => boolean = (l) => !l.hidden): LayerContent[] {
  const layers = pageLayers(page);
  if (layers.length === 1) return include(layers[0]) ? [{ layer: layers[0], strokes: page.strokes, items: page.items }] : [];
  const groups = new Map(layers.map((layer) => [layer.id, { layer, strokes: [] as Stroke[], items: [] as PageItem[] }]));
  for (const s of page.strokes) groups.get(layerOf(page, s))!.strokes.push(s);
  for (const it of page.items) groups.get(layerOf(page, it))!.items.push(it);
  return [...groups.values()].filter((g) => include(g.layer));
}

/** The page with the content of hidden layers left out: what can be seen, and tapped (links, tape). */
export function visibleContent(page: Page): Page {
  const layers = pageLayers(page);
  if (!layers.some((l) => l.hidden)) return page;
  const groups = contentByLayer(page);
  const keep = new Set(groups.map((g) => g.layer.id));
  return { ...page, strokes: page.strokes.filter((s) => keep.has(layerOf(page, s))), items: page.items.filter((it) => keep.has(layerOf(page, it))) };
}

/**
 * What tools can act on: the unlocked content of layer `id`. Nothing when that layer is hidden or
 * locked.
 */
export function workingContent(page: Page, id: string): Page {
  if (!layerEditable(page, id)) return { ...page, strokes: [], items: [] };
  const single = pageLayers(page).length === 1;
  const on = (x: { layerId?: string; locked?: true }) => !x.locked && (single || layerOf(page, x) === id);
  if (page.strokes.every(on) && page.items.every(on)) return page;
  return { ...page, strokes: page.strokes.filter(on), items: page.items.filter(on) };
}

/**
 * Put the content that `ops` add on each page's active layer. The editor's tools only ever act on
 * the active layer, so whatever they add (new ink, pasted or duplicated content, the pieces left by
 * the eraser) belongs there.
 */
export function placeOnActiveLayers(doc: NotebookDoc, ops: DocOp[], active: (pageId: string) => string | undefined): DocOp[] {
  return ops.map((op) => {
    if (op.type !== 'strokes.added' && op.type !== 'items.added') return op;
    const page = doc.pages.find((p) => p.id === op.pageId);
    if (!page) return op;
    const id = activeLayerId(page, active(op.pageId));
    if (op.type === 'strokes.added') {
      const strokes = op.strokes.map((s) => onLayer(s, id));
      return strokes.every((s, i) => s === op.strokes[i]) ? op : { ...op, strokes };
    }
    const items = op.items.map((it) => onLayer(it, id));
    return items.every((it, i) => it === op.items[i]) ? op : { ...op, items };
  });
}

/** A name for a new layer: "Layer N", the first N not taken on the page. */
export function nextLayerName(page: Pick<Page, 'layers'>): string {
  const names = new Set(pageLayers(page).map((l) => l.name));
  let n = pageLayers(page).length + 1;
  while (names.has(`Layer ${n}`)) n++;
  return `Layer ${n}`;
}

/** Add an empty layer just above layer `above` (or on top). Returns the op and the new layer's id. */
export function addLayerOp(page: Page, above?: string, name = nextLayerName(page), id = newId()): { op: DocOp; id: string } {
  const layers = pageLayers(page).slice();
  const at = above ? layers.findIndex((l) => l.id === above) : -1;
  layers.splice(at < 0 ? layers.length : at + 1, 0, { id, name });
  return { op: updatePageOp(page, { layers })!, id };
}

function patchLayer(page: Page, id: string, fn: (l: Layer) => Layer): DocOp | null {
  if (!findLayer(page, id)) return null;
  return updatePageOp(page, { layers: pageLayers(page).map((l) => (l.id === id ? fn(l) : l)) });
}

export function renameLayerOp(page: Page, id: string, name: string): DocOp | null {
  const n = name.trim();
  return n ? patchLayer(page, id, (l) => ({ ...l, name: n })) : null;
}

/** Hide or show, lock or unlock a layer. */
export function setLayerFlagOp(page: Page, id: string, flag: 'hidden' | 'locked', on: boolean): DocOp | null {
  return patchLayer(page, id, (l) => {
    const { [flag]: _f, ...rest } = l;
    return on ? { ...rest, [flag]: true as const } : rest;
  });
}

/** Move layer `id` to position `to` (0 = bottom). */
export function moveLayerOp(page: Page, id: string, to: number): DocOp | null {
  const layers = pageLayers(page).slice();
  const from = layers.findIndex((l) => l.id === id);
  if (from < 0) return null;
  const [l] = layers.splice(from, 1);
  layers.splice(Math.max(0, Math.min(to, layers.length)), 0, l);
  return updatePageOp(page, { layers });
}

/** Delete a layer and everything on it, as one undo step. The last layer can't be deleted. */
export function deleteLayerOps(page: Page, id: string): DocOp[] {
  const layers = pageLayers(page);
  if (layers.length <= 1 || !layers.some((l) => l.id === id)) return [];
  const ops = [
    removeStrokesOp(page, page.strokes.filter((s) => layerOf(page, s) === id).map((s) => s.id)),
    removeItemsOp(page, page.items.filter((it) => layerOf(page, it) === id).map((it) => it.id)),
  ].filter((op): op is DocOp => !!op);
  // The layer list changes last, so undoing restores the layer before its content.
  const op = updatePageOp(page, { layers: layers.filter((l) => l.id !== id) });
  return op ? [...ops, op] : ops;
}

/** How many strokes and items are on layer `id`. */
export function layerCount(page: Page, id: string): number {
  return page.strokes.filter((s) => layerOf(page, s) === id).length + page.items.filter((it) => layerOf(page, it) === id).length;
}

/**
 * The page with only the layers `keep` picks, all shown: what an export of chosen layers draws.
 * The page keeps a single layer's worth of structure so it paints and exports like any page.
 */
export function withLayers(page: Page, keep: (l: Layer) => boolean): Page {
  const groups = contentByLayer(page, keep);
  const ids = new Set(groups.map((g) => g.layer.id));
  return {
    ...page,
    layers: pageLayers(page).flatMap((l) => (ids.has(l.id) ? [l.hidden ? { id: l.id, name: l.name, ...(l.locked ? { locked: true as const } : {}) } : l] : [])),
    strokes: page.strokes.filter((s) => ids.has(layerOf(page, s))),
    items: page.items.filter((it) => ids.has(layerOf(page, it))),
  };
}

/** The names of the layers on `pages`, in the order first met; for choosing layers to export from several pages. */
export function layerNames(pages: readonly Page[]): string[] {
  const names: string[] = [];
  for (const p of pages) for (const l of pageLayers(p)) if (!names.includes(l.name)) names.push(l.name);
  return names;
}
