import { describe, expect, it } from 'vitest';
import type { NotebookDoc, NotebookMeta, TextDocNode } from '../src/core/model';
import { forStorage, textDocBlobIds, textDocLines, textDocPlain, withImageSources } from '../src/core/textDoc';
import { applyOp, inverseOp, updateDocOp } from '../src/core/ops';
import { fromFile, referencedBlobIds, toFile } from '../src/io/notebookFile';

const doc: TextDocNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Trip plan' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Pack ' }, { type: 'text', text: 'light', marks: [{ type: 'bold' }] }] },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tickets' }] }] },
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hotel' }] }] },
      ],
    },
    { type: 'image', attrs: { src: 'blob:http://x/1', blobId: 'img1', alt: 'map' } },
    {
      type: 'table',
      content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Day' }] }] }] }],
    },
  ],
};

describe('text documents', () => {
  it('list their text line by line, with headings, checklists and table cells', () => {
    expect(textDocLines(doc)).toEqual([
      { text: 'Trip plan', heading: 1 },
      { text: 'Pack light', heading: 0 },
      { text: '☑ Tickets', heading: 0 },
      { text: '☐ Hotel', heading: 0 },
      { text: 'Day', heading: 0 },
    ]);
    expect(textDocLines(doc, 2)).toHaveLength(2);
    expect(textDocPlain(doc).split('\n')[0]).toBe('Trip plan');
  });

  it('store images by blob id, without the window-only object URL, and show them again', () => {
    const stored = forStorage(doc);
    const img = stored.content!.find((n) => n.type === 'image')!;
    expect(img.attrs).toEqual({ blobId: 'img1', alt: 'map' });
    expect(textDocBlobIds(stored)).toEqual(['img1']);
    const shown = withImageSources(stored, (id) => (id === 'img1' ? 'blob:new' : undefined));
    expect(shown.content!.find((n) => n.type === 'image')!.attrs!.src).toBe('blob:new');
  });

  it('save through doc.updated, which undoes', () => {
    const d: NotebookDoc = { id: 'd', pages: [] };
    const op = updateDocOp(d, { text: forStorage(doc) })!;
    const next = applyOp(d, op);
    expect(next.text).toEqual(forStorage(doc));
    expect(applyOp(next, inverseOp(op)).text).toBeUndefined();
    expect(updateDocOp(next, { text: forStorage(doc) })).toBeNull();
  });

  it('export and import as a file, keeping their kind and pictures', () => {
    const meta: NotebookMeta = { id: 'd', kind: 'text', title: 'Trip', cover: '#000', template: 'blank', createdAt: 0, updatedAt: 0, favourite: false, trashedAt: null, pageCount: 0 };
    const d: NotebookDoc = { id: 'd', pages: [], text: forStorage(doc) };
    expect(referencedBlobIds(d)).toEqual(['img1']);
    const file = toFile(meta, d, [{ id: 'img1', type: 'image/png', bytes: new Uint8Array([1, 2]).buffer }]);
    const back = fromFile(JSON.parse(JSON.stringify(file)));
    expect(back.meta.kind).toBe('text');
    expect(back.doc.text).toEqual(forStorage(doc));
    expect(back.blobs.map((b) => b.id)).toEqual(['img1']);
  });
});
