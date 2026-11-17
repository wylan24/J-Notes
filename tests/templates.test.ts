import { describe, expect, it } from 'vitest';
import { blankPage, PAGE_SIZES, sizeFor, type NotebookMeta, type Orientation, type PageSizePreset, type Template } from '../src/core/model';
import { cornellCueX, cornellSummaryY, linePitch, templateLayout, WEEKDAYS } from '../src/core/templates';
import { defaultTarget, newLine } from '../src/core/zoomWindow';
import { fromFile, referencedBlobIds, toFile } from '../src/io/notebookFile';

const TEMPLATES: Template[] = ['blank', 'ruled', 'grid', 'dotted', 'legal', 'cornell', 'music', 'planner'];
const SIZES = (Object.keys(PAGE_SIZES) as PageSizePreset[]).flatMap((p) => (['portrait', 'landscape'] as Orientation[]).map((o) => ({ name: `${p} ${o}`, size: sizeFor(p, o) })));

describe('templates', () => {
  for (const t of TEMPLATES) {
    it(`${t} stays on the page at every size`, () => {
      for (const { name, size } of SIZES) {
        const { lines, dots, labels } = templateLayout(t, size);
        const xs = [...lines.flatMap((l) => [l.x1, l.x2]), ...dots.map((d) => d.x), ...labels.map((l) => l.x)];
        const ys = [...lines.flatMap((l) => [l.y1, l.y2]), ...dots.map((d) => d.y), ...labels.map((l) => l.y)];
        expect(Math.min(0, ...xs), name).toBe(0);
        expect(Math.max(size.w, ...xs), name).toBe(size.w);
        expect(Math.min(0, ...ys), name).toBe(0);
        expect(Math.max(size.h, ...ys), name).toBe(size.h);
        if (t !== 'blank') expect(lines.length + dots.length, name).toBeGreaterThan(0);
      }
    });
  }

  it('fits the Cornell layout to the page', () => {
    for (const { name, size } of SIZES) {
      const summary = cornellSummaryY(size);
      expect(cornellCueX(size), name).toBe(Math.round(size.w * 0.3));
      expect(summary, name).toBeGreaterThan(size.h * 0.6);
      expect(summary, name).toBeLessThanOrEqual(size.h * 0.8);
      expect((summary - 112) % 32, name).toBe(0); // on a writing line
    }
  });

  it('lays the week out in 2 columns on portrait pages and 4 on landscape', () => {
    const days = (o: Orientation) => templateLayout('planner', sizeFor('a4', o)).labels.filter((l) => WEEKDAYS.includes(l.text));
    const columns = (o: Orientation) => new Set(days(o).map((l) => l.x)).size;
    expect(days('portrait').map((l) => l.text)).toEqual(WEEKDAYS);
    expect(columns('portrait')).toBe(2);
    expect(columns('landscape')).toBe(4);
  });

  it('fits more music staves on a taller page', () => {
    const staves = (o: Orientation) => templateLayout('music', sizeFor('a4', o)).lines.filter((l) => l.y1 === l.y2).length / 5;
    expect(Number.isInteger(staves('portrait'))).toBe(true);
    expect(staves('portrait')).toBeGreaterThan(staves('landscape'));
  });

  it('keeps the zoom window on the writing lines of lined templates', () => {
    const size = sizeFor('letter', 'landscape');
    for (const t of ['legal', 'cornell'] as Template[]) {
      expect(linePitch(t)).toBe(32);
      const target = defaultTarget('p', t, 280, size);
      const next = newLine(target, t, size);
      expect((next.y - target.y) % 32).toBe(0);
    }
    expect(defaultTarget('p', 'cornell', 280, size).x).toBeGreaterThan(cornellCueX(size));
  });
});

describe('custom image templates', () => {
  const meta: NotebookMeta = { id: 'n', title: 'T', cover: '#000', template: 'blank', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 1 };
  const page = blankPage('p', { template: 'blank', size: sizeFor('a5', 'portrait'), paper: 'white', background: { kind: 'image', blobId: 'tpl' } });

  it('is stored on the page and copied to pages built from the same setup', () => {
    expect(page.background).toEqual({ kind: 'image', blobId: 'tpl' });
    const next = blankPage('q', { template: 'blank', size: sizeFor('a5', 'portrait'), paper: 'white', background: page.background });
    expect(next.background).toEqual(page.background);
    expect(next.background).not.toBe(page.background);
  });

  it('survives export and import with its image', () => {
    const doc = { id: 'n', pages: [page] };
    expect(referencedBlobIds(doc)).toEqual(['tpl']);
    const file = toFile(meta, doc, [{ id: 'tpl', type: 'image/png', bytes: new Uint8Array([1, 2, 3]).buffer }]);
    const back = fromFile(JSON.parse(JSON.stringify(file)));
    expect(back.doc.pages).toEqual([page]);
    expect(back.blobs.map((b) => b.id)).toEqual(['tpl']);
    expect([...new Uint8Array(back.blobs[0].bytes)]).toEqual([1, 2, 3]);
  });
});
