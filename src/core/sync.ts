// Syncing notebooks between devices through files in the person's Google Drive app data folder.
// Pure: what the files are called, and how a notebook's state is worked out from them. The
// sync engine (src/sync/engine.ts) moves the files; this decides what they mean.
//
// The model:
// - Each device uploads its own edits (the ops it logged) as numbered batches. A batch is never
//   changed once written, and only the device that made the edits writes it, so devices never
//   overwrite each other.
// - Every device works out the notebook the same way: start from a snapshot, then apply every
//   edit the snapshot doesn't include, in one agreed order. Same files in, same notebook out.
// - The order is a Lamport clock (`lc`), ties broken by device then seq. A device gives its edits
//   clock values above every edit it has already seen, so an edit made after seeing another
//   device's change always comes after it. Ops address strokes, items and pages by id, so edits
//   made at the same time on two devices both survive.
// - Snapshots keep this quick: now and then a device writes the notebook it worked out, with how
//   far into each device's edits it reaches (a version vector). Everyone starts from the same
//   snapshot, the one reaching furthest, so they still agree.
import { applyOp, type DocEvent, type DocOp } from './ops';
import { normalizeDoc, type NotebookDoc, type NotebookMeta } from './model';

/** How far into each device's edits something reaches: device id → last seq included. */
export type Vector = Record<string, number>;

/** One edit as uploaded: the device's own seq for it, its place in the shared order, and the op. */
export interface SyncedEvent {
  seq: number;
  lc: number;
  ts: number;
  op: DocOp;
}

/** A file of one device's consecutive edits. */
export interface Batch {
  device: string;
  events: SyncedEvent[];
}

/** A notebook as worked out by one device, and what it includes. */
export interface SnapshotFile {
  device: string;
  vector: Vector;
  /** The highest clock value of any edit it includes. */
  lc: number;
  doc: NotebookDoc;
}

/** What is uploaded about a notebook for the library: everything but the thumbnail and quick-note flag. */
export type SyncedMeta = Omit<NotebookMeta, 'thumbnail' | 'quicknote'>;

// --- File names ------------------------------------------------------------------------------
// Everything is flat in the app data folder, named so that one listing describes every notebook.

const ID = '[a-z0-9]+';
export const fileNames = {
  meta: (docId: string) => `n.${docId}.meta.json`,
  snapshot: (docId: string, device: string) => `n.${docId}.snap.${device}.json`,
  batch: (docId: string, device: string, from: number, to: number) => `n.${docId}.log.${device}.${from}-${to}.json`,
  blob: (docId: string, blobId: string) => `n.${docId}.blob.${blobId}`,
  /** Left behind when a notebook is deleted, so other devices delete it too instead of uploading it again. */
  deleted: (docId: string) => `n.${docId}.deleted`,
};

export type SyncFile =
  | { kind: 'meta'; docId: string }
  | { kind: 'snapshot'; docId: string; device: string }
  | { kind: 'batch'; docId: string; device: string; from: number; to: number }
  | { kind: 'blob'; docId: string; blobId: string }
  | { kind: 'deleted'; docId: string };

const PATTERNS: [RegExp, (m: RegExpMatchArray) => SyncFile][] = [
  [new RegExp(`^n\\.(${ID})\\.meta\\.json$`), (m) => ({ kind: 'meta', docId: m[1] })],
  [new RegExp(`^n\\.(${ID})\\.snap\\.(${ID})\\.json$`), (m) => ({ kind: 'snapshot', docId: m[1], device: m[2] })],
  [new RegExp(`^n\\.(${ID})\\.log\\.(${ID})\\.(\\d+)-(\\d+)\\.json$`), (m) => ({ kind: 'batch', docId: m[1], device: m[2], from: Number(m[3]), to: Number(m[4]) })],
  [new RegExp(`^n\\.(${ID})\\.blob\\.([\\w-]+)$`), (m) => ({ kind: 'blob', docId: m[1], blobId: m[2] })],
  [new RegExp(`^n\\.(${ID})\\.deleted$`), (m) => ({ kind: 'deleted', docId: m[1] })],
];

