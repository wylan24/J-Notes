import type { HwrEntry } from '../core/handwriting';
import { normalizeDoc, type Folder, type NotebookDoc, type NotebookMeta, type Page } from '../core/model';
import { planFolderDelete } from '../core/folders';
import type { Session } from '../core/timer';
import type { SavedElement } from '../core/elements';
import { replay, type DocEvent } from '../core/ops';

/**
 * Local-first, event-sourced storage in IndexedDB.
 *
 *  meta       NotebookMeta projection for the library grid
 *  events     append-only op log, key [docId, seq]
 *  snapshots  periodic materialised doc + the seq it reflects (log compaction)
 *  blobs      image and audio bytes, key [docId, id]; page items refer to them by id
 *  sessions   timer and stopwatch history (not tied to a notebook's lifetime)
 *  elements   saved selections shared by all notebooks, each with copies of its photos
 *  folders    library folders (nested by parentId); notebooks point at theirs with meta.folderId
 *  hwr        recognised handwriting, key [docId, key]: the text of each line of ink, by a hash of
 *             the ink (see core/handwriting), so search never runs the model twice on the same line
 *
 * Loading a notebook = latest snapshot + replay of events after its seq.
 */

const DB_NAME = 'jnotes';
const DB_VERSION = 6;

interface Snapshot {
  docId: string;
  seq: number;
  doc: NotebookDoc;
}

/**
 * Binary content stored outside the document, so the op log and snapshots stay small.
 * Bytes are kept as an ArrayBuffer rather than a Blob, which some Safari versions could not store.
 */
