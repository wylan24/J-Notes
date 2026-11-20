import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotebookDoc, NotebookMeta } from '../src/core/model';
import type { DocOp } from '../src/core/ops';
import { DocumentStore } from '../src/core/store';
import { compact, createNotebook, deletedSyncDocs, deleteNotebook, eventsAfter, loadDocument, openDb, putSyncDoc, resetDbForTests, applyMerged, appendEvents } from '../src/storage/db';
import { Persister } from '../src/storage/persister';
import { localLibrary, localNotebooks, removeSyncedCopies } from '../src/sync/local';
import { syncLibrary } from '../src/sync/library';
import { getMeta, listElements, listFolders, listNotebooks, putFolder, saveElement, updateMeta } from '../src/storage/db';
import { syncNotebooks } from '../src/sync/engine';
import { Device, FakeDrive, Library, stroke } from './syncFakes';

const meta = (id: string): NotebookMeta => ({ id, title: 'Test', cover: '#000', template: 'blank', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 1 });
const blank = (id: string): NotebookDoc => ({ id, pages: [{ id: 'p1', template: 'blank', strokes: [], items: [] }] });
const add = (id: string): DocOp => ({ type: 'strokes.added', pageId: 'p1', strokes: [stroke(id)] });
const ids = (doc: NotebookDoc) => doc.pages[0].strokes.map((s) => s.id);

/** Log edits for a notebook that isn't open, as the persister would. */
async function logEdits(docId: string, from: number, ...strokeIds: string[]) {
  await appendEvents(docId, strokeIds.map((id, i) => ({ docId, seq: from + i, ts: 0, op: add(id) })), {});
}

beforeEach(async () => {
  const db = await openDb();
  db.close();
  resetDbForTests();
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('jnotes');
    req.onsuccess = req.onerror = r;
  });
});

