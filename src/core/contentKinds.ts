// Kinds of content on a page: what the selective eraser can be limited to, and what
// "Delete specific items" can clear from a page.
import type { Page, Stroke } from './model';
import { removeItemsOp, removeStrokesOp, type DocOp } from './ops';

/** Ink the eraser can be set to erase. Recognised shapes count as shapes, whatever drew them. */
export type InkKind = 'pen' | 'highlighter' | 'shapes';
export const INK_KINDS: readonly InkKind[] = ['pen', 'highlighter', 'shapes'];

export function inkKind(s: Stroke): InkKind {
  if (s.shape) return 'shapes';
  return s.tool === 'highlighter' ? 'highlighter' : 'pen';
}

/**
 * The saved eraser filter, at least one kind. Settings from before the filter had only "highlighter
 * only", which becomes just the highlighter.
 */
export function normalizeEraseKinds(raw: unknown, legacyHighlighterOnly?: unknown): InkKind[] {
  if (Array.isArray(raw)) {
    const kinds = INK_KINDS.filter((k) => raw.includes(k));
    if (kinds.length) return kinds;
  }
  return legacyHighlighterOnly === true ? ['highlighter'] : [...INK_KINDS];
}

/** Turn one kind on or off; the last one left can't be turned off (an eraser that erases nothing). */
export function toggleEraseKind(kinds: readonly InkKind[], k: InkKind): InkKind[] {
  if (!kinds.includes(k)) return INK_KINDS.filter((x) => x === k || kinds.includes(x));
  return kinds.length > 1 ? kinds.filter((x) => x !== k) : [...kinds];
}

/** Everything "Delete specific items" can clear. */
export type ContentKind = InkKind | 'text' | 'image' | 'sticky' | 'tape' | 'link';
export const CONTENT_KINDS: readonly ContentKind[] = ['pen', 'highlighter', 'shapes', 'text', 'image', 'sticky', 'tape', 'link'];
export const CONTENT_LABELS: Record<ContentKind, string> = {
  pen: 'Pen ink',
  highlighter: 'Highlighter',
  shapes: 'Shapes',
  text: 'Text boxes',
  image: 'Photos',
  sticky: 'Sticky notes',
  tape: 'Tape',
  link: 'Links',
};

export function countContent(page: Page): Record<ContentKind, number> {
  const out = Object.fromEntries(CONTENT_KINDS.map((k) => [k, 0])) as Record<ContentKind, number>;
  for (const s of page.strokes) out[inkKind(s)]++;
  for (const it of page.items) out[it.kind]++;
  return out;
}

/** Ops deleting one kind of content from a page, or everything with 'all'; together they are one undo step. */
export function deleteContentOps(page: Page, kind: ContentKind | 'all'): DocOp[] {
  const strokes = page.strokes.filter((s) => kind === 'all' || inkKind(s) === kind).map((s) => s.id);
  const items = page.items.filter((it) => kind === 'all' || it.kind === kind).map((it) => it.id);
  return [removeStrokesOp(page, strokes), removeItemsOp(page, items)].filter((op): op is DocOp => op !== null);
}
