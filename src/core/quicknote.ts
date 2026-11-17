// Quick notes: a blank notebook in one tap, thrown away if it is left empty.
import type { NotebookDoc, NotebookMeta } from './model';

/** Nothing written, drawn, inserted, recorded or bookmarked, and no pages added. */
export function isEmptyNotebook(doc: NotebookDoc): boolean {
  return (
    doc.pages.length <= 1 &&
    doc.pages.every((p) => p.strokes.length === 0 && (p.items ?? []).length === 0) &&
    !(doc.recordings ?? []).length &&
    !(doc.bookmarks ?? []).length
  );
}

/** What to do with a quick note on leaving it: discard it if empty, otherwise keep it as an ordinary notebook. */
export function quicknoteOutcome(meta: Pick<NotebookMeta, 'quicknote'>, doc: NotebookDoc): 'discard' | 'keep' | 'none' {
  if (!meta.quicknote) return 'none';
  return isEmptyNotebook(doc) ? 'discard' : 'keep';
}

/** A quick note's title, from when it was made. */
export function quicknoteTitle(at: Date): string {
  const when = at.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `Quick note ${when}`;
}

/**
 * Quick notes to check on library load: ones left behind when a tab was closed instead of exited.
 * Only those untouched for a while, so a quick note open in another tab is left alone.
 */
export function staleQuicknotes(list: readonly NotebookMeta[], now: number, idleMs = 10 * 60_000): NotebookMeta[] {
  return list.filter((n) => n.quicknote && n.pageCount <= 1 && now - n.updatedAt >= idleMs);
}
