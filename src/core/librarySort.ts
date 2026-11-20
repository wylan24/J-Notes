// How the library orders notebooks and folders, and how it lays them out. Remembered per viewer.
import { folderAndDescendants } from './folders';
import type { DocKind, Folder, NotebookMeta } from './model';

export type SortKey = 'modified' | 'created' | 'name';
export type SortDir = 'asc' | 'desc';
export type LibraryView = 'grid' | 'list';

/** Which kinds of document the library shows. */
export type KindFilter = 'all' | DocKind;
export const KIND_FILTERS: readonly KindFilter[] = ['all', 'notebook', 'whiteboard', 'text', 'deck'];

export interface LibraryPrefs {
  sort: SortKey;
  dir: SortDir;
  view: LibraryView;
  kind: KindFilter;
}

/** Newest first, as the library has always shown. */
export const DEFAULT_LIBRARY_PREFS: LibraryPrefs = { sort: 'modified', dir: 'desc', view: 'grid', kind: 'all' };

/** The direction a sort starts in when chosen: newest first for dates, A to Z for names. */
export const NATURAL_DIR: Record<SortKey, SortDir> = { modified: 'desc', created: 'desc', name: 'asc' };

/** Saved preferences from storage, with anything missing or unknown replaced by the default. */
export function normalizeLibraryPrefs(raw: unknown): LibraryPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof LibraryPrefs, unknown>>;
  const sort = r.sort === 'created' || r.sort === 'name' || r.sort === 'modified' ? r.sort : DEFAULT_LIBRARY_PREFS.sort;
  const dir = r.dir === 'asc' || r.dir === 'desc' ? r.dir : NATURAL_DIR[sort];
  const view = r.view === 'list' || r.view === 'grid' ? r.view : DEFAULT_LIBRARY_PREFS.view;
  const kind = KIND_FILTERS.includes(r.kind as KindFilter) ? (r.kind as KindFilter) : 'all';
  return { sort, dir, view, kind };
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Notebooks in the chosen order. Ties fall back to most recently modified, then id, so the order is stable. */
export function sortNotebooks(list: readonly NotebookMeta[], sort: SortKey, dir: SortDir): NotebookMeta[] {
  const sign = dir === 'asc' ? 1 : -1;
  const key = (n: NotebookMeta) => (sort === 'created' ? n.createdAt : n.updatedAt);
  return [...list].sort((a, b) => {
    const primary = sort === 'name' ? byName(a.title, b.title) : key(a) - key(b);
    return sign * primary || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
  });
}

/**
 * Folders in the chosen order. A folder's "modified" time is its most recently modified notebook
 * at any depth (or when it was made, if it holds none).
 */
export function sortFolders(list: readonly Folder[], all: readonly Folder[], notebooks: readonly NotebookMeta[], sort: SortKey, dir: SortDir): Folder[] {
  const sign = dir === 'asc' ? 1 : -1;
  const modified = new Map<string, number>();
  if (sort === 'modified') {
    for (const f of list) {
      const inside = folderAndDescendants(all, f.id);
      let t = f.createdAt;
      for (const n of notebooks) if (n.trashedAt === null && n.folderId && inside.has(n.folderId)) t = Math.max(t, n.updatedAt);
      modified.set(f.id, t);
    }
  }
  return [...list].sort((a, b) => {
    const primary = sort === 'name' ? byName(a.name, b.name) : sort === 'created' ? a.createdAt - b.createdAt : modified.get(a.id)! - modified.get(b.id)!;
    return sign * primary || byName(a.name, b.name) || a.id.localeCompare(b.id);
  });
}