export interface StoredBlob {
  docId: string;
  id: string;
  type: string;
  bytes: ArrayBuffer;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (e) => {
      const db = r.result;
      if (e.oldVersion < 1) {
        db.createObjectStore('meta', { keyPath: 'id' });
        db.createObjectStore('events', { keyPath: ['docId', 'seq'] });
        db.createObjectStore('snapshots', { keyPath: 'docId' });
      }
      if (e.oldVersion < 2) db.createObjectStore('blobs', { keyPath: ['docId', 'id'] });
      if (e.oldVersion < 3) db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('endedAt', 'endedAt');
      if (e.oldVersion < 4) db.createObjectStore('elements', { keyPath: 'id' });
      // v5: folders. Existing notebooks have no folderId and so stay at the top level.
      if (e.oldVersion < 5) db.createObjectStore('folders', { keyPath: 'id' });
      // v6: recognised handwriting. Built up again in the background, so nothing to migrate.
      if (e.oldVersion < 6) db.createObjectStore('hwr', { keyPath: ['docId', 'key'] });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

/** Test hook: forget the cached connection (e.g. after swapping fake-indexeddb). */
export function resetDbForTests(): void {
  dbPromise = null;
}

const eventRange = (docId: string, afterSeq = 0) => IDBKeyRange.bound([docId, afterSeq + 1], [docId, Infinity]);
// Every [docId, id] key with this docId: string ids sort below the empty array.
const blobRange = (docId: string) => IDBKeyRange.bound([docId, ''], [docId, []]);

export async function listNotebooks(): Promise<NotebookMeta[]> {
  const db = await openDb();
  const all = await req(db.transaction('meta').objectStore('meta').getAll() as IDBRequest<NotebookMeta[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getMeta(id: string): Promise<NotebookMeta | undefined> {
  const db = await openDb();
  return req(db.transaction('meta').objectStore('meta').get(id) as IDBRequest<NotebookMeta | undefined>);
}

/** Create a notebook, with any blobs its items refer to (from an import), in one transaction. */
export async function createNotebook(meta: NotebookMeta, doc: NotebookDoc, blobs: StoredBlob[] = []): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['meta', 'snapshots', 'blobs'], 'readwrite');
  tx.objectStore('meta').put(meta);
  tx.objectStore('snapshots').put({ docId: doc.id, seq: 0, doc } satisfies Snapshot);
  for (const b of blobs) tx.objectStore('blobs').put({ ...b, docId: doc.id } satisfies StoredBlob);
  await done(tx);
}

export async function putBlob(blob: StoredBlob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put(blob);
  await done(tx);
}

export async function getBlob(docId: string, id: string): Promise<StoredBlob | undefined> {
  const db = await openDb();
  return req(db.transaction('blobs').objectStore('blobs').get([docId, id]) as IDBRequest<StoredBlob | undefined>);
}

/** The notebook's blobs, optionally limited to the given ids (missing ones are skipped). */
export async function getBlobs(docId: string, ids?: Iterable<string>): Promise<StoredBlob[]> {
  const db = await openDb();
  const all = await req(db.transaction('blobs').objectStore('blobs').getAll(blobRange(docId)) as IDBRequest<StoredBlob[]>);
  if (!ids) return all;
  const want = new Set(ids);
  return all.filter((b) => want.has(b.id));
}

export async function updateMeta(id: string, patch: Partial<NotebookMeta>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  const store = tx.objectStore('meta');
  const cur = await req(store.get(id) as IDBRequest<NotebookMeta | undefined>);
  if (cur) store.put({ ...cur, ...patch });
  await done(tx);
}

export async function loadDocument(id: string): Promise<{ doc: NotebookDoc; seq: number; snapshotSeq: number }> {
  const db = await openDb();
  const tx = db.transaction(['snapshots', 'events']);
  const snap = await req(tx.objectStore('snapshots').get(id) as IDBRequest<Snapshot | undefined>);
  if (!snap) throw new Error(`Notebook ${id} not found`);
  const events = await req(tx.objectStore('events').getAll(eventRange(id, snap.seq)) as IDBRequest<DocEvent[]>);
  // Snapshots written before page items existed are normalised; replay handles old page.added events.
  const doc = replay(normalizeDoc(snap.doc), events);
  const seq = events.length ? events[events.length - 1].seq : snap.seq;
  return { doc, seq, snapshotSeq: snap.seq };
}

/** Append events and update the library projection in one transaction. */
export async function appendEvents(docId: string, events: DocEvent[], metaPatch: Partial<NotebookMeta>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['events', 'meta'], 'readwrite');
  const evStore = tx.objectStore('events');
  for (const e of events) evStore.put(e);
  const metaStore = tx.objectStore('meta');
  const cur = await req(metaStore.get(docId) as IDBRequest<NotebookMeta | undefined>);
  if (cur) metaStore.put({ ...cur, ...metaPatch });
  await done(tx);
}

/**
 * Add a page to the end of a notebook that isn't open, with the blobs it refers to, as a logged
 * `page.added` event. Used to move or copy pages between notebooks.
 */
export async function appendPage(docId: string, page: Page, blobs: Pick<StoredBlob, 'id' | 'type' | 'bytes'>[]): Promise<void> {
  const { doc, seq } = await loadDocument(docId);
  const db = await openDb();
  const tx = db.transaction(['events', 'meta', 'blobs'], 'readwrite');
  const event: DocEvent = { docId, seq: seq + 1, ts: Date.now(), op: { type: 'page.added', index: doc.pages.length, page } };
  tx.objectStore('events').put(event);
  for (const b of blobs) tx.objectStore('blobs').put({ ...b, docId } satisfies StoredBlob);
  const metaStore = tx.objectStore('meta');
  const cur = await req(metaStore.get(docId) as IDBRequest<NotebookMeta | undefined>);
  if (cur) metaStore.put({ ...cur, pageCount: doc.pages.length + 1, updatedAt: event.ts });
  await done(tx);
}

/** Write a snapshot at `seq` and drop the events it subsumes. */
export async function compact(docId: string, doc: NotebookDoc, seq: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['events', 'snapshots'], 'readwrite');
  tx.objectStore('snapshots').put({ docId, seq, doc } satisfies Snapshot);
  tx.objectStore('events').delete(IDBKeyRange.bound([docId, 0], [docId, seq]));
  await done(tx);
}

export async function deleteNotebook(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['meta', 'events', 'snapshots', 'blobs', 'hwr'], 'readwrite');
  tx.objectStore('meta').delete(id);
  tx.objectStore('snapshots').delete(id);
  tx.objectStore('blobs').delete(blobRange(id));
  tx.objectStore('hwr').delete(blobRange(id));
  tx.objectStore('events').delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
  await done(tx);
}

// --- Recognised handwriting ----------------------------------------------------------

/** Every recognised line of one notebook. */
export async function hwrEntries(docId: string): Promise<HwrEntry[]> {
  const db = await openDb();
  return req(db.transaction('hwr').objectStore('hwr').getAll(blobRange(docId)) as IDBRequest<HwrEntry[]>);
}

