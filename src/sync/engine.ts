// One round of syncing notebooks with Drive: upload this device's new edits and pictures, fetch
// everyone else's, work out each notebook (core/sync) and hand it to local storage. Drive and
// local storage come in as interfaces, so tests run two devices against a fake Drive.
import type { DocEvent } from '../core/ops';
import type { NotebookDoc, NotebookMeta } from '../core/model';
import {
  fileNames,
  highestClock,
  lastUploaded,
  mergeNotebook,
  parseFileName,
  stampEdits,
  syncedMeta,
  type Batch,
  type SnapshotFile,
  type SyncedMeta,
  type Vector,
} from '../core/sync';
import { DriveAuthError, jsonBlob, readJson, type Drive, type DriveFile } from './drive';

/** What this device knows about a notebook's sync. */
export interface SyncRecord {
  docId: string;
  /** This device's edits up to this seq are in Drive. */
  uploaded: number;
  /** How far the local notebook reaches into each device's edits, as of the last sync. */
  vector: Vector;
}

/** The device's own storage, as the engine needs it. */
export interface LocalNotebooks {
  list(): Promise<NotebookMeta[]>;
  /** The notebook as it is here, and the seq of this device's last edit to it. */
  state(docId: string): Promise<{ doc: NotebookDoc; seq: number }>;
  /** This device's edits after `seq`, oldest first. */
  editsAfter(docId: string, seq: number): Promise<DocEvent[]>;
  record(docId: string): Promise<SyncRecord | undefined>;
  setRecord(rec: SyncRecord): Promise<void>;
  blobIds(docId: string): Promise<string[]>;
  readBlob(docId: string, id: string): Promise<{ type: string; bytes: ArrayBuffer } | undefined>;
  writeBlob(docId: string, id: string, type: string, bytes: ArrayBuffer): Promise<void>;
  /** Make the notebook `doc` plus this device's own edits after `uploaded`. */
  apply(docId: string, doc: NotebookDoc, uploaded: number): Promise<void>;
  /** Add a notebook that came from Drive; this device's next edit to it is numbered after `seq`. */
  create(meta: NotebookMeta, doc: NotebookDoc, seq: number): Promise<void>;
  remove(docId: string): Promise<void>;
  /** Notebooks deleted on this device since the last sync. */
  deleted(): Promise<string[]>;
  forgetDeleted(ids: string[]): Promise<void>;
  /** Files already downloaded, by name and version. */
  cached<T>(name: string, version: string): Promise<T | undefined>;
  cache(name: string, version: string, value: unknown): Promise<void>;
}

export interface SyncResult {
  /** Notebooks changed, added or removed on this device. */
  changed: string[];
  /** Notebooks that could not be synced, with why. */
  failed: { docId: string; error: string }[];
}

/** Edits applied on top of a snapshot before a device writes a new one. */
const SNAPSHOT_EVERY = 200;

interface DriveNotebook {
  meta?: DriveFile;
  deleted?: DriveFile;
  snapshots: (DriveFile & { device: string })[];
  batches: DriveFile[];
  blobs: Map<string, DriveFile>;
  all: DriveFile[];
}

function groupFiles(files: DriveFile[]): Map<string, DriveNotebook> {
  const out = new Map<string, DriveNotebook>();
  for (const f of files) {
    const p = parseFileName(f.name);
    if (!p) continue;
    let g = out.get(p.docId);
    if (!g) out.set(p.docId, (g = { snapshots: [], batches: [], blobs: new Map(), all: [] }));
    g.all.push(f);
    if (p.kind === 'meta') g.meta = f;
    else if (p.kind === 'deleted') g.deleted = f;
    else if (p.kind === 'snapshot') g.snapshots.push({ ...f, device: p.device });
    else if (p.kind === 'batch') {
      // A retried upload can leave two files with the same name and content.
      if (!g.batches.some((b) => b.name === f.name)) g.batches.push(f);
    } else g.blobs.set(p.blobId, f);
  }
  return out;
}

