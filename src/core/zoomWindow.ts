// The zoom window: a magnified panel showing a target box on a page. Writing in the panel lands
// in the box, and the box moves along the line as you write, like a typewriter carriage.
import { DEFAULT_PAGE_SIZE, type PageSize, type Template } from './model';
import type { Vec } from './geometry';

/** Panel width ÷ height; the target box has the same shape. */
export const ZOOM_ASPECT = 3.5;
export const MIN_TARGET_W = 120;
export const MAX_TARGET_W = 520;
/** Lifting the pen beyond this fraction of the panel's width moves the box on. */
const ADVANCE_AT = 0.75;
/** How far the box moves along the line each time, as a fraction of its width. */
const STEP = 0.5;

export interface ZoomTarget {
  pageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a new line starts: just right of the margin rule on ruled paper. */
export function leftMargin(template: Template): number {
  return template === 'ruled' ? 104 : 32;
}

// Every function that moves or sizes the box takes the size of the page it is on, so the box stays on it.

export function clampTarget(t: ZoomTarget, size: PageSize = DEFAULT_PAGE_SIZE): ZoomTarget {
  const w = Math.min(MAX_TARGET_W, size.w, Math.max(MIN_TARGET_W, t.w));
  const h = w / ZOOM_ASPECT;
  return { ...t, w, h, x: Math.min(Math.max(0, t.x), size.w - w), y: Math.min(Math.max(0, t.y), size.h - h) };
}

export function defaultTarget(pageId: string, template: Template, w = 280, size: PageSize = DEFAULT_PAGE_SIZE): ZoomTarget {
  return clampTarget({ pageId, x: leftMargin(template), y: template === 'ruled' ? 104 : 80, w, h: w / ZOOM_ASPECT }, size);
}

/** Resize about the box's left-middle, so the current line stays put. */
export function resizeTarget(t: ZoomTarget, w: number, size: PageSize = DEFAULT_PAGE_SIZE): ZoomTarget {
  const next = clampTarget({ ...t, w }, size);
  return clampTarget({ ...next, y: t.y + t.h / 2 - next.h / 2 }, size);
}

export function panelToPage(pt: Vec, t: ZoomTarget, panelW: number): Vec {
  const k = t.w / panelW;
  return { x: t.x + pt.x * k, y: t.y + pt.y * k };
}

export function shouldAdvance(maxPanelX: number, panelW: number): boolean {
  return maxPanelX > panelW * ADVANCE_AT;
}

/** Line spacing of the paper, in page units (matches the template painter); null for unlined paper. */
const PITCH: Partial<Record<Template, number>> = { ruled: 32, grid: 28 };

/** Down one box height, rounded to whole lines on ruled and grid paper so the box stays on the lines. */
export function newLine(t: ZoomTarget, template: Template, size: PageSize = DEFAULT_PAGE_SIZE): ZoomTarget {
  const pitch = PITCH[template];
  const step = pitch ? Math.max(pitch, Math.round(t.h / pitch) * pitch) : t.h;
  return clampTarget({ ...t, x: leftMargin(template), y: t.y + step }, size);
}

/** Move along the line; past the right edge of the page, wrap to the next line. */
export function advance(t: ZoomTarget, template: Template, size: PageSize = DEFAULT_PAGE_SIZE): ZoomTarget {
  const x = t.x + t.w * STEP;
  return x + t.w > size.w - 8 ? newLine(t, template, size) : { ...t, x };
}

export function back(t: ZoomTarget, size: PageSize = DEFAULT_PAGE_SIZE): ZoomTarget {
  return clampTarget({ ...t, x: t.x - t.w * STEP }, size);
}
