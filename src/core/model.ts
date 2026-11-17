// Document model. Plain data only — no DOM — so it can be tested in Node,
// replayed from the event log, and (later) moved into a worker or WASM core.

export const PAGE_W = 794; // A4 at 96 dpi
export const PAGE_H = 1123;

export type InkTool = 'pen' | 'highlighter';
export type ToolKind = InkTool | 'eraser' | 'lasso' | 'laser';
export type PenStyle = 'fountain' | 'ball' | 'brush';
export type EraseMode = 'stroke' | 'partial';
export type Template = 'blank' | 'ruled' | 'grid' | 'dotted';

/** One sampled input point in page coordinates. `p` is pressure in 0..1. */
export interface InputPoint {
  x: number;
  y: number;
  p: number;
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
}

export interface Page {
  id: string;
  template: Template;
  strokes: Stroke[];
}

export interface NotebookDoc {
  id: string;
  pages: Page[];
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