export async function syncNotebooks(o: {
  drive: Drive;
  local: LocalNotebooks;
  device: string;
  only?: string;
  snapshotEvery?: number;
  /** The folder's listing, if already fetched. */
  files?: DriveFile[];
}): Promise<SyncResult> {
  const { drive, local, device } = o;
  const snapshotEvery = o.snapshotEvery ?? SNAPSHOT_EVERY;
  const result: SyncResult = { changed: [], failed: [] };
  const groups = groupFiles(o.files ?? (await drive.list()));
  const metas = new Map((await local.list()).map((m) => [m.id, m]));

  /** A JSON file, from the cache when this version was downloaded before. */
  const json = async <T>(f: DriveFile): Promise<T> => {
    const hit = await local.cached<T>(f.name, f.modifiedTime);
    if (hit !== undefined) return hit;
    const v = await readJson<T>(drive, f.id);
    await local.cache(f.name, f.modifiedTime, v);
    return v;
  };

  // Notebooks deleted here: leave a marker so other devices delete them too, then clear them out.
  const deleted = await local.deleted();
  for (const id of deleted) {
    const g = groups.get(id);
    if (g && !g.deleted) {
      g.deleted = await drive.create(fileNames.deleted(id), new Blob([]));
      for (const f of g.all) await drive.remove(f.id);
    }
  }
  if (deleted.length) await local.forgetDeleted(deleted);

  async function syncOne(id: string, g: DriveNotebook | undefined, meta: NotebookMeta | undefined): Promise<boolean> {
    if (g?.deleted) {
      if (!meta) return false;
      await local.remove(id);
      return true;
    }
    const snapshots = g ? await Promise.all(g.snapshots.map((f) => json<SnapshotFile>(f))) : [];
    const batches = g ? await Promise.all(g.batches.map((f) => json<Batch>(f))) : [];

    // Only in Drive: made on another device.
    if (!meta) {
      const merged = mergeNotebook(snapshots, batches);
      if (!g?.meta || !merged) return false; // still being uploaded
      const m = await json<SyncedMeta>(g.meta);
      for (const [blobId, f] of g.blobs) await local.writeBlob(id, blobId, f.mimeType ?? '', await drive.read(f.id));
      const seq = lastUploaded(device, snapshots, batches);
      await local.create({ ...m, id, updatedAt: Date.now() }, merged.doc, seq);
      await local.setRecord({ docId: id, uploaded: seq, vector: merged.vector });
      return true;
    }

    const uploadBlobs = async () => {
      for (const blobId of await local.blobIds(id)) {
        if (g?.blobs.has(blobId)) continue;
        const b = await local.readBlob(id, blobId);
        if (b) await drive.create(fileNames.blob(id, blobId), new Blob([b.bytes], { type: b.type }));
      }
    };
    const writeSnapshot = async (snap: SnapshotFile) => {
      const own = g?.snapshots.find((s) => s.device === device);
      const body = jsonBlob(snap);
      const f = own ? await drive.update(own.id, body) : await drive.create(fileNames.snapshot(id, device), body);
      await local.cache(f.name, f.modifiedTime, snap);
    };

    // Only here: the first upload. Its snapshot holds everything so far.
    if (!snapshots.length) {
      const { doc, seq } = await local.state(id);
      await uploadBlobs();
      await writeSnapshot({ device, vector: { [device]: seq }, lc: 0, doc });
      if (!g?.meta) await drive.create(fileNames.meta(id), jsonBlob(syncedMeta(meta)));
      await local.setRecord({ docId: id, uploaded: seq, vector: { [device]: seq } });
      return false;
    }

    const rec = await local.record(id);
    let uploaded = rec?.uploaded ?? lastUploaded(device, snapshots, batches);
    await uploadBlobs();
    const pending = await local.editsAfter(id, uploaded);
    if (pending.length && pending[0].seq !== uploaded + 1) {
      // Some of this device's edits were lost before they were uploaded (which shouldn't happen).
      // Its notebook still holds them, so upload the whole notebook as a snapshot that covers them.
      const { doc, seq } = await local.state(id);
      const vector = { ...(rec?.vector ?? {}), [device]: seq };
      await writeSnapshot({ device, vector, lc: highestClock(snapshots, batches), doc });
      snapshots.push({ device, vector, lc: highestClock(snapshots, batches), doc });
      uploaded = seq;
      await local.setRecord({ docId: id, uploaded, vector });
    } else if (pending.length) {
      const events = stampEdits(pending, highestClock(snapshots, batches));
      const batch: Batch = { device, events };
      const f = await drive.create(fileNames.batch(id, device, events[0].seq, events[events.length - 1].seq), jsonBlob(batch));
      await local.cache(f.name, f.modifiedTime, batch);
      batches.push(batch);
      uploaded = events[events.length - 1].seq;
      // Straight away, so a sync cut short here doesn't upload the same edits again.
      await local.setRecord({ docId: id, uploaded, vector: rec?.vector ?? {} });
    }

    if (g) {
      const have = new Set(await local.blobIds(id));
      for (const [blobId, f] of g.blobs) if (!have.has(blobId)) await local.writeBlob(id, blobId, f.mimeType ?? '', await drive.read(f.id));
    }

    const merged = mergeNotebook(snapshots, batches)!;
    const changedHere = JSON.stringify(merged.vector) !== JSON.stringify({ ...(rec?.vector ?? {}), [device]: uploaded });
    await local.apply(id, merged.doc, uploaded);
    await local.setRecord({ docId: id, uploaded, vector: merged.vector });
    if (merged.sinceSnapshot >= snapshotEvery) await writeSnapshot({ device, vector: merged.vector, lc: merged.lc, doc: merged.doc });
    if (!g?.meta) await drive.create(fileNames.meta(id), jsonBlob(syncedMeta(meta)));
    return changedHere;
  }

  const ids = new Set<string>();
  for (const [id, m] of metas) if (!m.quicknote) ids.add(id); // a quick note syncs once it is kept
  for (const id of groups.keys()) if (!deleted.includes(id)) ids.add(id);
  for (const id of ids) {
    if (o.only && id !== o.only) continue;
    try {
      if (await syncOne(id, groups.get(id), metas.get(id))) result.changed.push(id);
    } catch (e) {
      if (e instanceof DriveAuthError) throw e;
      result.failed.push({ docId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
