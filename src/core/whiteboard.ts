// Whiteboards: a document with one very large page. Rendering tiles that page (see PageView), so
// only what is on screen is painted; these helpers find the content and frame it.
import { strokeBounds, type Bounds } from './geometry';
import { itemBounds } from './items';
import { blankPage, type Page, type PageSize, type Template } from './model';
import { transformItem, transformStroke, translate } from './transform';

/** A whiteboard's page: large enough that it feels endless at any zoom the app allows. */
export const WHITEBOARD_SIZE: PageSize = { w: 16000, h: 16000 };
/** Templates that make sense without page edges. */
export const WHITEBOARD_TEMPLATES: readonly Template[] = ['blank', 'dotted', 'grid'];

export function whiteboardPage(id: string, template: Template = 'dotted'): Page {
  return blankPage(id, { template, size: WHITEBOARD_SIZE, paper: 'white' });
}

/** Pages this large are drawn in tiles rather than as one canvas (16 megapixels at 1×). */
export const isLargePage = (size: PageSize): boolean => size.w * size.h > 4096 * 4096;

/** The box around everything on the page, or null when it is empty. */
export function contentBounds(page: Pick<Page, 'strokes' | 'items'>): Bounds | null {
  const all = [...page.strokes.map(strokeBounds), ...page.items.map(itemBounds)];
  if (!all.length) return null;
  return all.reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));
}

/**
 * The zoom and centre that fit `b` (plus `pad` page units around it) in a viewport of the given
 * CSS size, within the zoom limits. An empty board frames the middle of the page at 1×.
 */
export function fitView(b: Bounds | null, size: PageSize, viewport: { w: number; h: number }, limits: { min: number; max: number }, pad = 48): { zoom: number; cx: number; cy: number } {
  if (!b) return { zoom: Math.max(limits.min, Math.min(limits.max, 1)), cx: size.w / 2, cy: size.h / 2 };
  const w = b.maxX - b.minX + 2 * pad, h = b.maxY - b.minY + 2 * pad;
  const zoom = Math.max(limits.min, Math.min(limits.max, 1, viewport.w / w, viewport.h / h));
  return { zoom, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
}

/**
 * The board's content as a page of its own, moved to the top-left and sized to fit with `pad`
 * around it, for exporting a PDF or PNG of just what is drawn. An empty board gives a small blank page.
 */
export function cropToContent(page: Page, pad = 32): Page {
  const b = contentBounds(page);
  if (!b) return { ...page, size: { w: 800, h: 600 } };
  const m = translate(pad - b.minX, pad - b.minY);
  return {
    ...page,
    size: { w: Math.ceil(b.maxX - b.minX + 2 * pad), h: Math.ceil(b.maxY - b.minY + 2 * pad) },
    strokes: page.strokes.map((s) => transformStroke(s, m)),
    items: page.items.map((it) => transformItem(it, m)),
  };
}
