import type { NotebookDoc } from './model';
import { applyOp, inverseOp, type DocEvent, type DocOp } from './ops';
import { applyWithFollowUps } from './connectors';
import { activeLayerId, placeOnActiveLayers } from './layers';

const MAX_UNDO = 200;

type Record = 'do' | 'undo' | 'redo';

/**
 * Owns the in-memory document. All mutations go through `dispatch`, which
 *  1. applies ops through the pure reducer,
 *  2. records the inverse group for undo/redo,
 *  3. stamps ops as sequenced events and hands them to persistence.
 */
export class DocumentStore {
  doc: NotebookDoc;
  seq: number;
  private undoStack: DocOp[][] = [];
  private redoStack: DocOp[][] = [];
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(events: DocEvent[]) => void>();
  /** Bumps on every change; lets React subscribe to undo/redo availability. */
  version = 0;
  /** The layer chosen on each page (page id → layer id); pages not listed use their top layer. */
  private activeLayers = new Map<string, string>();

  constructor(doc: NotebookDoc, seq = 0) {
    this.doc = doc;
    this.seq = seq;
  }

  dispatch(ops: DocOp[], record: Record = 'do'): void {
    if (!ops.length) return;
    let next = this.doc;
    if (record === 'do') {
      // New content goes on its page's active layer.
      ops = placeOnActiveLayers(next, ops, (pageId) => this.activeLayers.get(pageId));
      // Connectors follow the items they are attached to, in the same undo step. Undo and redo
      // replay a recorded group, which already holds those updates.
      ({ doc: next, ops } = applyWithFollowUps(next, ops));
    } else {
      for (const op of ops) next = applyOp(next, op);
    }
    this.doc = next;

    const inverse = ops.map(inverseOp).reverse();
    if (record === 'do') {
      this.undoStack.push(inverse);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack = [];
    } else if (record === 'undo') {
      this.redoStack.push(inverse);
    } else {
      this.undoStack.push(inverse);
    }

    const ts = Date.now();
    const events = ops.map((op) => ({ docId: next.id, seq: ++this.seq, ts, op }));
    this.version++;
    this.listeners.forEach((l) => l());
    this.eventListeners.forEach((l) => l(events));
  }

  /** The layer tools act on and new content goes on, for page `pageId`. */
  activeLayer(pageId: string): string {
    const page = this.doc.pages.find((p) => p.id === pageId);
    return page ? activeLayerId(page, this.activeLayers.get(pageId)) : '';
  }

  setActiveLayer(pageId: string, layerId: string): void {
    if (this.activeLayers.get(pageId) === layerId) return;
    this.activeLayers.set(pageId, layerId);
    this.version++;
    this.listeners.forEach((l) => l());
  }

  undo(): void {
    const group = this.undoStack.pop();
    if (group) this.dispatch(group, 'undo');
  }

  redo(): void {
    const group = this.redoStack.pop();
    if (group) this.dispatch(group, 'redo');
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  onEvents(fn: (events: DocEvent[]) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  getDoc = (): NotebookDoc => this.doc;
  getVersion = (): number => this.version;
}
