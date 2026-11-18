// Document model. Plain data only — no DOM — so it can be tested in Node,
// replayed from the event log, and (later) moved into a worker or WASM core.

/** Page geometry is in page units: CSS px at 96 dpi, so 1 unit = 1/96 in. */
export interface PageSize {
  w: number;
  h: number;
}

/** Preset paper sizes, portrait. */
export const PAGE_SIZES = {
  a4: { w: 794, h: 1123 },
  a5: { w: 559, h: 794 },
  letter: { w: 816, h: 1056 },
} as const satisfies Record<string, PageSize>;
export type PageSizePreset = keyof typeof PAGE_SIZES;
export type Orientation = 'portrait' | 'landscape';

/** The size every page had before sizes existed, and the default for new pages. */
export const DEFAULT_PAGE_SIZE: PageSize = PAGE_SIZES.a4;
export const PAGE_W = DEFAULT_PAGE_SIZE.w;
export const PAGE_H = DEFAULT_PAGE_SIZE.h;

export function sizeFor(preset: PageSizePreset, orientation: Orientation): PageSize {
  const { w, h } = PAGE_SIZES[preset];
  return orientation === 'landscape' ? { w: h, h: w } : { w, h };
}

export function orientationOf(size: PageSize): Orientation {
  return size.w > size.h ? 'landscape' : 'portrait';
}

export type Paper = 'white' | 'yellow' | 'dark';
export const DEFAULT_PAPER: Paper = 'white';

export type InkTool = 'pen' | 'highlighter';
export type ToolKind = InkTool | 'shapes' | 'text' | 'sticky' | 'eraser' | 'lasso' | 'laser';
export type PenStyle = 'fountain' | 'ball' | 'brush';
export type EraseMode = 'stroke' | 'partial';
export type Template = 'blank' | 'ruled' | 'grid' | 'dotted' | 'legal' | 'cornell' | 'music' | 'planner';

/** One sampled input point in page coordinates. `p` is pressure in 0..1. */
export interface InputPoint {
  x: number;
  y: number;
  p: number;
  /** Milliseconds into the audio recording this point was drawn during; absent when none was running. */
  t?: number;
}

export interface Stroke {
  id: string;
  tool: InkTool;
  color: string;
  width: number;
  points: InputPoint[];
  /** True for mouse/finger input, where pressure is synthesised from velocity. */
  simulatePressure: boolean;
  /** Pen nib. Absent on highlighter strokes and on pen strokes saved before styles existed (= fountain). */
  penStyle?: PenStyle;
  /** Fountain-pen tip sharpness in 0..1; absent = 0.5. Higher means more pressure contrast. */
  sharpness?: number;
  /** Made by shape recognition. Rendered without input smoothing so corners stay sharp. */
  shape?: boolean;
  /** The recording this stroke was written during; its points' `t` are times into that recording. */
  rec?: string;
}

/** An audio recording made in the notebook. The audio bytes live in the blob store. */
export interface Recording {
  id: string;
  blobId: string;
  name: string;
  createdAt: number;
  durationMs: number;
  mimeType: string;
}

// Page items: the non-ink content of a page. Geometry is in page units; (x, y) is the top-left corner.
interface ItemBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  text: string;
  font: string;
  size: number;
  color: string;
}

export interface ImageItem extends ItemBase {
  kind: 'image';
  /** Key of the image bytes in this notebook's blob store. */
  blobId: string;
}

export interface StickyItem extends ItemBase {
  kind: 'sticky';
  text: string;
  color: string;
  collapsed: boolean;
}

/** Where a link goes: another page of this notebook, or a web address. */
export type LinkTarget = { kind: 'page'; pageId: string } | { kind: 'url'; url: string };

/**
 * A link. With a `label` it is a visible link (a pasted web address); without one it is a hotspot
 * over whatever is beneath it (a link made from a lasso selection).
 */
export interface LinkItem extends ItemBase {
  kind: 'link';
  target: LinkTarget;
  label?: string;
}

export type PageItem = TextItem | ImageItem | StickyItem | LinkItem;

/** Page fields a `page.updated` op can change. An undefined value means the field is absent. */
export type PagePatch = Partial<Pick<Page, 'template' | 'size' | 'paper' | 'background'>>;

/** Fields an `items.updated` op can change. */
export type ItemPatch = Partial<Omit<TextItem, 'id' | 'kind'> & Omit<ImageItem, 'id' | 'kind'> & Omit<StickyItem, 'id' | 'kind'> & Omit<LinkItem, 'id' | 'kind'>>;

/** A custom template: an image in the notebook's blob store, fitted to the page under the template lines. */
export interface ImageBackground {
  kind: 'image';
  blobId: string;
}
/** A page of a PDF stored in the notebook's blob store, drawn as the page's paper. `pageIndex` is 0-based. */
export interface PdfBackground {
  kind: 'pdf';
  blobId: string;
  pageIndex: number;
}
export type PageBackground = ImageBackground | PdfBackground;

export interface Page {
  id: string;
  template: Template;
  /** Custom template image, drawn on the paper beneath the template lines. */
  background?: PageBackground;
  /** Absent on pages saved before sizes existed (= A4 portrait); read it with `pageSize`. */
  size?: PageSize;
  /** Absent on pages saved before paper colours existed (= white); read it with `pagePaper`. */
  paper?: Paper;
  strokes: Stroke[];
  /** Text boxes, images and sticky notes, in z-order. */
  items: PageItem[];
}

