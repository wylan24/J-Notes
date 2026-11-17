import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NotebookMeta } from '../src/core/model';
import { DocumentStore } from '../src/core/store';
import { addSession, appendEvents, deleteElement, listElements, renameElement, saveElement, clearSessions, compact, createNotebook, deleteNotebook, getBlob, getBlobs, listSessions, listNotebooks, loadDocument, openDb, putBlob, resetDbForTests } from '../src/storage/db';
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
    await createNotebook(meta('n1'), { id: 'n1', pages: [{ id: 'p', template: 'blank', strokes: [], items: [] }] });
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
    await appendEvents('n2', [{ docId: 'n2', seq: 1, ts: 0, op: { type: 'page.added', index: 0, page: { id: 'p', template: 'grid', strokes: [], items: [] } } }], {});
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

  it('upgrades a version 1 database and loads notebooks saved before page items existed', async () => {
    // Recreate the v1 schema with a legacy notebook, as an existing install would have.
    (await openDb()).close();
    resetDbForTests();
    await new Promise((r) => {
      const del = indexedDB.deleteDatabase('jnotes');
      del.onsuccess = del.onerror = r;
    });
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('jnotes', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('meta', { keyPath: 'id' }).put(meta('old'));
        db.createObjectStore('snapshots', { keyPath: 'docId' }).put({ docId: 'old', seq: 0, doc: { id: 'old', pages: [{ id: 'p', template: 'blank', strokes: [] }] } });
        db.createObjectStore('events', { keyPath: ['docId', 'seq'] }).put({
          docId: 'old',
          seq: 1,
          ts: 0,
          op: { type: 'page.added', index: 1, page: { id: 'p2', template: 'ruled', strokes: [] } },
        });
      };
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });

    const { doc } = await loadDocument('old');
    expect(doc.pages.map((p) => p.items)).toEqual([[], []]);
    expect((await listNotebooks()).map((n) => n.id)).toEqual(['old']);
    expect(await getBlobs('old')).toEqual([]); // the blobs store now exists
  });
});

describe('blob store', () => {
  const bytes = (...b: number[]) => new Uint8Array(b).buffer;

  it('stores blobs per notebook and deletes them with it', async () => {
    await createNotebook(meta('b1'), { id: 'b1', pages: [] }, [{ docId: 'b1', id: 'img', type: 'image/png', bytes: bytes(1, 2, 3) }]);
    await createNotebook(meta('b2'), { id: 'b2', pages: [] });
    // The same blob id in another notebook (e.g. an imported copy) is a separate record.
    await putBlob({ docId: 'b2', id: 'img', type: 'image/jpeg', bytes: bytes(9) });
    await putBlob({ docId: 'b2', id: 'other', type: 'audio/webm', bytes: bytes(7, 7) });

    const got = await getBlob('b1', 'img');
    expect(got?.type).toBe('image/png');
    expect([...new Uint8Array(got!.bytes)]).toEqual([1, 2, 3]);
    expect((await getBlobs('b2')).map((b) => b.id).sort()).toEqual(['img', 'other']);
    expect((await getBlobs('b2', ['other', 'missing'])).map((b) => b.id)).toEqual(['other']);

    await deleteNotebook('b1');
    expect(await getBlob('b1', 'img')).toBeUndefined();
    expect(await getBlobs('b2')).toHaveLength(2);
  });
});

describe('timer history', () => {
  it('lists sessions newest first, limited, and clears them', async () => {
    for (let i = 0; i < 5; i++) await addSession({ id: `s${i}`, mode: 'stopwatch', startedAt: i * 10, endedAt: i * 10 + 5, durationMs: 5, completed: false });
    expect((await listSessions()).map((s) => s.id)).toEqual(['s4', 's3', 's2', 's1', 's0']);
    expect((await listSessions(2)).map((s) => s.id)).toEqual(['s4', 's3']);
    await clearSessions();
    expect(await listSessions()).toEqual([]);
  });

  it('keeps history when a notebook is deleted', async () => {
    await createNotebook(meta('h'), { id: 'h', pages: [] });
    await addSession({ id: 'x', mode: 'countdown', startedAt: 0, endedAt: 1, durationMs: 1, targetMs: 1, completed: true, notebookId: 'h' });
    await deleteNotebook('h');
    expect(await listSessions()).toHaveLength(1);
  });
});

describe('elements library', () => {
  const el = (id: string, createdAt: number) => ({
    id,
    name: id,
    createdAt,
    thumbnail: 'data:image/png;base64,',
    strokes: [],
    items: [{ id: 'i', kind: 'image' as const, x: 0, y: 0, w: 10, h: 10, blobId: 'b' }],
    w: 10,
    h: 10,
    blobs: [{ id: 'b', type: 'image/png', bytes: new Uint8Array([1, 2]).buffer }],
  });

  it('saves, lists newest first, renames and deletes, keeping photo bytes', async () => {
    await saveElement(el('old', 1));
    await saveElement(el('new', 2));
    expect((await listElements()).map((e) => e.id)).toEqual(['new', 'old']);
    await renameElement('old', 'Diagram');
    const [, old] = await listElements();
    expect(old.name).toBe('Diagram');
    expect([...new Uint8Array(old.blobs[0].bytes)]).toEqual([1, 2]);
    await deleteElement('new');
    expect((await listElements()).map((e) => e.id)).toEqual(['old']);
  });
});