describe('sync storage', () => {
  it('compaction keeps edits that are not uploaded yet', async () => {
    await createNotebook(meta('n1'), blank('n1'));
    await logEdits('n1', 1, 'a', 'b', 'c', 'd');
    await putSyncDoc({ docId: 'n1', uploaded: 2, vector: {} });
    const { doc, seq } = await loadDocument('n1');
    await compact('n1', doc, seq);
    expect((await eventsAfter('n1', 0)).map((e) => e.seq)).toEqual([3, 4]);
    const reloaded = await loadDocument('n1');
    expect(ids(reloaded.doc)).toEqual(['a', 'b', 'c', 'd']);
    expect(reloaded.seq).toBe(4);
  });

  it('compaction drops everything as before when the notebook does not sync', async () => {
    await createNotebook(meta('n1'), blank('n1'));
    await logEdits('n1', 1, 'a', 'b');
    const { doc, seq } = await loadDocument('n1');
    await compact('n1', doc, seq);
    expect(await eventsAfter('n1', 0)).toEqual([]);
  });

  it('a closed notebook takes in the merged notebook and keeps its own edits on top', async () => {
    await createNotebook(meta('n1'), blank('n1'));
    await logEdits('n1', 1, 'a', 'b', 'c');
    const merged = { ...blank('n1'), pages: [{ id: 'p1', template: 'blank' as const, strokes: [stroke('a'), stroke('b'), stroke('remote')], items: [] }] };
    await applyMerged('n1', merged, 2);
    const { doc, seq } = await loadDocument('n1');
    expect(ids(doc)).toEqual(['a', 'b', 'remote', 'c']);
    expect(seq).toBe(3);
    // Edit 3 isn't uploaded yet, so it is still there to send.
    expect((await eventsAfter('n1', 2)).map((e) => e.seq)).toEqual([3]);
  });

  it('an open notebook takes in the merged notebook without losing unsaved edits', async () => {
    await createNotebook(meta('n1'), blank('n1'));
    const store = new DocumentStore(blank('n1'), 0);
    const persister = new Persister(store, 0);
    store.dispatch([add('a')]);
    await persister.flush();
    store.dispatch([add('unsaved')]);
    const merged = { ...blank('n1'), pages: [{ id: 'p1', template: 'blank' as const, strokes: [stroke('a'), stroke('remote')], items: [] }] };
    await persister.rebase(merged, 1);
    expect(ids(store.doc)).toEqual(['a', 'remote', 'unsaved']);
    store.dispatch([add('after')]);
    await persister.dispose();
    const { doc } = await loadDocument('n1');
    expect(ids(doc)).toEqual(['a', 'remote', 'unsaved', 'after']);
  });

  it('deleting a synced notebook leaves a note for sync; an unsynced one leaves nothing', async () => {
    await createNotebook(meta('n1'), blank('n1'));
    await createNotebook(meta('n2'), blank('n2'));
    await putSyncDoc({ docId: 'n1', uploaded: 0, vector: {} });
    await deleteNotebook('n1');
    await deleteNotebook('n2');
    expect(await deletedSyncDocs()).toEqual(['n1']);
  });

  it('syncs this browser with another device through Drive, offline edits on both kept', async () => {
    const drive = new FakeDrive();
    const sync = () => syncNotebooks({ drive, local: localNotebooks, device: 'here', snapshotEvery: 3 });
    const other = new Device('there', drive);

    await createNotebook(meta('n1'), blank('n1'));
    await logEdits('n1', 1, 'h1');
    await sync();
    await other.sync();
    expect(other.strokeIds('n1')).toEqual(['h1']);

    // Both edit offline; this browser's notebook is open in the editor.
    const loaded = await loadDocument('n1');
    const store = new DocumentStore(loaded.doc, loaded.seq);
    const persister = new Persister(store, loaded.snapshotSeq);
    for (const id of ['h2', 'h3', 'h4']) store.dispatch([add(id)]);
    other.draw('n1', 'p1', 't1', 't2');

    await sync();
    await other.sync();
    await sync();
    expect([...ids(store.doc)].sort()).toEqual(['h1', 'h2', 'h3', 'h4', 't1', 't2']);
    expect(other.doc('n1')).toEqual(store.doc);

    // A notebook made on the other device arrives here.
    other.newNotebook('n2');
    other.draw('n2', 'p1', 'x');
    await other.sync();
    await sync();
    expect(ids((await loadDocument('n2')).doc)).toEqual(['x']);

    await persister.dispose();
    expect((await loadDocument('n1')).doc).toEqual(store.doc);
  });

  it('syncs titles, folders and settings between this browser and another device', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    const drive = new FakeDrive();
    const sync = () => syncLibrary({ drive, local: localLibrary, device: 'here' });
    const other = new Library('there', drive);
    other.addNotebook('n1');

    await createNotebook(meta('n1'), blank('n1'));
    await putFolder({ id: 'f1', name: 'School', color: '#123456', parentId: null, createdAt: 1 });
    await updateMeta('n1', { title: 'Biology', folderId: 'f1' });
    store.set('jnotes.presets', JSON.stringify([{ id: 'p1' }]));
    store.set('jnotes.penOnly', 'true');
    await sync();
    await other.sync();
    expect(other.metas.get('n1')).toMatchObject({ title: 'Biology', folderId: 'f1' });
    expect(other.folders.get('f1')!.name).toBe('School');
    expect(other.settings.get('jnotes.presets')).toEqual([{ id: 'p1' }]);
    expect(other.settings.has('jnotes.penOnly')).toBe(false);

    other.metas.get('n1')!.favourite = true;
    other.folders.delete('f1');
    other.settings.set('jnotes.snap', false);
    await other.sync();
    expect(await sync()).toBe(true);
    expect((await getMeta('n1'))!.favourite).toBe(true);
    expect(await listFolders()).toEqual([]);
    expect(store.get('jnotes.snap')).toBe('false');
    expect(await sync()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('signing out and removing deletes only what is safely in Drive, and it all comes back', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    const drive = new FakeDrive();
    const sync = async () => {
      await syncNotebooks({ drive, local: localNotebooks, device: 'here' });
      await syncLibrary({ drive, local: localLibrary, device: 'here' });
    };
    for (const id of ['safe', 'edited', 'quick', 'open']) await createNotebook({ ...meta(id), ...(id === 'quick' ? { quicknote: true as const } : {}) }, blank(id));
    await putFolder({ id: 'f1', name: 'School', color: '#123456', parentId: null, createdAt: 1 });
    await updateMeta('safe', { folderId: 'f1', title: 'Safe' });
    await saveElement({ id: 'e1', name: 'Star', createdAt: 1, thumbnail: '', strokes: [], items: [], blobs: [] } as never);
    await sync();
    await logEdits('edited', 1, 'not-uploaded');
    const opened = new Persister(new DocumentStore(blank('open'), 0), 0);

    const { removed, kept } = await removeSyncedCopies();
    expect({ removed, kept }).toEqual({ removed: 1, kept: 3 });
    expect((await listNotebooks()).map((m) => m.id).sort()).toEqual(['edited', 'open', 'quick']);
    expect(await listElements()).toEqual([]);
    // Folders stay while notebooks are kept; nothing is deleted from Drive.
    expect((await listFolders()).map((f) => f.id)).toEqual(['f1']);
    expect(drive.names().some((n) => n.endsWith('.deleted'))).toBe(false);
    await opened.dispose();

    // Signing in again brings it back, title and folder included.
    await sync();
    expect((await getMeta('safe'))).toMatchObject({ title: 'Safe', folderId: 'f1' });
    expect(ids((await loadDocument('safe')).doc)).toEqual([]);
    expect((await listElements()).map((e) => e.id)).toEqual(['e1']);
    // The edit kept here goes up too, though what sync knew was forgotten.
    expect(drive.names()).toContain('n.edited.log.here.1-1.json');
    vi.unstubAllGlobals();
  });
});
