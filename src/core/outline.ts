// Outlines: titled entries pointing at pages or regions, nested by level. Every edit returns a
// `doc.updated` op replacing the outline, so it undoes, saves and replays like any other change.
import { newId } from './ids';
import type { NotebookDoc, OutlineEntry } from './model';
import { updateDocOp, type DocOp } from './ops';

export const MAX_OUTLINE_LEVEL = 5;

/** Fix levels so the first entry is top-level and none is more than one deeper than the one before. */
export function normaliseLevels(entries: readonly OutlineEntry[]): OutlineEntry[] {
  let prev = -1;
  return entries.map((e) => {
    const level = Math.max(0, Math.min(e.level, prev + 1, MAX_OUTLINE_LEVEL));
    prev = level;
    return level === e.level ? e : { ...e, level };
  });
}

function setOutline(doc: NotebookDoc, entries: OutlineEntry[]): DocOp | null {
  const next = normaliseLevels(entries);
  return updateDocOp(doc, { outline: next.length ? next : undefined });
}

/** Where an entry sits in the notebook: page order, then top to bottom on the page. */
function position(doc: NotebookDoc, e: Pick<OutlineEntry, 'pageId' | 'rect'>): number {
  const page = doc.pages.findIndex((p) => p.id === e.pageId);
  return (page < 0 ? Infinity : page) * 1e6 + (e.rect?.y ?? -1);
}

/**
 * Add an entry where it falls in reading order: after the last entry pointing at the same or an
 * earlier place, at that entry's level (so a new heading joins the section it falls in).
 */
export function addOutlineEntry(doc: NotebookDoc, target: Pick<OutlineEntry, 'pageId' | 'rect'>, title: string): { op: DocOp; id: string } | null {
  const outline = doc.outline ?? [];
  const at = position(doc, target);
  let i = outline.length;
  while (i > 0 && position(doc, outline[i - 1]) > at) i--;
  const level = i > 0 ? outline[i - 1].level : 0;
  const entry: OutlineEntry = { id: newId(), title: title.trim() || 'Untitled', pageId: target.pageId, ...(target.rect ? { rect: { ...target.rect } } : {}), level };
  const op = setOutline(doc, [...outline.slice(0, i), entry, ...outline.slice(i)]);
  return op && { op, id: entry.id };
}

export function renameOutlineEntry(doc: NotebookDoc, id: string, title: string): DocOp | null {
  const t = title.trim();
  if (!t) return null;
  return setOutline(doc, (doc.outline ?? []).map((e) => (e.id === id ? { ...e, title: t } : e)));
}

/** Indent (+1) or outdent (-1) an entry together with the entries nested under it. */
export function shiftOutlineEntry(doc: NotebookDoc, id: string, by: 1 | -1): DocOp | null {
  const outline = doc.outline ?? [];
  const i = outline.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const end = subtreeEnd(outline, i);
  return setOutline(
    doc,
    outline.map((e, k) => (k >= i && k < end ? { ...e, level: Math.max(0, e.level + by) } : e)),
  );
}

/** Remove an entry. The entries nested under it move up a level, so they aren't lost. */
export function removeOutlineEntry(doc: NotebookDoc, id: string): DocOp | null {
  const outline = doc.outline ?? [];
  const i = outline.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const end = subtreeEnd(outline, i);
  return setOutline(
    doc,
    outline.flatMap((e, k) => (k === i ? [] : k > i && k < end ? [{ ...e, level: e.level - 1 }] : [e])),
  );
}

/** Index just past the entries nested under entry `i`. */
export function subtreeEnd(outline: readonly OutlineEntry[], i: number): number {
  let j = i + 1;
  while (j < outline.length && outline[j].level > outline[i].level) j++;
  return j;
}

export function hasChildren(outline: readonly OutlineEntry[], i: number): boolean {
  return subtreeEnd(outline, i) > i + 1;
}

/**
 * Entries to show, given which are collapsed: those whose page still exists, minus anything nested
 * under a collapsed entry. Each comes with its index in the full outline.
 */
export function visibleOutline(doc: NotebookDoc, collapsed: ReadonlySet<string>): { entry: OutlineEntry; index: number; pageIndex: number }[] {
  const outline = doc.outline ?? [];
  const pages = new Map(doc.pages.map((p, i) => [p.id, i]));
  const out: { entry: OutlineEntry; index: number; pageIndex: number }[] = [];
  for (let i = 0; i < outline.length; ) {
    const e = outline[i];
    const pageIndex = pages.get(e.pageId);
    if (pageIndex !== undefined) out.push({ entry: e, index: i, pageIndex });
    i = collapsed.has(e.id) ? subtreeEnd(outline, i) : i + 1;
  }
  return out;
}
