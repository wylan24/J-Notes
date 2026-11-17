// Geometry, layout and factories for page items (text boxes, images, sticky notes).
// Pure: text measuring is passed in, so this runs in Node tests and the renderer alike.
import { DEFAULT_PAGE_SIZE, type ImageItem, type PageSize, type Page, type PageItem, type StickyItem, type TextItem } from './model';
import type { Bounds, Vec } from './geometry';
import { newId } from './ids';

export type MeasureText = (s: string) => number;

export const TEXT_PAD = 4;
export const LINE_HEIGHT = 1.3;
export const STICKY_PAD = 12;
export const STICKY_TEXT_SIZE = 16;
/** Side of a collapsed sticky note's icon, in page units. */
export const STICKY_ICON = 28;

export type FontKey = 'sans' | 'serif' | 'mono';
export const FONTS: Record<FontKey, string> = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};
export const fontFamily = (font: string): string => FONTS[font as FontKey] ?? FONTS.sans;

export interface TextStyle {
  font: string;
  size: number;
  color: string;
}

/** Word-wrap `text` to `maxWidth`. Explicit newlines are kept; words longer than a line are broken. */
export function wrapLines(text: string, maxWidth: number, measure: MeasureText): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const candidate = line + word;
      if (!line || measure(candidate) <= maxWidth) {
        line = candidate;
      } else if (/^\s+$/.test(word)) {
        continue; // whitespace at a wrap point is dropped, as browsers do
      } else {
        out.push(line.trimEnd());
        line = word;
      }
      // Break a single over-long word across lines.
      while (measure(line) > maxWidth && line.length > 1) {
        let n = line.length - 1;
        while (n > 1 && measure(line.slice(0, n)) > maxWidth) n--;
        out.push(line.slice(0, n));
        line = line.slice(n);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function textLines(t: Pick<TextItem, 'text' | 'w'>, measure: MeasureText): string[] {
  return wrapLines(t.text, Math.max(1, t.w - 2 * TEXT_PAD), measure);
}

export function textHeight(t: Pick<TextItem, 'text' | 'w' | 'size'>, measure: MeasureText): number {
  return textLines(t, measure).length * t.size * LINE_HEIGHT + 2 * TEXT_PAD;
}

export function itemBounds(it: PageItem): Bounds {
  const collapsed = it.kind === 'sticky' && it.collapsed;
  const w = collapsed ? STICKY_ICON : it.w;
  const h = collapsed ? STICKY_ICON : it.h;
  return { minX: it.x, minY: it.y, maxX: it.x + w, maxY: it.y + h };
}

/** The topmost item at `pt`. Sticky notes are drawn above everything, so they are hit first. */
export function itemAt(page: Page, pt: Vec, kinds?: PageItem['kind'][]): PageItem | null {
  const hit = (it: PageItem) => {
    if (kinds && !kinds.includes(it.kind)) return false;
    const b = itemBounds(it);
    return pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY;
  };
  const items = page.items;
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'sticky' && hit(items[i])) return items[i];
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind !== 'sticky' && hit(items[i])) return items[i];
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Keep a w×h box on the page. */
function onPage(x: number, y: number, w: number, h: number, size: PageSize): Vec {
  return { x: clamp(x, 0, Math.max(0, size.w - w)), y: clamp(y, 0, Math.max(0, size.h - h)) };
}

/** A new, empty text box whose first line sits on `pt`. */
export function newText(pt: Vec, style: TextStyle, size: PageSize = DEFAULT_PAGE_SIZE): TextItem {
  const w = clamp(size.w - pt.x - 16, 80, 280);
  const h = style.size * LINE_HEIGHT + 2 * TEXT_PAD;
  const at = onPage(pt.x - TEXT_PAD, pt.y - h / 2, w, h, size);
  return { id: newId(), kind: 'text', ...at, w, h, text: '', ...style };
}

export function newSticky(center: Vec, color: string, size: PageSize = DEFAULT_PAGE_SIZE): StickyItem {
  const side = 180;
  const at = onPage(center.x - side / 2, center.y - side / 2, side, side, size);
  return { id: newId(), kind: 'sticky', ...at, w: side, h: side, text: '', color, collapsed: false };
}

/** Size and place an image of the given natural size, centred on `center`, scaled down to fit the page. */
export function fitImage(naturalW: number, naturalH: number, center: Vec, size: PageSize = DEFAULT_PAGE_SIZE): { x: number; y: number; w: number; h: number } {
  const k = Math.min(1, (size.w * 0.7) / naturalW, (size.h * 0.5) / naturalH);
  const w = Math.max(1, naturalW * k);
  const h = Math.max(1, naturalH * k);
  return { ...onPage(center.x - w / 2, center.y - h / 2, w, h, size), w, h };
}

export function newImage(blobId: string, naturalW: number, naturalH: number, center: Vec, size: PageSize = DEFAULT_PAGE_SIZE): ImageItem {
  return { id: newId(), kind: 'image', blobId, ...fitImage(naturalW, naturalH, center, size) };
}

/**
 * The item resized from its top-left corner toward (w, h). Images keep their aspect ratio,
 * text boxes only change width (their height follows the text), and every kind has a minimum size.
 */
export function resizeItem<T extends PageItem>(it: T, w: number, h: number, measure: MeasureText): T {
  switch (it.kind) {
    case 'image': {
      const k = Math.max(24 / it.w, 24 / it.h, w / it.w);
      return { ...it, w: it.w * k, h: it.h * k };
    }
    case 'text': {
      const next: TextItem = { ...it, w: Math.max(40, w) };
      return { ...next, h: textHeight(next, measure) } as T;
    }
    default:
      return { ...it, w: Math.max(60, w), h: Math.max(60, h) };
  }
}
