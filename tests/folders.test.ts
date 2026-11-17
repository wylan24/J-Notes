import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { canMoveFolder, childFolders, countInFolder, effectiveFolder, folderPath, notebooksIn, parseHexColor, planFolderDelete } from '../src/core/folders';
import type { Folder, NotebookMeta } from '../src/core/model';
import { createNotebook, deleteFolder, listElements, listFolders, listNotebooks, loadDocument, moveNotebook, openDb, putFolder, resetDbForTests } from '../src/storage/db';

const folder = (id: string, parentId: string | null, name = id): Folder => ({ id, name, color: '#5b8def', parentId, createdAt: 1 });
const nb = (id: string, folderId?: string, trashedAt: number | null = null): NotebookMeta => ({
  id,
  title: id,
  cover: '#000',
  template: 'blank',
  createdAt: 1,
  updatedAt: 1,
  favourite: false,
  trashedAt,
  pageCount: 1,
  ...(folderId ? { folderId } : {}),
});

// school ─┬─ bio ── labs
//         └─ maths
// home
const tree = [folder('school', null, 'School'), folder('bio', 'school', 'Biology'), folder('labs', 'bio', 'Labs'), folder('maths', 'school', 'maths'), folder('home', null, 'Home')];

describe('folder tree', () => {
  it('lists child folders by name, ignoring case', () => {
    expect(childFolders(tree, 'school').map((f) => f.id)).toEqual(['bio', 'maths']);
    expect(childFolders(tree, null).map((f) => f.id)).toEqual(['home', 'school']);
  });

  it('builds the breadcrumb path, and survives a missing parent or a cycle', () => {
    expect(folderPath(tree, 'labs').map((f) => f.id)).toEqual(['school', 'bio', 'labs']);
    expect(folderPath(tree, null)).toEqual([]);
    expect(folderPath([folder('orphan', 'gone')], 'orphan').map((f) => f.id)).toEqual(['orphan']);
    expect(folderPath([folder('a', 'b'), folder('b', 'a')], 'a').map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('refuses to move a folder into itself or a folder inside it', () => {
    expect(canMoveFolder(tree, 'school', 'labs')).toBe(false);
    expect(canMoveFolder(tree, 'school', 'school')).toBe(false);
    expect(canMoveFolder(tree, 'labs', 'home')).toBe(true);
    expect(canMoveFolder(tree, 'bio', null)).toBe(true);
  });

  it('files notebooks, counting nested ones and showing orphans at the top level', () => {
    const notebooks = [nb('a', 'bio'), nb('b', 'labs'), nb('c'), nb('d', 'deleted-folder'), nb('e', 'bio', 5)];
    const ids = new Set(tree.map((f) => f.id));
    expect(effectiveFolder(nb('d', 'deleted-folder'), ids)).toBeNull();
    expect(notebooksIn(notebooks, tree, null).map((n) => n.id)).toEqual(['c', 'd']);
    expect(notebooksIn(notebooks, tree, 'bio').map((n) => n.id)).toEqual(['a']); // trashed 'e' excluded
    expect(countInFolder(notebooks, tree, 'school')).toBe(2);
  });

  it('plans a delete: subfolders go, every notebook inside goes to the trash', () => {
    const plan = planFolderDelete([nb('a', 'bio'), nb('b', 'labs'), nb('c', 'home'), nb('d')], tree, 'bio');
    expect(plan.folderIds.sort()).toEqual(['bio', 'labs']);
    expect(plan.trash.sort()).toEqual(['a', 'b']);
  });

  it('reads HEX colours', () => {
    expect(parseHexColor('#ABC')).toBe('#aabbcc');
    expect(parseHexColor('12ab9F')).toBe('#12ab9f');
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('red')).toBeNull();
  });
});

async function freshDb() {
  try {
    (await openDb()).close();
  } catch {
    // no database yet
  }
  resetDbForTests();
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('jnotes');
    req.onsuccess = req.onerror = r;
  });
}

describe('folder storage', () => {
  beforeEach(freshDb);

  it('upgrades a version 4 database, keeping notebooks, snapshots and elements', async () => {
    // Build the database exactly as version 4 of the app left it.
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('jnotes', 4);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('meta', { keyPath: 'id' }).put(nb('old'));
        db.createObjectStore('events', { keyPath: ['docId', 'seq'] });
        db.createObjectStore('snapshots', { keyPath: 'docId' }).put({ docId: 'old', seq: 0, doc: { id: 'old', pages: [{ id: 'p', template: 'ruled', strokes: [] }] } });
        db.createObjectStore('blobs', { keyPath: ['docId', 'id'] });
        db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('endedAt', 'endedAt');
        db.createObjectStore('elements', { keyPath: 'id' }).put({ id: 'el', name: 'Arrow', createdAt: 1, content: { strokes: [], items: [], w: 1, h: 1 }, blobs: [] });
      };
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
    resetDbForTests();

    const db = await openDb();
    expect(db.version).toBe(5);
    expect([...db.objectStoreNames]).toContain('folders');
    expect((await listNotebooks()).map((n) => n.id)).toEqual(['old']);
    expect((await loadDocument('old')).doc.pages[0].template).toBe('ruled');
    expect((await listElements()).map((e) => e.id)).toEqual(['el']);
    expect(await listFolders()).toEqual([]);
  });

  it('moves notebooks between folders and back to the top level', async () => {
    await putFolder(folder('school', null));
    await createNotebook(nb('n'), { id: 'n', pages: [] });
    await moveNotebook('n', 'school');
    expect((await listNotebooks())[0].folderId).toBe('school');
    await moveNotebook('n', null);
    expect('folderId' in (await listNotebooks())[0]).toBe(false);
  });

  it('deleting a folder deletes its subfolders and moves their notebooks to the trash', async () => {
    for (const f of tree) await putFolder(f);
    for (const n of [nb('inBio', 'bio'), nb('inLabs', 'labs'), nb('atHome', 'home'), nb('top'), nb('alreadyTrashed', 'bio', 42)]) await createNotebook(n, { id: n.id, pages: [] });

    expect(await deleteFolder('bio')).toBe(3);

    expect((await listFolders()).map((f) => f.id).sort()).toEqual(['home', 'maths', 'school']);
    const byId = new Map((await listNotebooks()).map((n) => [n.id, n]));
    for (const id of ['inBio', 'inLabs']) {
      expect(byId.get(id)!.trashedAt).not.toBeNull();
      expect('folderId' in byId.get(id)!).toBe(false); // restoring puts it at the top level
    }
    expect(byId.get('alreadyTrashed')!.trashedAt).toBe(42); // keeps its original trash date
    expect(byId.get('atHome')).toMatchObject({ trashedAt: null, folderId: 'home' });
    expect(byId.get('top')!.trashedAt).toBeNull();
  });
});
