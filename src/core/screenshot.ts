// Region screenshots: a dragged rectangle of a page, captured as a picture.
import type { Vec } from './geometry';
import { newId } from './ids';
import type { ImageItem, PageSize } from './model';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Smallest region worth capturing, in page units; a shorter drag is a tap. */
export const MIN_SHOT = 8;

/** The region dragged from `a` to `b`, kept on the page; null if it is too small. */
export function screenshotRect(a: Vec, b: Vec, size: PageSize): Rect | null {
  const x1 = Math.max(0, Math.min(a.x, b.x)), x2 = Math.min(size.w, Math.max(a.x, b.x));
  const y1 = Math.max(0, Math.min(a.y, b.y)), y2 = Math.min(size.h, Math.max(a.y, b.y));
  if (x2 - x1 < MIN_SHOT || y2 - y1 < MIN_SHOT) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** The screenshot as a photo the same size as the region, offset a little so it doesn't hide the original, and kept on the page. */
export function screenshotImage(blobId: string, r: Rect, size: PageSize, offset = 24): ImageItem {
  const x = Math.max(0, Math.min(r.x + offset, size.w - r.w));
  const y = Math.max(0, Math.min(r.y + offset, size.h - r.h));
  return { id: newId(), kind: 'image', blobId, x, y, w: r.w, h: r.h };
}
