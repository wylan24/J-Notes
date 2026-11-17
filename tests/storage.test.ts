import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NotebookMeta } from '../src/core/model';
import { DocumentStore } from '../src/core/store';
import { appendEvents, compact, createNotebook, deleteNotebook, listNotebooks, loadDocument, openDb, resetDbForTests } from '../src/storage/db';
import { Persister } from '../src/storage/persister';

const meta = (id: string): NotebookMeta => ({
  id,
  title: 'Test',
  cover: '#000',
  template: 'blank',
  createdAt: 1,
  updatedAt: 1,
  favourite: false,
  trashedAt: null,
  pageCount: 1,
});

beforeEach(async () => {
  // Fresh database per test.
  const db = await openDb();
  db.close();
  resetDbForTests();
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('jnotes');
    req.onsuccess = req.onerror = r;
  });
});

describe('event-sourced storage', () => {
  it('reloads a notebook by replaying events on top of the snapshot', async () => {
    await createNotebook(meta('n1'), { id: 'n1', pages: [{ id: 'p', template: 'blank', strokes: [] }] });
    const { doc, seq } = await loadDocument('n1');
    const store = new DocumentStore(doc, seq);
    const persister = new Persister(store, 0);
    for (let i = 0; i < 5; i++) {
      store.dispatch([{ type: 'strokes.added', pageId: 'p', strokes: [{ id: `s${i}`, tool: 'pen', color: '#000', width: 2, simulatePressure: false, points: [{ x: i, y: i, p: 0.5 }] }] }]);
    }
    store.undo();
    await persister.dispose();

    const reloaded = await loadDocument('n1');
    expect(reloaded.seq).toBe(6);
    expect(reloaded.doc).toEqual(store.doc);
    expect(reloaded.doc.pages[0].strokes.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3']);
    expect((await listNotebooks())[0].pageCount).toBe(1);
  });

  it('compaction keeps the document identical and drops old events', async () => {
    await createNotebook(meta('n2'), { id: 'n2', pages: [] });
    await appendEvents('n2', [{ docId: 'n2', seq: 1, ts: 0, op: { type: 'page.added', index: 0, page: { id: 'p', template: 'grid', strokes: [] } } }], {});
    const before = await loadDocument('n2');
    await compact('n2', before.doc, before.seq);
    const after = await loadDocument('n2');
    expect(after.doc).toEqual(before.doc);
    expect(after.snapshotSeq).toBe(1);
  });

  it('deleting a notebook removes it everywhere', async () => {
    await createNotebook(meta('n3'), { id: 'n3', pages: [] });
    await deleteNotebook('n3');
    expect(await listNotebooks()).toEqual([]);
    await expect(loadDocument('n3')).rejects.toThrow();
  });
});
