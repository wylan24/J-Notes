// Page actions: duplicate, insert, change template, and copy between notebooks.
// Each builds ops (or a page) from current state; the editor dispatches them as one undo step.
import { newId } from './ids';
import { blankPage, pagePaper, pageSize, type NotebookDoc, type Page, type PageBackground, type Template } from './model';
import { updatePageOp, type DocOp } from './ops';

/** Ids of the blobs (photos, custom template image) a page refers to. */
export function pageBlobIds(page: Page): string[] {
  const ids = new Set<string>();
  for (const it of page.items) if (it.kind === 'image') ids.add(it.blobId);
  if (page.background) ids.add(page.background.blobId);
  return [...ids];
}

/**
 * A copy of the page with fresh ids for the page, its strokes and its items.
 * `keepRecordings: false` drops the links from ink to audio recordings, for a copy going to a
 * notebook that doesn't have those recordings.
 */
export function clonePage(page: Page, { keepRecordings }: { keepRecordings: boolean }): Page {
  const strokes = page.strokes.map((s) => {
    if (keepRecordings || !s.rec) return { ...s, id: newId() };
    const { rec: _rec, ...rest } = s;
    return { ...rest, id: newId(), points: s.points.map(({ t: _t, ...pt }) => pt) };
  });
  return { ...page, id: newId(), strokes, items: page.items.map((it) => ({ ...it, id: newId() })) };
}

/** Add a copy of page `index` straight after it. */
export function duplicatePageOp(doc: NotebookDoc, index: number): DocOp | null {
  const page = doc.pages[index];
  return page ? { type: 'page.added', index: index + 1, page: clonePage(page, { keepRecordings: true }) } : null;
}

/**
 * Add an empty page before or after page `index`, with the same size, paper, template and custom
 * template image as that page.
 */
export function insertPageOp(doc: NotebookDoc, index: number, where: 'before' | 'after'): DocOp | null {
  const ref = doc.pages[index];
  if (!ref) return null;
  const page = blankPage(newId(), { template: ref.template, size: pageSize(ref), paper: pagePaper(ref), background: ref.background });
  return { type: 'page.added', index: where === 'before' ? index : index + 1, page };
}

/** Switch a page to a built-in template, or to a custom image (shown on blank paper). */
export function changeTemplateOp(page: Page, choice: Template | PageBackground): DocOp | null {
  return typeof choice === 'string'
    ? updatePageOp(page, { template: choice, background: undefined })
    : updatePageOp(page, { template: 'blank', background: choice });
}
