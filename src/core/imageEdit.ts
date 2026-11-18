// Photo crop and flip, and the transform that draws a turned or mirrored item.
import type { Bounds, Vec } from './geometry';
import { itemRect, itemRotation } from './items';
import type { CropRect, ImageItem, ItemPatch, PageItem } from './model';
import { applyMatrix, multiply, rotateAbout, type Matrix } from './transform';

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
/** Smallest crop, as a fraction of the image, so a photo can't be cropped away to nothing. */
export const MIN_CROP = 0.05;

export const cropOf = (it: ImageItem): CropRect => it.crop ?? FULL_CROP;

const flipX = (it: PageItem) => it.kind === 'image' && !!it.flip?.includes('h');
const flipY = (it: PageItem) => it.kind === 'image' && !!it.flip?.includes('v');

/**
 * Page transform to draw the item with: content laid out in its unturned box (`itemRect`), then
 * mirrored and turned about the box's centre. Identity for a plain item.
 */
export function itemMatrix(it: PageItem): Matrix {
  const r = itemRect(it);
  const c = { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
  const fx = flipX(it) ? -1 : 1, fy = flipY(it) ? -1 : 1;
  const mirror: Matrix = [fx, 0, 0, fy, c.x * (1 - fx), c.y * (1 - fy)];
  return multiply(rotateAbout(itemRotation(it), c), mirror);
}

/**
 * Where the whole source image sits in the item's unturned frame: placed so the crop lands exactly
 * on the item's box. Drawn under `itemMatrix` and clipped to the box, this shows the crop.
 */
export function fullImageBox(it: ImageItem): Bounds {
  const c = cropOf(it);
  const W = it.w / c.w, H = it.h / c.h;
  const minX = it.x - c.x * W, minY = it.y - c.y * H;
  return { minX, minY, maxX: minX + W, maxY: minY + H };
}

/** A crop kept inside the image and no smaller than `MIN_CROP`. */
export function clampCrop(c: CropRect): CropRect {
  const w = Math.min(1, Math.max(MIN_CROP, c.w));
  const h = Math.min(1, Math.max(MIN_CROP, c.h));
  return { x: Math.min(1 - w, Math.max(0, c.x)), y: Math.min(1 - h, Math.max(0, c.y)), w, h };
}

const isFull = (c: CropRect) => c.x <= 1e-6 && c.y <= 1e-6 && c.w >= 1 - 1e-6 && c.h >= 1 - 1e-6;

/**
 * Patch that crops the photo to `crop` (fractions of the source) without moving the image on the
 * page: the shown part keeps its scale, and the box moves to where that part already was, however
 * the photo is turned or mirrored.
 */
export function cropPatch(it: ImageItem, crop: CropRect): ItemPatch {
  const next = clampCrop(crop);
  const full = fullImageBox(it);
  const W = full.maxX - full.minX, H = full.maxY - full.minY;
  const w = next.w * W, h = next.h * H;
  const localCentre: Vec = { x: full.minX + (next.x + next.w / 2) * W, y: full.minY + (next.y + next.h / 2) * H };
  const centre = applyMatrix(itemMatrix(it), localCentre);
  return { x: centre.x - w / 2, y: centre.y - h / 2, w, h, crop: isFull(next) ? undefined : next };
}

/** Patch that mirrors the photo across its own vertical ('h') or horizontal ('v') axis, toggling. */
export function flipPatch(it: ImageItem, axis: 'h' | 'v'): ItemPatch {
  const h = !!it.flip?.includes('h') !== (axis === 'h');
  const v = !!it.flip?.includes('v') !== (axis === 'v');
  return { flip: h && v ? 'hv' : h ? 'h' : v ? 'v' : undefined };
}

/**
 * Move one edge or corner of a crop (or the whole crop, for 'move') by (du, dv), in fractions of
 * the source image. Edges stop at the image and at the minimum size; a move keeps the size.
 */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';
export function dragCrop(c: CropRect, handle: CropHandle, du: number, dv: number): CropRect {
  if (handle === 'move') return clampCrop({ ...c, x: c.x + du, y: c.y + dv });
  let { x, y } = c;
  let x2 = c.x + c.w, y2 = c.y + c.h;
  if (handle.includes('w')) x = Math.min(x2 - MIN_CROP, Math.max(0, x + du));
  if (handle.includes('e')) x2 = Math.max(x + MIN_CROP, Math.min(1, x2 + du));
  if (handle.includes('n')) y = Math.min(y2 - MIN_CROP, Math.max(0, y + dv));
  if (handle.includes('s')) y2 = Math.max(y + MIN_CROP, Math.min(1, y2 + dv));
  return { x, y, w: x2 - x, h: y2 - y };
}
