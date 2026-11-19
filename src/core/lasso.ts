// Lasso options: freehand or rectangle, and a filter for what it picks up.
import type { Page, PageItem } from './model';
import type { Vec } from './geometry';
import { selectInLasso, type Selection } from './selection';

/** 'screenshot' drags a rectangle to capture as a picture rather than select. */
export type LassoShape = 'freehand' | 'rect' | 'screenshot';

/** What the lasso filter can limit a selection to. Text covers text boxes and sticky notes; handwriting covers shapes and lines. */
export type LassoKind = 'handwriting' | 'image' | 'text';
export const LASSO_KINDS: readonly LassoKind[] = ['handwriting', 'image', 'text'];
export const LASSO_LABELS: Record<LassoKind, string> = { handwriting: 'Handwriting', image: 'Images', text: 'Text' };

export interface LassoSettings {
  shape: LassoShape;
  /** At least one kind. */
  kinds: LassoKind[];
}

export const DEFAULT_LASSO: LassoSettings = { shape: 'freehand', kinds: [...LASSO_KINDS] };

export function normalizeLassoSettings(raw: unknown): LassoSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof LassoSettings, unknown>>;
  // Screenshot mode is for the moment; the lasso comes back as a freehand lasso.
  const shape: LassoShape = r.shape === 'rect' ? 'rect' : 'freehand';
  const kinds = Array.isArray(r.kinds) ? LASSO_KINDS.filter((k) => (r.kinds as unknown[]).includes(k)) : [];
  return { shape, kinds: kinds.length ? kinds : [...LASSO_KINDS] };
}

/** Turn one kind on or off; the last one left can't be turned off (a lasso that selects nothing). */
export function toggleLassoKind(kinds: readonly LassoKind[], k: LassoKind): LassoKind[] {
  if (!kinds.includes(k)) return LASSO_KINDS.filter((x) => x === k || kinds.includes(x));
  return kinds.length > 1 ? kinds.filter((x) => x !== k) : [...kinds];
}

/**
 * Whether the filter lets an item through. Tape and links belong to no kind, so they are only
 * picked up when the filter is off (every kind on).
 */
export function lassoAllowsItem(kinds: readonly LassoKind[], it: PageItem): boolean {
  if (it.kind === 'image') return kinds.includes('image');
  if (it.kind === 'text' || it.kind === 'sticky') return kinds.includes('text');
  if (it.kind === 'shape' || it.kind === 'line') return kinds.includes('handwriting');
  return LASSO_KINDS.every((k) => kinds.includes(k));
}

/** The rectangle spanned by two corners, as a closed polygon (clockwise from the top left). */
export function rectPolygon(a: Vec, b: Vec): Vec[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/** The area the lasso encloses, from the pointer path: the path itself, or (rectangle and screenshot) the rectangle from its first to its last point. */
export function lassoPolygon(shape: LassoShape, path: readonly Vec[]): Vec[] {
  if (shape === 'freehand' || path.length < 2) return [...path];
  return rectPolygon(path[0], path[path.length - 1]);
}

/** Select what the lasso encloses that the filter allows, or null if that is nothing. */
export function selectWithLasso(page: Page, poly: Vec[], kinds: readonly LassoKind[]): Selection | null {
  const filtered: Page = {
    ...page,
    strokes: kinds.includes('handwriting') ? page.strokes : [],
    items: page.items.filter((it) => lassoAllowsItem(kinds, it)),
  };
  return selectInLasso(filtered, poly);
}