/** What a file in the app data folder is, or null if it isn't one of the app's. */
export function parseFileName(name: string): SyncFile | null {
  for (const [re, make] of PATTERNS) {
    const m = name.match(re);
    if (m) return make(m);
  }
  return null;
}

// --- Working out a notebook ------------------------------------------------------------------

const vectorSize = (v: Vector) => Object.values(v).reduce((a, b) => a + b, 0);

/** The snapshot everyone starts from: the one that includes the most edits (ties: lowest device id). */
export function chooseBase(snapshots: readonly SnapshotFile[]): SnapshotFile | null {
  let best: SnapshotFile | null = null;
  for (const s of snapshots) {
    if (!best) best = s;
    else {
      const d = vectorSize(s.vector) - vectorSize(best.vector);
      if (d > 0 || (d === 0 && s.device < best.device)) best = s;
    }
  }
  return best;
}

export interface Ordered extends SyncedEvent {
  device: string;
}

/**
 * Each device's edits after `from`, stopping at the first gap: an edit is only applied once every
 * earlier edit from its device is, so a batch that isn't listed yet can't be skipped over.
 */
export function editsAfter(batches: readonly Batch[], from: Vector): Ordered[] {
  const byDevice = new Map<string, Map<number, SyncedEvent>>();
  for (const b of batches) {
    let m = byDevice.get(b.device);
    if (!m) byDevice.set(b.device, (m = new Map()));
    for (const e of b.events) m.set(e.seq, e);
  }
  const out: Ordered[] = [];
  for (const [device, events] of byDevice) {
    for (let seq = (from[device] ?? 0) + 1; events.has(seq); seq++) out.push({ ...events.get(seq)!, device });
  }
  return out.sort(compareEdits);
}

/** The agreed order: clock, then device, then the device's own order. */
export function compareEdits(a: Ordered, b: Ordered): number {
  return a.lc - b.lc || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0) || a.seq - b.seq;
}

export interface Merged {
  doc: NotebookDoc;
  /** How far into each device's edits `doc` reaches. */
  vector: Vector;
  /** The highest clock value in `doc`. */
  lc: number;
  /** Edits applied on top of the snapshot: when there are many, it is time for a new snapshot. */
  sinceSnapshot: number;
}

/** The notebook from its files, or null when there is no snapshot to start from. */
export function mergeNotebook(snapshots: readonly SnapshotFile[], batches: readonly Batch[]): Merged | null {
  const base = chooseBase(snapshots);
  if (!base) return null;
  const edits = editsAfter(batches, base.vector);
  const vector = { ...base.vector };
  let doc = normalizeDoc(base.doc);
  let lc = base.lc;
  for (const e of edits) {
    doc = applyOp(doc, e.op);
    vector[e.device] = e.seq;
    lc = Math.max(lc, e.lc);
  }
  return { doc, vector, lc, sinceSnapshot: edits.length };
}

/** The highest clock value anywhere in these files: new edits are numbered above it. */
export function highestClock(snapshots: readonly SnapshotFile[], batches: readonly Batch[]): number {
  let lc = 0;
  for (const s of snapshots) lc = Math.max(lc, s.lc);
  for (const b of batches) for (const e of b.events) lc = Math.max(lc, e.lc);
  return lc;
}

/** The last of this device's edits found in the files (a device numbers its edits from 1). */
export function lastUploaded(device: string, snapshots: readonly SnapshotFile[], batches: readonly Batch[]): number {
  let seq = 0;
  for (const s of snapshots) seq = Math.max(seq, s.vector[device] ?? 0);
  for (const b of batches) if (b.device === device) for (const e of b.events) seq = Math.max(seq, e.seq);
  return seq;
}

/** This device's new edits, numbered into the shared order after everything it has seen. */
export function stampEdits(events: readonly DocEvent[], seenClock: number): SyncedEvent[] {
  return [...events].sort((a, b) => a.seq - b.seq).map((e, i) => ({ seq: e.seq, lc: seenClock + 1 + i, ts: e.ts, op: e.op }));
}

/** The library entry to upload: without what only makes sense on this device. */
export function syncedMeta(meta: NotebookMeta): SyncedMeta {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { thumbnail, quicknote, ...rest } = meta;
  return rest;
}

