import type { NotebookDoc, NotebookMeta } from '../core/model';
import { replay, type DocEvent } from '../core/ops';

/**
 * Local-first, event-sourced storage in IndexedDB.
 *
 *  meta       NotebookMeta projection for the library grid
 *  events     append-only op log, key [docId, seq]
 *  snapshots  periodic materialised doc + the seq it reflects (log compaction)
 *
 * Loading a notebook = latest snapshot + replay of events after its seq.
 */

const DB_NAME = 'jnotes';
const DB_VERSION = 1;

interface Snapshot {
  docId: string;
  seq: number;
  doc: NotebookDoc;
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
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('meta', { keyPath: 'id' });
      db.createObjectStore('events', { keyPath: ['docId', 'seq'] });
      db.createObjectStore('snapshots', { keyPath: 'docId' });
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

export async function listNotebooks(): Promise<NotebookMeta[]> {
  const db = await openDb();
  const all = await req(db.transaction('meta').objectStore('meta').getAll() as IDBRequest<NotebookMeta[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getMeta(id: string): Promise<NotebookMeta | undefined> {
  const db = await openDb();
  return req(db.transaction('meta').objectStore('meta').get(id) as IDBRequest<NotebookMeta | undefined>);
}

export async function createNotebook(meta: NotebookMeta, doc: NotebookDoc): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['meta', 'snapshots'], 'readwrite');
  tx.objectStore('meta').put(meta);
  tx.objectStore('snapshots').put({ docId: doc.id, seq: 0, doc } satisfies Snapshot);
  await done(tx);
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
  const doc = replay(snap.doc, events);
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
  const tx = db.transaction(['meta', 'events', 'snapshots'], 'readwrite');
  tx.objectStore('meta').delete(id);
  tx.objectStore('snapshots').delete(id);
  tx.objectStore('events').delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
  await done(tx);
}