export function pageSize(page: Pick<Page, 'size'>): PageSize {
  const s = page.size;
  return s && s.w > 0 && s.h > 0 ? s : DEFAULT_PAGE_SIZE;
}

export function pagePaper(page: Pick<Page, 'paper'>): Paper {
  return page.paper === 'yellow' || page.paper === 'dark' ? page.paper : DEFAULT_PAPER;
}

export interface PageSetup {
  template: Template;
  size: PageSize;
  paper: Paper;
  background?: PageBackground;
}

/** An empty page. Size and paper are only stored when they differ from the defaults. */
export function blankPage(id: string, { template, size, paper, background }: PageSetup): Page {
  const page: Page = { id, template, strokes: [], items: [] };
  if (background) page.background = { ...background };
  if (size.w !== DEFAULT_PAGE_SIZE.w || size.h !== DEFAULT_PAGE_SIZE.h) page.size = { w: size.w, h: size.h };
  if (paper !== DEFAULT_PAPER) page.paper = paper;
  return page;
}

/** How pages are laid out: stacked top to bottom, or side by side. */
export type ScrollDirection = 'vertical' | 'horizontal';

/**
 * Where each page starts along the scroll direction, in CSS px at `zoom`, plus the total length:
 * page heights when stacked, widths when side by side.
 */
export function pageOffsets(pages: readonly Pick<Page, 'size'>[], zoom: number, gap: number, direction: ScrollDirection = 'vertical'): { starts: number[]; length: number } {
  const starts: number[] = [];
  let at = 0;
  for (const p of pages) {
    starts.push(at);
    const s = pageSize(p);
    at += (direction === 'vertical' ? s.h : s.w) * zoom + gap;
  }
  return { starts, length: Math.max(0, at - gap) };
}

/** Top edge of each page in a vertical stack, in CSS px at `zoom`, plus the total height. */
export function pageTops(pages: readonly Pick<Page, 'size'>[], zoom: number, gap: number): { tops: number[]; height: number } {
  const { starts, length } = pageOffsets(pages, zoom, gap, 'vertical');
  return { tops: starts, height: length };
}

/** Index of the page whose slot (page plus the gap below it) contains `y`, clamped to the stack. */
export function pageIndexAt(tops: readonly number[], y: number): number {
  let i = 0;
  while (i + 1 < tops.length && tops[i + 1] <= y) i++;
  return i;
}

/**
 * Pages saved before items existed have no `items`; give them an empty list.
 * Missing `size` and `paper` are left absent (they read as A4 portrait, white) so old pages
 * round-trip unchanged.
 */
export function normalizePage(page: Page): Page {
  return Array.isArray(page.items) ? page : { ...page, items: [] };
}

export function normalizeDoc(doc: NotebookDoc): NotebookDoc {
  return doc.pages.every((p) => Array.isArray(p.items)) ? doc : { ...doc, pages: doc.pages.map(normalizePage) };
}

export interface NotebookDoc {
  id: string;
  pages: Page[];
  /** Absent on notebooks saved before recordings existed. */
  recordings?: Recording[];
  /** Ids of bookmarked pages, in the order they were bookmarked. Absent when there are none. */
  bookmarks?: string[];
  /** The notebook's outline, in reading order. Absent when it has none. */
  outline?: OutlineEntry[];
}

/**
 * One line of a notebook's outline: a title pointing at a page, or at a region of one.
 * The outline is a flat list; `level` (0 = top) makes the hierarchy, and each entry is at most
 * one level deeper than the one before it.
 */
export interface OutlineEntry {
  id: string;
  title: string;
  pageId: string;
  /** The region it points at, in page units; absent for the whole page. */
  rect?: { x: number; y: number; w: number; h: number };
  level: number;
}

/** Notebook-level fields a `doc.updated` op can change. An undefined value means the field is absent. */
export type DocPatch = Partial<Pick<NotebookDoc, 'bookmarks' | 'outline'>>;

/** Library-level projection of a notebook (what the library grid shows). */
export interface NotebookMeta {
  id: string;
  title: string;
  cover: string;
  template: Template;
  createdAt: number;
  updatedAt: number;
  favourite: boolean;
  trashedAt: number | null;
  pageCount: number;
  thumbnail?: string;
  /** A custom cover picture, as a small JPEG data URL; shown instead of the first page's thumbnail. */
  coverImage?: string;
  /** Present when the notebook is locked with a password. A lock screen, not encryption. */
  lock?: NotebookLock;
  /** The folder it is filed in; absent for the top level (and for notebooks from before folders). */
  folderId?: string;
  /**
   * Made with Quick note and not yet kept: discarded when left empty. Cleared once it is left
   * with content or renamed.
   */
  quicknote?: true;
}

/** A salted, slow hash of a notebook's password. The notebook itself is stored unencrypted. */
export interface NotebookLock {
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  hash: string;
  hint?: string;
}

/** A library folder. Folders nest through `parentId`; null is the top level. */
export interface Folder {
  id: string;
  name: string;
  /** #rrggbb */
  color: string;
  parentId: string | null;
  createdAt: number;
}
