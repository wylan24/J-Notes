import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NotebookMeta } from '../src/core/model';
import { DocumentStore } from '../src/core/store';
import { answerOps, newCard } from '../src/core/study';
import { appendCards, createNotebook, getBlob, getMeta, loadDocument, openDb, resetDbForTests } from '../src/storage/db';
import { Persister } from '../src/storage/persister';

const meta = (id: string): NotebookMeta => ({ id, kind: 'deck', title: 'Deck', cover: '#2a9d8f', template: 'blank', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 0, deck: { cards: 0, due: [] } });

beforeEach(async () => {
  const db = await openDb();
  db.close();
  resetDbForTests();
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('jnotes');
    req.onsuccess = req.onerror = r;
  });
});

describe('study set storage', () => {
  it('adds cards to a closed study set with their photos and updates its summary', async () => {
    await createNotebook(meta('d'), { id: 'd', pages: [], cards: [] });
    const card = newCard({ text: '', drawing: { strokes: [], items: [{ id: 'i', kind: 'image', x: 0, y: 0, w: 5, h: 5, blobId: 'b1' }], w: 5, h: 5 } }, { text: 'cat' }, 10, { docId: 'n', pageId: 'p' });
    await appendCards('d', [card], [{ id: 'b1', type: 'image/png', bytes: new Uint8Array([7]).buffer }]);
    const { doc } = await loadDocument('d');
    expect(doc.cards).toEqual([card]);
    expect((await getBlob('d', 'b1'))?.type).toBe('image/png');
    expect((await getMeta('d'))?.deck).toEqual({ cards: 1, due: [0] });
  });

  it('keeps the library summary current as cards are studied', async () => {
    await createNotebook(meta('d'), { id: 'd', pages: [], cards: [newCard({ text: 'q' }, { text: 'a' }, 1)] });
    const { doc, seq } = await loadDocument('d');
    const store = new DocumentStore(doc, seq);
    const persister = new Persister(store, 0);
    const now = Date.now();
    store.dispatch(answerOps(store.doc, store.doc.cards![0].id, 'good', now));
    await persister.flush();
    const saved = await getMeta('d');
    expect(saved?.deck?.cards).toBe(1);
    expect(saved?.deck?.due[0]).toBe(store.doc.cards![0].review!.due);
    expect((await loadDocument('d')).doc.studyLog).toHaveLength(1);
    await persister.dispose();
  });
});
