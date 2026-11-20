// The sync engine's view of this device's storage: IndexedDB, plus the notebooks open on screen.
import { keys, parseKey, SYNCED_META_FIELDS, SYNCED_SETTINGS, type Entry } from '../core/librarySync';
import type { Folder } from '../core/model';
import type { SavedElement } from '../core/elements';
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
  listElements,
  listFolders,
  loadDocument,
  putFolder,
  removeFolderRecord,
  renameElement,
  deleteElement,
  saveElement,
  updateMeta,
  putBlob,
  putSyncDoc,
  putSyncFile,
} from '../storage/db';
import { openPersisters } from '../storage/persister';
import type { LocalNotebooks, SyncRecord } from './engine';
import type { LocalLibrary } from './library';

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

const LEDGER = 'ledger:library';

function readSetting(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } catch {
    return undefined;
  }
}

export const localLibrary: LocalLibrary = {
  async values() {
    const out = new Map<string, unknown>();
    // A quick note isn't synced until it is kept.
    for (const m of await listNotebooks()) if (!m.quicknote) for (const f of SYNCED_META_FIELDS) out.set(keys.meta(m.id, f), m[f] ?? null);
    for (const f of await listFolders()) out.set(keys.folder(f.id), f);
    for (const e of await listElements()) out.set(keys.element(e.id), { name: e.name, createdAt: e.createdAt });
    for (const k of SYNCED_SETTINGS) {
      const v = readSetting(k);
      if (v !== undefined) out.set(keys.setting(k), v);
    }
    return out;
  },

  async set(key, v) {
    const p = parseKey(key);
    if (!p) return;
    if (p.kind === 'meta') await updateMeta(p.docId, { [p.field]: p.field === 'trashedAt' ? v : (v ?? undefined) });
    else if (p.kind === 'folder') await (v === null ? removeFolderRecord(p.id) : putFolder(v as Folder));
    else if (p.kind === 'element') await (v === null ? deleteElement(p.id) : renameElement(p.id, (v as { name: string }).name));
    else {
      try {
        if (v === null) localStorage.removeItem(p.key);
        else localStorage.setItem(p.key, JSON.stringify(v));
      } catch {
        // Not saved here; synced again next time.
      }
    }
  },

  async ledger() {
    const saved = await getSyncFile<[string, Entry][]>(LEDGER, 'local');
    return new Map(saved ?? []);
  },
  setLedger: (ledger) => putSyncFile(LEDGER, 'local', [...ledger]),

  async element(id) {
    return (await listElements()).find((e) => e.id === id);
  },
  addElement: (el: SavedElement) => saveElement(el),
  cached: getSyncFile,
  cache: putSyncFile,
};
