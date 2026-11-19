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
export type ToolKind = InkTool | 'shapes' | 'text' | 'sticky' | 'eraser' | 'lasso' | 'laser' | 'tape';
export type PenStyle = 'fountain' | 'ball' | 'brush' | 'pencil';
/** Line style of a pen or shape stroke. Absent on a stroke means solid. */
export type DashStyle = 'solid' | 'dashed' | 'dotted';
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
  /** Dashed or dotted; absent for a solid line. */
  dash?: Exclude<DashStyle, 'solid'>;
  /** How much the line was steadied, 0..1. Absent on strokes from before the setting (they keep their pen's own amount). */
  stabilise?: number;
  /** The recording this stroke was written during; its points' `t` are times into that recording. */
  rec?: string;
  /** Locked: the eraser and lasso pass over it. Absent when unlocked. */
  locked?: true;
  /** The page layer it is on; absent for the page's base layer (see `layerOf`). */
  layerId?: string;
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
  /** Locked: the eraser and lasso pass over it, and tools don't edit it. Absent when unlocked. */
  locked?: true;
  /** Turn about the box's centre, in radians (clockwise on screen). Absent for none. */
  rotation?: number;
  /** The page layer it is on; absent for the page's base layer (see `layerOf`). */
  layerId?: string;
}

/** Part of an image to show, as fractions (0..1) of the source image's width and height. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A stretch of text in one style. A newline in `text` is a line break within its paragraph. */
export interface RichRun {
  text: string;
  b?: true;
  i?: true;
  /** Highlight colour behind the text. */
  hl?: string;
}

/** A paragraph of formatted text: its runs, whether it is a list item, and how far it is indented. */
export interface RichBlock {
  runs: RichRun[];
  list?: 'bullet' | 'ordered';
  /** Indent level, 0 (absent) for none. For a list item, how deeply it is nested. */
  indent?: number;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  /** The text without formatting (paragraphs joined by newlines); what search and copying read. */
  text: string;
  /** The text with its formatting. Absent when it has none, as on notes from before formatting. */
  rich?: RichBlock[];
  font: string;
  size: number;
  color: string;
}

export interface ImageItem extends ItemBase {
  kind: 'image';
  /** Key of the image bytes in this notebook's blob store. */
  blobId: string;
  /** The part of the image shown in the box; absent for all of it. */
  crop?: CropRect;
  /** Mirrored across its vertical axis (h), horizontal axis (v), or both. Absent for neither. */
  flip?: 'h' | 'v' | 'hv';
}

export interface StickyItem extends ItemBase {
  kind: 'sticky';
  text: string;
  /** The text with its formatting; absent when it has none. */
  rich?: RichBlock[];
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

/** A strip of tape covering whatever is under it, for testing yourself. Tapping it shows what is underneath. */
export interface TapeItem extends ItemBase {
  kind: 'tape';
  color: string;
}

/** A point as fractions (0..1) of an item's box: x of its width, y of its height. */
export interface BoxPoint {
  x: number;
  y: number;
}

/** Closed shapes. Triangles and other many-sided shapes are polygons. */
export type ShapeKind = 'rect' | 'ellipse' | 'polygon';

/**
 * A shape: drawn with the Shapes tool, or ink recognised as one. Its outline is drawn like a pen
 * stroke of `width`, so it looks like the ink it came from.
 */
export interface ShapeItem extends ItemBase {
  kind: 'shape';
  shape: ShapeKind;
  /** A polygon's corners, in order, as fractions of the box. Absent for other shapes. */
  points?: BoxPoint[];
  /** Outline colour. */
  color: string;
  /** Outline width, page units. */
  width: number;
  /** Dashed or dotted outline; absent for solid. */
  dash?: Exclude<DashStyle, 'solid'>;
  /** Fill colour; absent for none. */
  fill?: string;
  /** A rectangle's corner radius, page units; absent for square corners. */
  radius?: number;
}

/** Arrowheads on a line: at its end, its start, or both. Absent for none. */
export type ArrowEnds = 'end' | 'start' | 'both';

/** Where a connector's end is fastened: an item, and a point on it as a fraction of its unturned box. */
export interface Attachment {
  id: string;
  at: BoxPoint;
}

/** How a line runs between its ends. Absent means straight. */
export type LineRoute = 'curved' | 'elbow';

/**
 * A bend, relative to the line's ends so it survives moving, scaling and turning: `t` is how far
 * along from start to end (0..1), `n` how far to the side, as a fraction of the start–end distance.
 */
export interface Bend {
  t: number;
  n: number;
}

/**
 * A line, arrow or connector. Its two ends are stored as fractions of its box, so moving and scaling
 * the box carries them. A connector is a line with an end attached to a shape (or another item): it
 * follows that item when it moves.
 */
export interface LineItem extends ItemBase {
  kind: 'line';
  /** Start and end, as fractions of the box. */
  ends: [BoxPoint, BoxPoint];
  color: string;
  width: number;
  dash?: Exclude<DashStyle, 'solid'>;
  arrow?: ArrowEnds;
  route?: LineRoute;
  /** Curved: where the curve bulges to. Elbow: `t` places the middle segment. Absent for the default. */
  bend?: Bend;
  /** What the start is attached to. */
  from?: Attachment;
  /** What the end is attached to. */
  to?: Attachment;
}

export type PageItem = TextItem | ImageItem | StickyItem | LinkItem | TapeItem | ShapeItem | LineItem;

/** Page fields a `page.updated` op can change. An undefined value means the field is absent. */
export type PagePatch = Partial<Pick<Page, 'template' | 'size' | 'paper' | 'background' | 'layers'>>;

/** Fields an `items.updated` op can change. */
export type ItemPatch = Partial<
  Omit<TextItem, 'id' | 'kind'> &
    Omit<ImageItem, 'id' | 'kind'> &
    Omit<StickyItem, 'id' | 'kind'> &
    Omit<LinkItem, 'id' | 'kind'> &
    Omit<TapeItem, 'id' | 'kind'> &
    Omit<ShapeItem, 'id' | 'kind'> &
    Omit<LineItem, 'id' | 'kind'>
>;

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
  /**
   * The page's layers, bottom to top. Absent on pages that have only ever had one layer;
   * read them with `pageLayers`.
   */
  layers?: Layer[];
}

