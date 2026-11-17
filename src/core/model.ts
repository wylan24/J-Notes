// Document model. Plain data only — no DOM — so it can be tested in Node,
// replayed from the event log, and (later) moved into a worker or WASM core.

export const PAGE_W = 794; // A4 at 96 dpi
export const PAGE_H = 1123;

export type InkTool = 'pen' | 'highlighter';
export type ToolKind = InkTool | 'shapes' | 'text' | 'sticky' | 'eraser' | 'lasso' | 'laser';
export type PenStyle = 'fountain' | 'ball' | 'brush';
export type EraseMode = 'stroke' | 'partial';
export type Template = 'blank' | 'ruled' | 'grid' | 'dotted';

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

export type PageItem = TextItem | ImageItem | StickyItem;

/** Fields an `items.updated` op can change. */
export type ItemPatch = Partial<Omit<TextItem, 'id' | 'kind'> & Omit<ImageItem, 'id' | 'kind'> & Omit<StickyItem, 'id' | 'kind'>>;

export interface Page {
  id: string;
  template: Template;
  strokes: Stroke[];
  /** Text boxes, images and sticky notes, in z-order. */
  items: PageItem[];
}

/** Pages saved before items existed have no `items`; give them an empty list. */
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
}

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
}
