import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { displayedSize, hexToRgb, parsePageRange, placement } from '../src/core/pdfPlacement';
import { pdfPages } from '../src/core/pages';
import { pdfPageSize } from '../src/core/pdf';
import type { NotebookDoc, Stroke } from '../src/core/model';
import { strokeSvgPath } from '../src/render/stroke';
import { createNotebook, openDb, resetDbForTests } from '../src/storage/db';
import { exportPdf } from '../src/io/pdfExport';

describe('placing content on PDF pages', () => {
  const box = { x: 10, y: 20, width: 600, height: 800 };
  // Where the displayed top-left (0,0) and a point 100 units right, 40 down land, for each /Rotate.
  const cases: [number, [number, number], [number, number]][] = [
    [0, [10, 820], [85, 790]],
    [90, [10, 20], [40, 95]],
    [180, [610, 20], [535, 50]],
    [270, [610, 820], [580, 745]],
  ];
  for (const [rot, origin, point] of cases) {
    it(`maps the displayed page onto user space at /Rotate ${rot}`, () => {
      const p = placement(box, rot);
      expect(p.at(0, 0)).toEqual(origin);
      expect(p.at(100, 40)).toEqual(point);
      expect(p.rotate).toBe(rot);
    });
  }

  it('treats -90 and 450 as 270 and 90', () => {
    expect(placement(box, -90).rotate).toBe(270);
    expect(placement(box, 450).rotate).toBe(90);
  });

  it('swaps the displayed sides for quarter turns', () => {
    expect(displayedSize(box, 0)).toEqual({ w: 800, h: 1066.6666666666667 });
    expect(displayedSize(box, 90)).toEqual({ w: 1066.6666666666667, h: 800 });
  });

  it('parses page ranges', () => {
    expect(parsePageRange('1-3, 7', 10)).toEqual([0, 1, 2, 6]);
    expect(parsePageRange('8-', 10)).toEqual([7, 8, 9]);
    expect(parsePageRange('3-1', 10)).toEqual([0, 1, 2]);
    expect(parsePageRange('2, 2, 1-2', 10)).toEqual([1, 0]);
    expect(parsePageRange('5-99', 6)).toEqual([4, 5]);
    expect(parsePageRange('abc', 10)).toBeNull();
    expect(parsePageRange('', 10)).toBeNull();
    expect(parsePageRange('20', 10)).toEqual([]);
  });

  it('reads colours', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb('#0f0')).toEqual([0, 1, 0]);
    expect(hexToRgb('nope')).toEqual([0, 0, 0]);
  });
});

const stroke = (id: string, tool: Stroke['tool'], color: string): Stroke => ({
  id,
  tool,
  color,
  width: 4,
  simulatePressure: false,
  points: Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 20, y: 200 + (i % 2) * 10, p: 0.5 })),
});

describe('stroke outlines for export', () => {
  it('traces a closed SVG path', () => {
    const d = strokeSvgPath(stroke('s', 'pen', '#000'));
    expect(d).toMatch(/^M[\d. ]+(Q[\d. ]+)+Z$/);
  });
});

describe('export as PDF', () => {
  beforeEach(async () => {
    const db = await openDb();
    db.close();
    resetDbForTests();
    await new Promise((r) => {
      const req = indexedDB.deleteDatabase('jnotes');
      req.onsuccess = req.onerror = r;
    });
  });

  /** A 3-page source PDF with real text; page 3 is shown rotated. */
  async function sourcePdf(): Promise<ArrayBuffer> {
    const src = await PDFDocument.create();
    const font = await src.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 3; i++) {
      const p = src.addPage([612, 792]);
      p.drawText(`Mitochondria lecture page ${i}`, { x: 72, y: 700, size: 18, font });
      if (i === 3) p.setRotation(degrees(90));
    }
    const bytes = await src.save();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async function textOf(bytes: Uint8Array, pageNumber: number): Promise<string> {
    const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
    const content = await (await pdf.getPage(pageNumber)).getTextContent();
    return content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
  }

  it('keeps the original PDF text selectable, adds ink as vectors, and exports chosen pages', async () => {
    const bytes = await sourcePdf();
    const pages = pdfPages('src', [pdfPageSize(612, 792), pdfPageSize(612, 792), pdfPageSize(792, 612)]);
    pages[0] = { ...pages[0], strokes: [stroke('h', 'highlighter', '#ffd400'), stroke('p', 'pen', '#c00')] };
    pages.push({ id: 'notes', template: 'cornell', strokes: [stroke('q', 'pen', '#000'), { ...stroke('g', 'pen', '#333'), penStyle: 'pencil' }], items: [{ id: 't', kind: 'text', x: 120, y: 140, w: 300, h: 30, text: 'Café notes ✓', font: 'serif', size: 18, color: '#333' }] });
    const doc: NotebookDoc = { id: 'n', pages };
    await createNotebook(
      { id: 'n', title: 'Bio', cover: '#000', template: 'blank', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: pages.length },
      doc,
      [{ docId: 'n', id: 'src', type: 'application/pdf', bytes }],
    );

    const out = await exportPdf(doc, 'n', 'Bio', { pages: [0, 2, 3], background: true });
    const back = await PDFDocument.load(out);
    expect(back.getPageCount()).toBe(3);
    expect(back.getTitle()).toBe('Bio');
    // Original pages keep their size and rotation; the notebook page is A4 in points.
    expect(back.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(back.getPage(1).getRotation().angle).toBe(90);
    expect(back.getPage(2).getSize().width).toBeCloseTo(595.5, 0);

    // Original text is still text, and so is the typed text box (with ✓ replaced, as Times can't encode it).
    expect(await textOf(out, 1)).toContain('Mitochondria lecture page 1');
    expect(await textOf(out, 2)).toContain('Mitochondria lecture page 3');
    const notes = await textOf(out, 3);
    expect(notes).toContain('Café notes ?');
    expect(notes).toContain('Summary'); // the Cornell template's label, drawn as text
  });

  it('exports content only when backgrounds are off', async () => {
    const bytes = await sourcePdf();
    const pages = pdfPages('src', [pdfPageSize(612, 792)]);
    pages[0] = { ...pages[0], strokes: [stroke('p', 'pen', '#c00')] };
    const doc: NotebookDoc = { id: 'm', pages };
    await createNotebook(
      { id: 'm', title: 'Bio', cover: '#000', template: 'blank', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 1 },
      doc,
      [{ docId: 'm', id: 'src', type: 'application/pdf', bytes }],
    );
    const out = await exportPdf(doc, 'm', 'Bio', { pages: [0], background: false });
    expect(await textOf(out, 1)).not.toContain('Mitochondria');
    expect((await PDFDocument.load(out)).getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });
});
