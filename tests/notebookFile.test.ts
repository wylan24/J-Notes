import { describe, expect, it } from 'vitest';
import type { NotebookDoc, NotebookMeta } from '../src/core/model';
import { bytesToDataUrl, dataUrlToBytes, fromFile, referencedBlobIds, toFile } from '../src/io/notebookFile';

const meta: NotebookMeta = { id: 'n', title: 'Trip', cover: '#123', template: 'grid', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 1 };
const doc: NotebookDoc = {
  id: 'n',
  pages: [{ id: 'p', template: 'grid', strokes: [], items: [{ id: 'i', kind: 'image', x: 0, y: 0, w: 10, h: 10, blobId: 'photo' }] }],
};
const bytes = (...b: number[]) => new Uint8Array(b).buffer;

describe('.jnotes.json', () => {
  it('embeds referenced blobs as data URLs and restores them on import', () => {
    const file = toFile(meta, doc, [
      { id: 'photo', type: 'image/png', bytes: bytes(0, 255, 128, 7) },
      { id: 'orphan', type: 'image/png', bytes: bytes(1) }, // no longer referenced: not exported
    ]);
    expect(file.version).toBe(2);
    expect(Object.keys(file.blobs!)).toEqual(['photo']);
    expect(file.blobs!.photo).toMatch(/^data:image\/png;base64,/);

    const imported = fromFile(JSON.parse(JSON.stringify(file)));
    expect(imported.doc.id).not.toBe('n');
    expect(imported.doc.pages).toEqual(doc.pages);
    expect(imported.blobs).toHaveLength(1);
    expect(imported.blobs[0]).toMatchObject({ docId: imported.doc.id, id: 'photo', type: 'image/png' });
    expect([...new Uint8Array(imported.blobs[0].bytes)]).toEqual([0, 255, 128, 7]);
  });

  it('imports version 1 files, which have no items or blobs', () => {
    const v1 = { format: 'jnotes-notebook', version: 1, title: 'Old', cover: '#000', template: 'ruled', doc: { id: 'x', pages: [{ id: 'p', template: 'ruled', strokes: [] }] } };
    const { doc: d, blobs } = fromFile(v1);
    expect(d.pages[0].items).toEqual([]);
    expect(blobs).toEqual([]);
  });

  it('rejects unknown versions and malformed blobs', () => {
    expect(() => fromFile({ ...toFile(meta, doc), version: 3 })).toThrow('Not a J Notes notebook file');
    expect(() => fromFile({ ...toFile(meta, doc), blobs: { photo: 'https://example.com/x.png' } })).toThrow('photo');
  });

  it('round-trips binary data through data URLs, including large payloads', () => {
    const big = new Uint8Array(200_000).map((_, i) => (i * 31) % 256);
    const back = dataUrlToBytes(bytesToDataUrl('audio/webm', big.buffer))!;
    expect(back.type).toBe('audio/webm');
    expect(new Uint8Array(back.bytes)).toEqual(big);
    expect(dataUrlToBytes('data:image/png;base64,!!!')).toBeNull();
  });

  it('lists the blobs a notebook refers to', () => {
    expect(referencedBlobIds(doc)).toEqual(['photo']);
  });
});
