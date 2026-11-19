import { describe, expect, it } from 'vitest';
import { clampCrop, cropPatch, dragCrop, flipPatch, fullImageBox, itemMatrix, MIN_CROP } from '../src/core/imageEdit';
import { itemAt, itemBounds, normalizeRotation, pointOnItem } from '../src/core/items';
import type { ImageItem, PageItem } from '../src/core/model';
import { applyMatrix, rotateAbout, transformItem } from '../src/core/transform';

const photo = (extra: Partial<ImageItem> = {}): ImageItem => ({ id: 'i', kind: 'image', x: 100, y: 100, w: 200, h: 100, blobId: 'b', ...extra });
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

/** Where a point of the source image (fractions u, v) appears on the page. */
function shownAt(it: ImageItem, u: number, v: number) {
  const f = fullImageBox(it);
  return applyMatrix(itemMatrix(it), { x: f.minX + u * (f.maxX - f.minX), y: f.minY + v * (f.maxY - f.minY) });
}

describe('rotation', () => {
  it('normalises angles, dropping zero', () => {
    expect(normalizeRotation(0)).toBeUndefined();
    expect(normalizeRotation(2 * Math.PI)).toBeUndefined();
    close(normalizeRotation((3 * Math.PI) / 2)!, -Math.PI / 2);
  });

  it('bounds and hit testing follow the turned box', () => {
    const it = photo({ rotation: Math.PI / 2 });
    const b = itemBounds(it);
    close(b.minX, 150); close(b.maxX, 250); close(b.minY, 50); close(b.maxY, 250);
    expect(pointOnItem(it, { x: 200, y: 60 })).toBe(true); // above the unturned box, inside the turned one
    expect(pointOnItem(it, { x: 110, y: 150 })).toBe(false); // inside the unturned box only
    expect(itemAt({ id: 'p', template: 'blank', strokes: [], items: [it] }, { x: 110, y: 150 })).toBeNull();
  });

  it('rotating a selection turns photos, text and open notes, but not tape or links', () => {
    const m = rotateAbout(Math.PI / 6, { x: 0, y: 0 });
    expect(transformItem(photo(), m).rotation).toBeCloseTo(Math.PI / 6);
    const tape: PageItem = { id: 't', kind: 'tape', x: 0, y: 0, w: 10, h: 10, color: '#fc0' };
    expect(transformItem(tape, m).rotation).toBeUndefined();
    // A full turn back to the start removes the field.
    expect(transformItem(photo({ rotation: -Math.PI / 6 }), m).rotation).toBeUndefined();
  });
});

describe('crop', () => {
  it('keeps crops inside the image and above the minimum size', () => {
    expect(clampCrop({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 })).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
    expect(clampCrop({ x: 0.5, y: 0.5, w: 0, h: 0 }).w).toBe(MIN_CROP);
  });

  it('dragging an edge stops at the image and the minimum size; moving keeps the size', () => {
    const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    const left = dragCrop(c, 'w', -0.5, 0);
    close(left.x, 0); close(left.w, 0.7); close(left.y, 0.2); close(left.h, 0.5);
    const small = dragCrop(c, 'se', -1, -1);
    close(small.x, 0.2); close(small.w, MIN_CROP); close(small.h, MIN_CROP);
    const moved = dragCrop(c, 'move', 1, 0);
    close(moved.x, 0.5); close(moved.w, 0.5);
  });

  it('cropping leaves the kept part exactly where it was, plain, turned or mirrored', () => {
    for (const extra of [{}, { rotation: 0.7 }, { flip: 'h' as const }, { rotation: -2, flip: 'hv' as const }, { crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 } }]) {
      const it = photo(extra);
      const next = { ...it, ...cropPatch(it, { x: 0.3, y: 0.4, w: 0.4, h: 0.3 }) } as ImageItem;
      for (const [u, v] of [[0.3, 0.4], [0.7, 0.7], [0.5, 0.55]]) {
        const before = shownAt(it, u, v), after = shownAt(next, u, v);
        close(after.x, before.x); close(after.y, before.y);
      }
    }
  });

  it('a full crop removes the field', () => {
    expect(cropPatch(photo({ crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }), { x: 0, y: 0, w: 1, h: 1 }).crop).toBeUndefined();
  });
});

describe('flip', () => {
  it('toggles each axis', () => {
    expect(flipPatch(photo(), 'h')).toEqual({ flip: 'h' });
    expect(flipPatch(photo({ flip: 'h' }), 'v')).toEqual({ flip: 'hv' });
    expect(flipPatch(photo({ flip: 'hv' }), 'h')).toEqual({ flip: 'v' });
    expect(flipPatch(photo({ flip: 'v' }), 'v')).toEqual({ flip: undefined });
  });

  it('mirrors about the centre: the left edge shows on the right', () => {
    const p = shownAt(photo({ flip: 'h' }), 0, 0.5);
    close(p.x, 300); close(p.y, 150);
  });
});
