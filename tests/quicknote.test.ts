import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { isEmptyNotebook, quicknoteOutcome, staleQuicknotes } from '../src/core/quicknote';
import type { NotebookDoc, NotebookMeta, Page } from '../src/core/model';
import { DocumentStore } from '../src/core/store';
import { createNotebook, listNotebooks, loadDocument, openDb, resetDbForTests } from '../src/storage/db';
import { Persister } from '../src/storage/persister';
import { settleQuicknote, sweepQuicknotes } from '../src/storage/quicknotes';

const page = (extra: Partial<Page> = {}): Page => ({ id: 'p', template: 'ruled', strokes: [], items: [], ...extra });
const doc = (pages: Page[] = [page()], extra: Partial<NotebookDoc> = {}): NotebookDoc => ({ id: 'q', pages, ...extra });
const meta = (id: string, extra: Partial<NotebookMeta> = {}): NotebookMeta => ({
  id, title: 'Quick note', cover: '#000', template: 'ruled', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 1, quicknote: true, ...extra,
});
const ink = { id: 's', tool: 'pen' as const, color: '#000', width: 2, simulatePressure: false, points: [{ x: 1, y: 1, p: 0.5 }] };

describe('quick note emptiness', () => {
  it('is empty with one untouched page and nothing else', () => {
    expect(isEmptyNotebook(doc())).toBe(true);
  });

  it('is not empty once anything is added', () => {
    expect(isEmptyNotebook(doc([page({ strokes: [ink] })]))).toBe(false);
    expect(isEmptyNotebook(doc([page({ items: [{ id: 'i', kind: 'sticky', x: 0, y: 0, w: 9, h: 9, text: '', color: '#ff0', collapsed: false }] })]))).toBe(false);
    expect(isEmptyNotebook(doc([page(), { ...page(), id: 'p2' }]))).toBe(false);
    expect(isEmptyNotebook(doc([page()], { bookmarks: ['p'] }))).toBe(false);
    expect(isEmptyNotebook(doc([page()], { recordings: [{ id: 'r', blobId: 'b', name: 'R', createdAt: 1, durationMs: 9, mimeType: 'audio/webm' }] }))).toBe(false);
  });

  it('decides what happens on leaving: only flagged notebooks are ever discarded', () => {
    expect(quicknoteOutcome({ quicknote: true }, doc())).toBe('discard');
    expect(quicknoteOutcome({ quicknote: true }, doc([page({ strokes: [ink] })]))).toBe('keep');
    expect(quicknoteOutcome({}, doc())).toBe('none');
  });

  it('only sweeps quick notes left idle', () => {
    const now = 100 * 60_000;
    const list = [meta('old', { updatedAt: 0 }), meta('fresh', { updatedAt: now - 1000 }), meta('kept', { updatedAt: 0, quicknote: undefined })];
    expect(staleQuicknotes(list, now).map((n) => n.id)).toEqual(['old']);
  });
});

describe('quick note storage', () => {
  beforeEach(async () => {
    (await openDb()).close();
    resetDbForTests();
    await new Promise((r) => {
      const req = indexedDB.deleteDatabase('jnotes');
      req.onsuccess = req.onerror = r;
    });
  });

  it('discards an empty quick note when it is closed', async () => {
    await createNotebook(meta('q'), doc());
    await settleQuicknote('q', doc());
    expect(await listNotebooks()).toEqual([]);
  });

  it('keeps a quick note with ink as an ordinary notebook', async () => {
    await createNotebook(meta('q'), doc());
    const { doc: d, seq } = await loadDocument('q');
    const store = new DocumentStore(d, seq);
    const persister = new Persister(store, 0);
    store.dispatch([{ type: 'strokes.added', pageId: 'p', strokes: [ink] }]);
    await persister.dispose();
    await settleQuicknote('q', store.doc);
    const [kept] = await listNotebooks();
    expect(kept.id).toBe('q');
    expect(kept.quicknote).toBeFalsy();
    // No longer a quick note: erasing everything later doesn't delete it.
    await settleQuicknote('q', doc());
    expect(await listNotebooks()).toHaveLength(1);
  });

  it('sweeps empty quick notes left by a closed tab, and keeps written ones', async () => {
    await createNotebook(meta('empty', { updatedAt: 0 }), { ...doc(), id: 'empty' });
    await createNotebook(meta('written', { updatedAt: 0 }), { ...doc([page({ strokes: [ink] })]), id: 'written' });
    await createNotebook(meta('open-elsewhere', { updatedAt: Date.now() }), { ...doc(), id: 'open-elsewhere' });
    expect(await sweepQuicknotes()).toBe(1);
    const left = new Map((await listNotebooks()).map((n) => [n.id, n]));
    expect([...left.keys()].sort()).toEqual(['open-elsewhere', 'written']);
    expect(left.get('written')!.quicknote).toBeFalsy();
    expect(left.get('open-elsewhere')!.quicknote).toBe(true);
  });
});
