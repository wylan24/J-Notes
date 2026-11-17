import { describe, expect, it } from 'vitest';
import { DEFAULT_LIBRARY_PREFS, normalizeLibraryPrefs, sortFolders, sortNotebooks } from '../src/core/librarySort';
import type { Folder, NotebookMeta } from '../src/core/model';

const nb = (id: string, title: string, createdAt: number, updatedAt: number, folderId?: string): NotebookMeta => ({
  id, title, cover: '#000', template: 'blank', createdAt, updatedAt, favourite: false, trashedAt: null, pageCount: 1, ...(folderId ? { folderId } : {}),
});
const folder = (id: string, name: string, createdAt: number, parentId: string | null = null): Folder => ({ id, name, color: '#000', parentId, createdAt });

const notebooks = [nb('a', 'Chapter 10', 1, 50), nb('b', 'chapter 2', 3, 10), nb('c', 'Algebra', 2, 30)];
const ids = (l: { id: string }[]) => l.map((x) => x.id);

describe('library sort', () => {
  it('sorts by date modified, created, or name (numbers in names compare as numbers)', () => {
    expect(ids(sortNotebooks(notebooks, 'modified', 'desc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortNotebooks(notebooks, 'created', 'desc'))).toEqual(['b', 'c', 'a']);
    expect(ids(sortNotebooks(notebooks, 'created', 'asc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortNotebooks(notebooks, 'name', 'asc'))).toEqual(['c', 'b', 'a']);
    expect(ids(sortNotebooks(notebooks, 'name', 'desc'))).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties by most recently modified, and leaves the input alone', () => {
    const twins = [nb('x', 'Same', 1, 5), nb('y', 'same', 1, 9)];
    expect(ids(sortNotebooks(twins, 'name', 'asc'))).toEqual(['y', 'x']);
    expect(ids(twins)).toEqual(['x', 'y']);
  });

  it("sorts folders by name, creation, or their newest notebook's date at any depth", () => {
    const all = [folder('f1', 'Work', 1), folder('f2', 'archive', 5), folder('sub', 'Old', 2, 'f2')];
    const books = [nb('n1', 'x', 1, 20, 'f1'), nb('n2', 'y', 1, 99, 'sub')];
    const top = all.filter((f) => f.parentId === null);
    expect(ids(sortFolders(top, all, books, 'name', 'asc'))).toEqual(['f2', 'f1']);
    expect(ids(sortFolders(top, all, books, 'created', 'desc'))).toEqual(['f2', 'f1']);
    expect(ids(sortFolders(top, all, books, 'modified', 'desc'))).toEqual(['f2', 'f1']); // f2 holds n2 (99) via its subfolder
    expect(ids(sortFolders(top, all, [nb('n1', 'x', 1, 20, 'f1')], 'modified', 'desc'))).toEqual(['f1', 'f2']);
  });

  it('reads saved preferences, filling in anything missing or unknown', () => {
    expect(normalizeLibraryPrefs(null)).toEqual(DEFAULT_LIBRARY_PREFS);
    expect(normalizeLibraryPrefs({ sort: 'name', view: 'list' })).toEqual({ sort: 'name', dir: 'asc', view: 'list' });
    expect(normalizeLibraryPrefs({ sort: 'size', dir: 'up', view: 'table' })).toEqual(DEFAULT_LIBRARY_PREFS);
    expect(normalizeLibraryPrefs({ sort: 'created', dir: 'asc' })).toEqual({ sort: 'created', dir: 'asc', view: 'grid' });
  });
});
