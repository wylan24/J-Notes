// Background handwriting recognition: reads each line of writing once and keeps its text in
// IndexedDB, keyed by the ink, so search is instant and the model never reads a line twice.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { NotebookDoc } from '../core/model';
import { docLines, unreadLines } from '../core/handwriting';
import type { DocumentStore } from '../core/store';
import { hwrEntries, loadDocument, updateHwrEntries } from '../storage/db';
import { lineImage, recognise, recognizerStatus } from './recognizer';

// --- The setting ------------------------------------------------------------------------------

const KEY = 'jnotes.hwr';
const settingListeners = new Set<() => void>();

export function handwritingEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function setHandwritingEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, String(on));
  } catch {
    // Not remembered, but applies until the app is closed.
  }
  settingListeners.forEach((l) => l());
}

const subscribeSetting = (fn: () => void) => {
  settingListeners.add(fn);
  return () => settingListeners.delete(fn);
};

export const useHandwritingEnabled = (): boolean => useSyncExternalStore(subscribeSetting, handwritingEnabled);

// --- One notebook's recognised text ---------------------------------------------------------------

/** Wait for the browser to be idle (or a moment), so reading never holds up writing. */
const idle = () => new Promise<void>((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 500 }) : setTimeout(r, 50)));

export class HandwritingIndex {
  private texts = new Map<string, string>();
  private listeners = new Set<() => void>();
  readonly loaded: Promise<void>;
  /** Bumps whenever a line is read, so search can update. */
  version = 0;
  /** Lines still to read in the current pass. */
  remaining = 0;

  constructor(readonly docId: string) {
    this.loaded = hwrEntries(docId).then(
      (entries) => {
        for (const e of entries) this.texts.set(e.key, e.text);
        this.bump();
      },
      (e) => console.error('Could not load recognised handwriting', e),
    );
  }

  textOf = (key: string): string | undefined => this.texts.get(key);

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /**
   * Read every line not read yet, from page `fromPage` on, until done or `signal` aborts. A full
   * pass then forgets lines that are no longer in the notebook.
   */
  async run(doc: NotebookDoc, fromPage: number, signal: AbortSignal): Promise<void> {
    await this.loaded;
    if (signal.aborted) return;
    const todo = unreadLines(doc, (k) => this.texts.has(k), fromPage);
    // After a failed load, wait for Try again in Settings rather than downloading again on every pause.
    if (todo.length && recognizerStatus().state === 'error') return;
    this.remaining = todo.length;
    this.bump();
    for (const l of todo) {
      if (signal.aborted) return;
      this.remaining--;
      let text: string;
      try {
        text = await recognise(lineImage(l.strokes, l.line));
      } catch (e) {
        if (signal.aborted || recognizerStatus().state !== 'ready') return; // stopped, or the model failed
        console.warn('Could not read a line of handwriting', e);
        continue;
      }
      // Kept even when empty, so a scribble isn't read again and again.
      this.texts.set(l.key, text);
      this.bump();
      await updateHwrEntries(this.docId, [{ docId: this.docId, key: l.key, pageId: l.pageId, text }]).catch((e) => console.error(e));
      await idle();
    }
    if (signal.aborted) return;
    const live = new Set(docLines(doc).map((l) => l.key));
    const stale = [...this.texts.keys()].filter((k) => !live.has(k));
    if (stale.length) {
      for (const k of stale) this.texts.delete(k);
      await updateHwrEntries(this.docId, [], stale).catch((e) => console.error(e));
      this.bump();
    }
  }
}

/**
 * Read the handwriting of notebooks that aren't open, one after another, so the library's search
 * finds them too. Notebooks already read cost only a look at their cache.
 */
export async function indexNotebooks(ids: readonly string[], signal: AbortSignal): Promise<void> {
  for (const id of ids) {
    if (signal.aborted) return;
    try {
      const { doc } = await loadDocument(id);
      await new HandwritingIndex(id).run(doc, 0, signal);
    } catch (e) {
      console.warn('Could not read the handwriting of a notebook', e);
    }
  }
}

/** How long writing must pause before recognition catches up. */
const SETTLE_MS = 1500;

/**
 * The open notebook's recognised handwriting, kept up to date while recognition is on: lines are
 * read once writing pauses, starting with the page in view.
 */
export function useHandwritingIndex(docId: string, store: DocumentStore | null, pageIndex: number): HandwritingIndex | null {
  const enabled = useHandwritingEnabled();
  const [index, setIndex] = useState<HandwritingIndex | null>(null);
  useEffect(() => {
    if (!enabled) return setIndex(null);
    setIndex(new HandwritingIndex(docId));
  }, [docId, enabled]);
  // Re-render as lines are read.
  useSyncExternalStore(index?.subscribe ?? noopSubscribe, index?.getVersion ?? zero);
  const version = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getVersion ?? zero);
  const page = useLatest(pageIndex);

  useEffect(() => {
    if (!index || !store) return;
    const ctl = new AbortController();
    // The model starts with the first line there is to read.
    const timer = setTimeout(() => void index.run(store.doc, page.current, ctl.signal), SETTLE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [index, store, version, page]);
  return index;
}

const noopSubscribe = () => () => {};
const zero = () => 0;

function useLatest<T>(value: T): { current: T } {
  const [ref] = useState(() => ({ current: value }));
  ref.current = value;
  return ref;
}