/**
 * A layer of a page. Each layer's content is painted as a whole above the layers below it.
 * Hidden layers are not drawn or exported; locked layers can't be drawn on or edited.
 */
export interface Layer {
  id: string;
  name: string;
  hidden?: true;
  locked?: true;
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
  /**
   * A text document's content, as the editor's document (ProseMirror JSON). Images in it refer to
   * the blob store by `blobId`. Absent for notebooks and whiteboards.
   */
  text?: TextDocNode;
  /** A study set's flashcards, in the order they were made. Absent for other documents. */
  cards?: StudyCard[];
  /** A study set's review history, one entry per day studied, oldest first. Absent until studied. */
  studyLog?: StudyDay[];
}

/**
 * Loose content: strokes and items with their bounding box's top-left at (0, 0). A saved element,
 * or the drawing on a flashcard.
 */
export interface Drawing {
  strokes: Stroke[];
  items: PageItem[];
  w: number;
  h: number;
}

/** One side of a flashcard: typed text, a drawing (ink, photos, anything lassoed from a page), or both. */
export interface CardSide {
  /** '' for none. */
  text: string;
  /** Photos in it refer to the study set's blob store. */
  drawing?: Drawing;
}

/** Spaced repetition state of a card (SM-2). */
export interface ReviewState {
  /** Easiness factor, at least 1.3. */
  ease: number;
  /** Days until the next review, as last scheduled. */
  interval: number;
  /** Correct answers in a row. */
  reps: number;
  /** Times it was forgotten after being learnt. */
  lapses: number;
  /** When it is next due, ms since the epoch. */
  due: number;
  /** When it was last answered. */
  last: number;
}

export interface StudyCard {
  id: string;
  front: CardSide;
  back: CardSide;
  createdAt: number;
  /** Absent for a card not studied yet. */
  review?: ReviewState;
  /** The notebook page it was made from, for going back to it. */
  source?: { docId: string; pageId: string };
}

/** Fields a `cards.updated` op can change. */
export type CardPatch = Partial<Omit<StudyCard, 'id' | 'createdAt'>>;

/** Answers given on one day (local date, YYYY-MM-DD). */
export interface StudyDay {
  day: string;
  reviewed: number;
  /** Answered Hard, Good or Easy (not Again). */
  correct: number;
}

/** A node of a text document, as ProseMirror JSON. */
export interface TextDocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TextDocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
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
export type DocPatch = Partial<Pick<NotebookDoc, 'bookmarks' | 'outline' | 'text' | 'studyLog'>>;

/**
 * What a document is: a notebook of pages, a whiteboard (one very large page), a typed text
 * document, or a study set of flashcards. Absent on documents from before there was a choice (= notebook).
 */
export type DocKind = 'notebook' | 'whiteboard' | 'text' | 'deck';

export const DOC_KINDS: readonly DocKind[] = ['notebook', 'whiteboard', 'text', 'deck'];

export const docKind = (meta: Pick<NotebookMeta, 'kind'>): DocKind => (meta.kind && DOC_KINDS.includes(meta.kind) ? meta.kind : 'notebook');

/** Library-level projection of a notebook (what the library grid shows). */
export interface NotebookMeta {
  id: string;
  /** Absent for a notebook. */
  kind?: DocKind;
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
  /** A study set's cards, for the library: how many, and when each is due (0 for a card not studied yet). */
  deck?: DeckSummary;
}

export interface DeckSummary {
  cards: number;
  due: number[];
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
