import type { DocEvent } from '../core/ops';
import type { DocumentStore } from '../core/store';
import { appendEvents, compact } from './db';
import { deckSummary } from '../core/study';

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
    } catch (err) {
      console.error('Failed to persist events', err);
      this.queue.unshift(...batch); // keep them; retry on next flush
      this.setStatus('error');
    }
  }

  async dispose(): Promise<void> {
    await this.flush();
    this.unsubscribe();
  }
}
