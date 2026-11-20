// Test doubles for sync: Drive in memory, and devices whose storage works like IndexedDB's
// (a snapshot plus the device's own edit log).
import { applyOp, replay, type DocEvent, type DocOp } from '../src/core/ops';
import type { NotebookDoc, NotebookMeta, Stroke } from '../src/core/model';
import { DriveAuthError, type Drive, type DriveFile } from '../src/sync/drive';
import { syncNotebooks, type LocalNotebooks, type SyncRecord } from '../src/sync/engine';

export class FakeDrive implements Drive {
  files = new Map<string, { file: DriveFile; bytes: ArrayBuffer }>();
  private n = 0;
  private clock = 0;
  online = true;
  calls = { create: 0, update: 0, read: 0, remove: 0 };

  private check() {
    if (!this.online) throw new Error('offline');
  }
  async list() {
    this.check();
    return [...this.files.values()].map((f) => f.file);
  }
  async read(id: string) {
    this.check();
    this.calls.read++;
    const f = this.files.get(id);
    if (!f) throw new Error(`no file ${id}`);
    return f.bytes.slice(0);
  }
  async create(name: string, body: Blob) {
    this.check();
    this.calls.create++;
    const file = { id: `f${++this.n}`, name, modifiedTime: String(++this.clock), mimeType: body.type };
    this.files.set(file.id, { file, bytes: await body.arrayBuffer() });
    return file;
  }
  async update(id: string, body: Blob) {
    this.check();
    this.calls.update++;
    const f = this.files.get(id)!;
    f.file = { ...f.file, modifiedTime: String(++this.clock), mimeType: body.type };
    f.bytes = await body.arrayBuffer();
    return f.file;
  }
  async remove(id: string) {
    this.check();
    this.calls.remove++;
    this.files.delete(id);
  }
  names() {
    return [...this.files.values()].map((f) => f.file.name).sort();
  }
}

/** A drive whose token has expired. */
export class ExpiredDrive extends FakeDrive {
  override async list(): Promise<DriveFile[]> {
    throw new DriveAuthError('expired');
  }
}

interface Book {
  meta: NotebookMeta;
  snapDoc: NotebookDoc;
  snapSeq: number;
  /** This device's own edits, kept until uploaded (like IndexedDB's events store). */
  events: DocEvent[];
  seq: number;
  blobs: Map<string, { type: string; bytes: ArrayBuffer }>;
}

export class Device implements LocalNotebooks {
  books = new Map<string, Book>();
  records = new Map<string, SyncRecord>();
  deletedIds: string[] = [];
  fileCache = new Map<string, { version: string; value: unknown }>();

  constructor(
    readonly id: string,
    readonly drive: Drive,
  ) {}

  sync(only?: string, snapshotEvery?: number) {
    return syncNotebooks({ drive: this.drive, local: this, device: this.id, only, snapshotEvery });
  }

  // --- Making and editing notebooks, as the app does ---

  newNotebook(docId: string, doc: Omit<NotebookDoc, 'id'> = { pages: [{ id: 'p1', template: 'blank', strokes: [], items: [] }] }) {
    const full = { ...doc, id: docId } as NotebookDoc;
    this.books.set(docId, {
      meta: { id: docId, title: `Notebook ${docId}`, cover: '#333', template: 'blank', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: full.pages.length },
      snapDoc: full,
      snapSeq: 0,
      events: [],
      seq: 0,
      blobs: new Map(),
    });
  }

  edit(docId: string, ...ops: DocOp[]) {
    const b = this.books.get(docId)!;
    for (const op of ops) b.events.push({ docId, seq: ++b.seq, ts: Date.now(), op });
  }

  draw(docId: string, pageId: string, ...ids: string[]) {
    this.edit(docId, { type: 'strokes.added', pageId, strokes: ids.map(stroke) });
  }

  doc(docId: string): NotebookDoc {
    const b = this.books.get(docId)!;
    return replay(b.snapDoc, b.events.filter((e) => e.seq > b.snapSeq));
  }

  strokeIds(docId: string, pageId = 'p1'): string[] {
    return this.doc(docId).pages.find((p) => p.id === pageId)?.strokes.map((s) => s.id) ?? [];
  }

  deleteNotebook(docId: string) {
    this.books.delete(docId);
    this.records.delete(docId);
    this.deletedIds.push(docId);
  }

  // --- LocalNotebooks ---

  async list() {
    return [...this.books.values()].map((b) => b.meta);
  }
  async state(docId: string) {
    return { doc: this.doc(docId), seq: this.books.get(docId)!.seq };
  }
  async editsAfter(docId: string, seq: number) {
    return this.books.get(docId)!.events.filter((e) => e.seq > seq);
  }
  async record(docId: string) {
    return this.records.get(docId);
  }
  async setRecord(rec: SyncRecord) {
    this.records.set(rec.docId, rec);
    // Like compaction: edits already in Drive need not be kept.
    const b = this.books.get(rec.docId);
    if (b) b.events = b.events.filter((e) => e.seq > Math.min(rec.uploaded, b.snapSeq));
  }
  async blobIds(docId: string) {
    return [...this.books.get(docId)!.blobs.keys()];
  }
  async readBlob(docId: string, id: string) {
    return this.books.get(docId)?.blobs.get(id);
  }
  async writeBlob(docId: string, id: string, type: string, bytes: ArrayBuffer) {
    let b = this.books.get(docId);
    if (!b) {
      // Downloading a new notebook's blobs before the notebook itself.
      this.pendingBlobs.set(`${docId}/${id}`, { type, bytes });
      return;
    }
    b.blobs.set(id, { type, bytes });
  }
  private pendingBlobs = new Map<string, { type: string; bytes: ArrayBuffer }>();
  async apply(docId: string, doc: NotebookDoc, uploaded: number) {
    const b = this.books.get(docId)!;
    const later = b.events.filter((e) => e.seq > uploaded);
    b.snapDoc = later.reduce((d, e) => applyOp(d, e.op), doc);
    b.snapSeq = b.seq;
  }
  async create(meta: NotebookMeta, doc: NotebookDoc, seq: number) {
    const blobs = new Map<string, { type: string; bytes: ArrayBuffer }>();
    for (const [k, v] of this.pendingBlobs) if (k.startsWith(`${meta.id}/`)) blobs.set(k.slice(meta.id.length + 1), v);
    this.books.set(meta.id, { meta, snapDoc: doc, snapSeq: seq, events: [], seq, blobs });
  }
  async remove(docId: string) {
    this.books.delete(docId);
    this.records.delete(docId);
  }
  async deleted() {
    return [...this.deletedIds];
  }
  async forgetDeleted(ids: string[]) {
    this.deletedIds = this.deletedIds.filter((d) => !ids.includes(d));
  }
  async cached<T>(name: string, version: string) {
    const c = this.fileCache.get(name);
    return c && c.version === version ? (structuredClone(c.value) as T) : undefined;
  }
  async cache(name: string, version: string, value: unknown) {
    this.fileCache.set(name, { version, value: structuredClone(value) });
  }
}

export const stroke = (id: string): Stroke => ({ id, tool: 'pen', color: '#000', width: 2, simulatePressure: false, points: [{ x: 1, y: 1, p: 0.5 }, { x: 2, y: 2, p: 0.5 }] });
