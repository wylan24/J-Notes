// Page actions: duplicate, insert, change template, and copy between notebooks.
// Each builds ops (or a page) from current state; the editor dispatches them as one undo step.
import { newId } from './ids';
import { reidItems } from './connectors';
import { blankPage, DEFAULT_PAGE_SIZE, pagePaper, pageSize, type NotebookDoc, type Page, type PageBackground, type PageSize, type Template } from './model';
import { updateDocOp, updatePageOp, type DocOp } from './ops';

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
  return { ...page, id: newId(), strokes, items: reidItems(page.items) };
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
  // A PDF page's background is its content, not a template, so a new page next to it is blank.
  const background = ref.background?.kind === 'image' ? ref.background : undefined;
  const page = blankPage(newId(), { template: ref.template, size: pageSize(ref), paper: pagePaper(ref), background });
  return { type: 'page.added', index: where === 'before' ? index : index + 1, page };
}

/** Switch a page to a built-in template, or to a custom image (shown on blank paper). */
export function changeTemplateOp(page: Page, choice: Template | PageBackground): DocOp | null {
  return typeof choice === 'string'
    ? updatePageOp(page, { template: choice, background: undefined })
    : updatePageOp(page, { template: 'blank', background: choice });
}

// --- Thumbnail sidebar layout ---------------------------------------------------------------

/** Tops of items of the given heights stacked with `gap` between them, and the total height. */
export function stackLayout(heights: readonly number[], gap: number): { tops: number[]; height: number } {
  const tops: number[] = [];
  let y = 0;
  for (const h of heights) {
    tops.push(y);
    y += h + gap;
  }
  return { tops, height: Math.max(0, y - gap) };
}

/** Indices [start, end) of the items that overlap the band [top, bottom]. Tops must be ascending. */
export function visibleRange(tops: readonly number[], heights: readonly number[], top: number, bottom: number): [number, number] {
  // Binary search for the first item whose bottom edge is below `top`.
  let lo = 0, hi = tops.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] + heights[mid] < top) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < tops.length && tops[end] <= bottom) end++;
  return [lo, end];
}

/**
 * Where a dragged item lands when dropped at `y`.
 * `slot` is the gap it is shown going into (0..n, in the current order: before item `slot`);
 * `to` is its index once moved, as `page.moved` expects.
 */
export function dropTarget(tops: readonly number[], heights: readonly number[], y: number, from: number): { slot: number; to: number } {
  let slot = 0;
  while (slot < tops.length && tops[slot] + heights[slot] / 2 < y) slot++;
  return { slot, to: slot > from ? slot - 1 : slot };
}

// --- Bookmarks ----------------------------------------------------------------------------

export function isBookmarked(doc: NotebookDoc, pageId: string): boolean {
  return doc.bookmarks?.includes(pageId) ?? false;
}

/** Add or remove a page's bookmark. Removing the last one leaves `bookmarks` absent, as on older notebooks. */
export function toggleBookmarkOp(doc: NotebookDoc, pageId: string): DocOp | null {
  const current = doc.bookmarks ?? [];
  const next = current.includes(pageId) ? current.filter((id) => id !== pageId) : [...current, pageId];
  return updateDocOp(doc, { bookmarks: next.length ? next : undefined });
}

/** Indices of bookmarked pages that still exist, in page order. */
export function bookmarkedIndices(doc: NotebookDoc): number[] {
  if (!doc.bookmarks?.length) return [];
  const marked = new Set(doc.bookmarks);
  return doc.pages.flatMap((p, i) => (marked.has(p.id) ? [i] : []));
}

// --- Pages from PDFs and images -----------------------------------------------------------

/** One page per PDF page, each the size of its PDF page, with that page as its background. */
export function pdfPages(blobId: string, sizes: readonly PageSize[]): Page[] {
  return sizes.map((size, pageIndex) => ({ id: newId(), template: 'blank', size: { ...size }, background: { kind: 'pdf', blobId, pageIndex }, strokes: [], items: [] }));
}

/** A page for an image: the default page width, and as tall as the image's proportions need. */
export function imagePageSize(naturalW: number, naturalH: number, width = DEFAULT_PAGE_SIZE.w): PageSize {
  const h = Math.max(1, Math.round((width * naturalH) / Math.max(1, naturalW)));
  return { w: width, h };
}

/** A page showing an image across the whole page, as its background. */
export function imagePage(blobId: string, naturalW: number, naturalH: number): Page {
  return { id: newId(), template: 'blank', size: imagePageSize(naturalW, naturalH), background: { kind: 'image', blobId }, strokes: [], items: [] };
}

/** Ops adding `pages`, in order, starting at `index`. Dispatched together they are one undo step. */
export function insertPagesOps(doc: NotebookDoc, index: number, pages: readonly Page[]): DocOp[] {
  const at = Math.max(0, Math.min(index, doc.pages.length));
  return pages.map((page, i) => ({ type: 'page.added', index: at + i, page }));
}
