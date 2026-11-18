// Settling quick notes when the editor closes, and a sweep for ones left behind.
import { quicknoteOutcome, staleQuicknotes } from '../core/quicknote';
import type { NotebookDoc } from '../core/model';
import { deleteNotebook, getMeta, listNotebooks, loadDocument, updateMeta } from './db';

let pending: Promise<void> = Promise.resolve();

/**
 * Work the editor does as it closes (final save, discarding an empty quick note). The library waits
 * for it before listing notebooks, so a discarded quick note never flashes up.
 */
export function afterEditorClose(work: Promise<void>): void {
  pending = pending.then(() => work).catch((e) => console.error('Closing the notebook failed', e));
}

export function editorClosed(): Promise<void> {
  return pending;
}

/** Discard the notebook if it is an empty quick note, or keep it for good if it has content. */
export async function settleQuicknote(id: string, doc: NotebookDoc): Promise<void> {
  const meta = await getMeta(id);
  if (!meta) return;
  const outcome = quicknoteOutcome(meta, doc);
  if (outcome === 'discard') await deleteNotebook(id);
  else if (outcome === 'keep') await keepQuicknote(id);
}

/** Make a quick note an ordinary notebook (it has content, or was renamed). */
export async function keepQuicknote(id: string): Promise<void> {
  await updateMeta(id, { quicknote: undefined });
}

/** Delete empty quick notes left behind by a closed tab. Returns how many were removed. */
export async function sweepQuicknotes(now = Date.now()): Promise<number> {
  let removed = 0;
  for (const meta of staleQuicknotes(await listNotebooks(), now)) {
    try {
      const { doc } = await loadDocument(meta.id);
      if (quicknoteOutcome(meta, doc) === 'discard') {
        await deleteNotebook(meta.id);
        removed++;
      } else await keepQuicknote(meta.id);
    } catch (e) {
      console.error('Could not check quick note', e);
    }
  }
  return removed;
}

/** Settle a quick note that isn't open in an editor (its tab was closed from elsewhere). */
export async function settleQuicknoteById(id: string): Promise<void> {
  const meta = await getMeta(id);
  if (!meta?.quicknote) return;
  const { doc } = await loadDocument(id);
  await settleQuicknote(id, doc);
}
