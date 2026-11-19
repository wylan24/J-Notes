// PDF page backgrounds: sizing and resolution choices, kept free of pdf.js so they can be tested.
import type { PageSize } from './model';

/** PDF user space is in points (1/72 in); page units are CSS px at 96 dpi. */
export const PT_TO_UNITS = 96 / 72;

/** A PDF page's size in page units, from its size in points (after rotation). */
export function pdfPageSize(widthPt: number, heightPt: number): PageSize {
  return { w: Math.round(widthPt * PT_TO_UNITS * 100) / 100, h: Math.round(heightPt * PT_TO_UNITS * 100) / 100 };
}

/**
 * Most pixels one rendered PDF page may have. iOS Safari refuses canvases over ~16.7M pixels,
 * and keeping several near that limit would exhaust an iPad's memory.
 */
export const MAX_RASTER_PIXELS = 8_000_000;

/** Resolutions step by this factor, so zooming re-renders a page only every so often. */
const STEP = Math.SQRT2;

/**
 * The resolution (device px per page unit) to render a PDF page at, for display at `wanted`.
 * Rounded up to a step so small zoom changes reuse the same render, and capped by the pixel budget.
 */
export function rasterScale(wanted: number, size: PageSize, maxPixels = MAX_RASTER_PIXELS): number {
  const cap = Math.sqrt(maxPixels / (size.w * size.h));
  const stepped = wanted > 0 ? STEP ** Math.ceil(Math.log(wanted) / Math.log(STEP) - 1e-9) : 1;
  return Math.min(stepped, cap);
}

/** Whether a render at `have` px/unit looks sharp enough at `wanted`, or a better one should be made. */
export function sharpEnough(have: number, wanted: number, size: PageSize, maxPixels = MAX_RASTER_PIXELS): boolean {
  return have >= rasterScale(wanted, size, maxPixels) * 0.999;
}
