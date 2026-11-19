import { describe, expect, it } from 'vitest';
import { MAX_RASTER_PIXELS, pdfPageSize, rasterScale, sharpEnough } from '../src/core/pdf';
import { imagePage, imagePageSize, insertPageOp, insertPagesOps, pdfPages } from '../src/core/pages';
import { DocumentStore } from '../src/core/store';
import { fromFile, referencedBlobIds, toFile } from '../src/io/notebookFile';
import type { NotebookDoc, NotebookMeta, Stroke } from '../src/core/model';

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

describe('pages from PDFs and images', () => {
  const sizes = [pdfPageSize(612, 792), pdfPageSize(842, 595)]; // Letter portrait, A4 landscape

  it('makes one page per PDF page, each the size of its PDF page', () => {
    const pages = pdfPages('pdf1', sizes);
    expect(pages.map((p) => p.size)).toEqual([{ w: 816, h: 1056 }, { w: 1122.67, h: 793.33 }]);
    expect(pages.map((p) => p.background)).toEqual([
      { kind: 'pdf', blobId: 'pdf1', pageIndex: 0 },
      { kind: 'pdf', blobId: 'pdf1', pageIndex: 1 },
    ]);
    expect(new Set(pages.map((p) => p.id)).size).toBe(2);
  });

  it('sizes an image page to the image proportions', () => {
    expect(imagePageSize(4000, 3000)).toEqual({ w: 794, h: 596 });
    expect(imagePage('img', 1000, 2000)).toMatchObject({ size: { w: 794, h: 1588 }, background: { kind: 'image', blobId: 'img' } });
  });

  it('inserts several pages after a page as one undo step', () => {
    const doc: NotebookDoc = { id: 'd', pages: ['a', 'b'].map((id) => ({ id, template: 'blank', strokes: [], items: [] })) };
    const store = new DocumentStore(doc);
    store.dispatch(insertPagesOps(store.doc, 1, pdfPages('pdf1', sizes)));
    expect(store.doc.pages.map((p) => p.background?.kind ?? p.id)).toEqual(['a', 'pdf', 'pdf', 'b']);
    store.undo();
    expect(store.doc).toEqual(doc);
  });

  it('exports and re-imports ink on PDF pages, with the PDF', () => {
    const ink: Stroke = { id: 's', tool: 'pen', color: '#c00', width: 3, simulatePressure: false, points: [{ x: 100, y: 100, p: 0.5 }, { x: 900, y: 500, p: 0.5 }] };
    const pages = pdfPages('pdf1', sizes);
    pages[1] = { ...pages[1], strokes: [ink] };
    const doc: NotebookDoc = { id: 'd', pages };
    const meta: NotebookMeta = { id: 'd', title: 'Lecture', cover: '#000', template: 'blank', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 2 };
    expect(referencedBlobIds(doc)).toEqual(['pdf1']);
    const pdfBytes = new TextEncoder().encode('%PDF-1.4 fake').buffer;
    const back = fromFile(JSON.parse(JSON.stringify(toFile(meta, doc, [{ id: 'pdf1', type: 'application/pdf', bytes: pdfBytes }]))));
    expect(back.doc.pages).toEqual(pages);
    expect(back.blobs).toHaveLength(1);
    expect(back.blobs[0].type).toBe('application/pdf');
    expect(new TextDecoder().decode(back.blobs[0].bytes)).toBe('%PDF-1.4 fake');
  });
});
