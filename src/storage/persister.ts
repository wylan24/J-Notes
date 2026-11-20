import { replay, type DocEvent } from '../core/ops';
import type { NotebookDoc } from '../core/model';
import type { DocumentStore } from '../core/store';
import { appendEvents, compact, eventsAfter } from './db';
import { deckSummary } from '../core/study';

/** What sync wants to hear about open notebooks: opened, saved after an edit, closed. */
export interface PersisterHooks {
  opened(docId: string): void;
  saved(docId: string): void;
  closed(docId: string): void;
}
let hooks: PersisterHooks | null = null;
export const setPersisterHooks = (h: PersisterHooks | null): void => void (hooks = h);

/** The persister of each open notebook, so sync can bring in changes from other devices. */
export const openPersisters = new Map<string, Persister>();

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

const FLUSH_DELAY_MS = 300;
const COMPACT_EVERY = 250;

/**
 * Batches events from the store and writes them to IndexedDB off the input
 * path, so drawing never waits on storage. Flushes are serialised through a
 * promise chain so events always land in seq order.
 */
export class Persister {
  private queue: DocEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private unsubscribe: () => void;
  private statusListeners = new Set<(s: SaveStatus) => void>();
  status: SaveStatus = 'saved';

  constructor(
    private store: DocumentStore,
    private snapshotSeq: number,
    private afterFlush?: () => void,
  ) {
    this.unsubscribe = store.onEvents((events) => {
      this.queue.push(...events);
      this.setStatus('pending');
      this.schedule();
    });
    openPersisters.set(store.doc.id, this);
    hooks?.opened(store.doc.id);
  }

  /** The notebook open here, and the seq of its last edit (saved or not). */
  get state(): { doc: NotebookDoc; seq: number } {
    return { doc: this.store.doc, seq: this.store.seq };
  }

  /**
   * Bring in the notebook as worked out by sync (`merged`) and put this device's edits after
   * `uploaded` back on top, including any made while the sync ran. Runs in turn with saving, so
   * no save happens halfway through.
   */
  rebase(merged: NotebookDoc, uploaded: number): Promise<void> {
    const docId = this.store.doc.id;
    this.chain = this.chain.then(async () => {
      const saved = await eventsAfter(docId, uploaded);
      // Read the queue only now: edits made while the saved ones loaded are in it.
      const unsaved = this.queue.filter((e) => e.seq > uploaded && !saved.some((s) => s.seq === e.seq));
      this.store.replaceDoc(replay(merged, [...saved, ...unsaved]));
      // A snapshot of exactly what is on screen, at the latest seq (unsaved edits included: they
      // are saved next, after it, and so aren't replayed twice).
      const seq = this.store.seq;
      await compact(docId, this.store.doc, seq);
      this.snapshotSeq = seq;
    });
    return this.chain;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
  }

  private setStatus(s: SaveStatus): void {
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  onStatus(fn: (s: SaveStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.chain = this.chain.then(() => this.write());
    return this.chain;
  }

  private async write(): Promise<void> {
    if (!this.queue.length) return;
    const batch = this.queue.splice(0);
    const docId = batch[0].docId;
    this.setStatus('saving');
    try {
      const { pages, cards } = this.store.doc;
      // A study set's library card shows how many cards it has and how many are due.
      await appendEvents(docId, batch, { updatedAt: Date.now(), pageCount: pages.length, ...(cards ? { deck: deckSummary(cards) } : {}) });
      // Only snapshot when nothing is queued, so store.doc matches the log exactly at store.seq.
      if (!this.queue.length && this.store.seq - this.snapshotSeq >= COMPACT_EVERY) {
        await compact(docId, this.store.doc, this.store.seq);
        this.snapshotSeq = this.store.seq;
      }
      this.setStatus(this.queue.length ? 'pending' : 'saved');
      this.afterFlush?.();
      hooks?.saved(docId);
    } catch (err) {
      console.error('Failed to persist events', err);
      this.queue.unshift(...batch); // keep them; retry on next flush
      this.setStatus('error');
    }
  }

  async dispose(): Promise<void> {
    await this.flush();
    this.unsubscribe();
    const docId = this.store.doc.id;
    if (openPersisters.get(docId) === this) {
      openPersisters.delete(docId);
      hooks?.closed(docId);
    }
  }
}