/** Every recognised line in the library, for searching notebooks that aren't open. */
export async function allHwrEntries(): Promise<HwrEntry[]> {
  const db = await openDb();
  return req(db.transaction('hwr').objectStore('hwr').getAll() as IDBRequest<HwrEntry[]>);
}

/** Store recognised lines, and forget lines (by key) that are no longer in the notebook. */
export async function updateHwrEntries(docId: string, put: HwrEntry[], remove: string[] = []): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('hwr', 'readwrite');
  const store = tx.objectStore('hwr');
  for (const e of put) store.put({ ...e, docId });
  for (const key of remove) store.delete([docId, key]);
  await done(tx);
}

/** Forget all recognised text (when recognition is turned off). */
export async function clearHwrEntries(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('hwr', 'readwrite');
  tx.objectStore('hwr').clear();
  await done(tx);
}

// --- Timer history ------------------------------------------------------------------

export async function addSession(session: Session): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('sessions', 'readwrite');
  tx.objectStore('sessions').put(session);
  await done(tx);
}

/** Most recent first. */
export async function listSessions(limit = 100): Promise<Session[]> {
  const db = await openDb();
  const index = db.transaction('sessions').objectStore('sessions').index('endedAt');
  const out: Session[] = [];
  await new Promise<void>((resolve, reject) => {
    const r = index.openCursor(null, 'prev');
    r.onsuccess = () => {
      const c = r.result;
      if (!c || out.length >= limit) return resolve();
      out.push(c.value as Session);
      c.continue();
    };
    r.onerror = () => reject(r.error);
  });
  return out;
}

export async function clearSessions(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('sessions', 'readwrite');
  tx.objectStore('sessions').clear();
  await done(tx);
}

// --- Elements library -----------------------------------------------------------------

export async function saveElement(el: SavedElement): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('elements', 'readwrite');
  tx.objectStore('elements').put(el);
  await done(tx);
}

/** Newest first. */
export async function listElements(): Promise<SavedElement[]> {
  const db = await openDb();
  const all = await req(db.transaction('elements').objectStore('elements').getAll() as IDBRequest<SavedElement[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function renameElement(id: string, name: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('elements', 'readwrite');
  const store = tx.objectStore('elements');
  const cur = await req(store.get(id) as IDBRequest<SavedElement | undefined>);
  if (cur) store.put({ ...cur, name });
  await done(tx);
}

export async function deleteElement(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('elements', 'readwrite');
  tx.objectStore('elements').delete(id);
  await done(tx);
}


// --- Folders ---------------------------------------------------------------------------------

export async function listFolders(): Promise<Folder[]> {
  const db = await openDb();
  return req(db.transaction('folders').objectStore('folders').getAll() as IDBRequest<Folder[]>);
}

/** Create or update a folder. */
export async function putFolder(folder: Folder): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('folders', 'readwrite');
  tx.objectStore('folders').put(folder);
  await done(tx);
}

/** File a notebook in a folder, or at the top level with null. */
export async function moveNotebook(id: string, folderId: string | null): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  const store = tx.objectStore('meta');
  const cur = await req(store.get(id) as IDBRequest<NotebookMeta | undefined>);
  if (cur) {
    const { folderId: _old, ...rest } = cur;
    store.put(folderId ? { ...rest, folderId } : rest);
  }
  await done(tx);
}

/**
 * Delete a folder and its subfolders, moving every notebook inside them to the trash, in one
 * transaction. Returns how many notebooks were trashed.
 */
export async function deleteFolder(id: string): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(['folders', 'meta'], 'readwrite');
  const folders = tx.objectStore('folders');
  const meta = tx.objectStore('meta');
  const [allFolders, allMeta] = await Promise.all([req(folders.getAll() as IDBRequest<Folder[]>), req(meta.getAll() as IDBRequest<NotebookMeta[]>)]);
  const plan = planFolderDelete(allMeta, allFolders, id);
  const now = Date.now();
  for (const f of plan.folderIds) folders.delete(f);
  for (const m of allMeta) {
    if (!plan.trash.includes(m.id)) continue;
    const { folderId: _old, ...rest } = m;
    meta.put({ ...rest, trashedAt: m.trashedAt ?? now });
  }
  await done(tx);
  return plan.trash.length;
}
