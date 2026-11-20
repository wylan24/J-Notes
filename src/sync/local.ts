// The sync engine's view of this device's storage: IndexedDB, plus the notebooks open on screen.
import {
  applyMerged,
  blobIds,
  createNotebook,
  deletedSyncDocs,
  deleteNotebook,
  eventsAfter,
  forgetSyncDocs,
  getBlob,
  getSyncDoc,
  getSyncFile,
  listNotebooks,
  loadDocument,
  putBlob,
  putSyncDoc,
  putSyncFile,
} from '../storage/db';
import { openPersisters } from '../storage/persister';
import type { LocalNotebooks, SyncRecord } from './engine';

export const localNotebooks: LocalNotebooks = {
  list: listNotebooks,

  async state(docId) {
    const open = openPersisters.get(docId);
    if (open) return open.state;
    const { doc, seq } = await loadDocument(docId);
    return { doc, seq };
  },

  async editsAfter(docId, seq) {
    // An open notebook's latest edits may not be saved yet.
    await openPersisters.get(docId)?.flush();
    return eventsAfter(docId, seq);
  },

  async record(docId) {
    const r = await getSyncDoc(docId);
    return r && 'uploaded' in r ? r : undefined;
  },
  setRecord: (rec: SyncRecord) => putSyncDoc(rec),

  blobIds,
  async readBlob(docId, id) {
    const b = await getBlob(docId, id);
    return b && { type: b.type, bytes: b.bytes };
  },
  writeBlob: (docId, id, type, bytes) => putBlob({ docId, id, type, bytes }),

  async apply(docId, doc, uploaded) {
    const open = openPersisters.get(docId);
    if (open) await open.rebase(doc, uploaded);
    else await applyMerged(docId, doc, uploaded);
  },

  create: (meta, doc, seq) => createNotebook(meta, doc, [], seq),

  async remove(docId) {
    // Deleted on another device. If it is open here, it goes at the next sync after it closes.
    if (openPersisters.has(docId)) throw new Error('Deleted on another device; open here');
    await deleteNotebook(docId);
    await forgetSyncDocs([docId]);
  },

  deleted: deletedSyncDocs,
  forgetDeleted: forgetSyncDocs,
  cached: getSyncFile,
  cache: putSyncFile,
};
