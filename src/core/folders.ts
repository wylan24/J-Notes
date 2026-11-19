// Library folders: a tree through `parentId`, with notebooks filed by `folderId`. Pure helpers,
// so moves and deletions can be checked before anything is written.
import type { Folder, NotebookMeta } from './model';

/** Folders directly inside `parentId` (null = top level), by name. */
export function childFolders(folders: readonly Folder[], parentId: string | null): Folder[] {
  return folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/** The folders from the top level down to `id`, inclusive, for breadcrumbs. Stops at a missing parent. */
export function folderPath(folders: readonly Folder[], id: string | null): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  const seen = new Set<string>();
  for (let cur = id ? byId.get(id) : undefined; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    path.unshift(cur);
  }
  return path;
}

/** `id` and every folder nested inside it. */
export function folderAndDescendants(folders: readonly Folder[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Whether folder `id` can move into `parentId`: not into itself or anything inside it. */
export function canMoveFolder(folders: readonly Folder[], id: string, parentId: string | null): boolean {
  return parentId === null || !folderAndDescendants(folders, id).has(parentId);
}

/**
 * The folder a notebook shows in. A notebook filed in a folder that no longer exists shows at the
 * top level rather than disappearing.
 */
export function effectiveFolder(meta: Pick<NotebookMeta, 'folderId'>, folderIds: ReadonlySet<string>): string | null {
  return meta.folderId && folderIds.has(meta.folderId) ? meta.folderId : null;
}

/** Notebooks (not in the trash) filed directly in a folder. */
export function notebooksIn(notebooks: readonly NotebookMeta[], folders: readonly Folder[], folderId: string | null): NotebookMeta[] {
  const ids = new Set(folders.map((f) => f.id));
  return notebooks.filter((n) => n.trashedAt === null && effectiveFolder(n, ids) === folderId);
}

/** How many notebooks (not in the trash) are inside a folder, at any depth. */
export function countInFolder(notebooks: readonly NotebookMeta[], folders: readonly Folder[], id: string): number {
  const inside = folderAndDescendants(folders, id);
  return notebooks.filter((n) => n.trashedAt === null && n.folderId !== undefined && inside.has(n.folderId)).length;
}

/**
 * What deleting a folder does: it and its subfolders go, and every notebook inside them at any
 * depth moves to the trash (unfiled, so restoring it puts it at the top level).
 */
export function planFolderDelete(
  notebooks: readonly NotebookMeta[],
  folders: readonly Folder[],
  id: string,
): { folderIds: string[]; trash: string[] } {
  const inside = folderAndDescendants(folders, id);
  return {
    folderIds: [...inside],
    trash: notebooks.filter((n) => n.folderId !== undefined && inside.has(n.folderId)).map((n) => n.id),
  };
}

export const FOLDER_COLORS = ['#5b8def', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#9b5de5', '#6c757d'];

/** A valid #rrggbb colour from user input (#rgb or rrggbb accepted), or null. */
export function parseHexColor(input: string): string | null {
  let h = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? `#${h.toLowerCase()}` : null;
}
