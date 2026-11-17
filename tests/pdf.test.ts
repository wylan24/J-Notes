import { describe, expect, it } from 'vitest';
import { MAX_RASTER_PIXELS, pdfPageSize, rasterScale, sharpEnough } from '../src/core/pdf';
import { insertPageOp } from '../src/core/pages';
import type { NotebookDoc } from '../src/core/model';

describe('PDF page backgrounds', () => {
  it('converts PDF points to page units', () => {
    expect(pdfPageSize(612, 792)).toEqual({ w: 816, h: 1056 }); // US Letter
    expect(pdfPageSize(595.28, 841.89)).toEqual({ w: 793.71, h: 1122.52 }); // A4
  });

  const letter = pdfPageSize(612, 792);

  it('steps the render resolution so small zoom changes reuse a render', () => {
    expect(rasterScale(1, letter)).toBeCloseTo(1);
    expect(rasterScale(1.1, letter)).toBeCloseTo(Math.SQRT2);
    expect(rasterScale(1.3, letter)).toBeCloseTo(Math.SQRT2);
    expect(rasterScale(1.5, letter)).toBeCloseTo(2);
    expect(rasterScale(0.2, letter)).toBeLessThan(0.3); // thumbnails stay small
  });

  it('caps a render at the pixel budget however far you zoom', () => {
    const s = rasterScale(12, letter);
    expect(s * letter.w * s * letter.h).toBeLessThanOrEqual(MAX_RASTER_PIXELS * 1.0001);
    expect(sharpEnough(s, 12, letter)).toBe(true); // at the cap, no endless re-rendering
  });

  it('asks for a sharper render only when the current one is too soft', () => {
    expect(sharpEnough(2, 1.4, letter)).toBe(true);
    expect(sharpEnough(1, 1.5, letter)).toBe(false);
  });

  it('inserts blank pages next to a PDF page instead of copying the PDF page', () => {
    const doc: NotebookDoc = { id: 'd', pages: [{ id: 'p', template: 'blank', strokes: [], items: [], size: letter, background: { kind: 'pdf', blobId: 'f', pageIndex: 3 } }] };
    const op = insertPageOp(doc, 0, 'after')!;
    if (op.type !== 'page.added') throw new Error();
    expect(op.page.background).toBeUndefined();
    expect(op.page.size).toEqual(letter);
  });
});
