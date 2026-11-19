// Paper templates as geometry: the lines, dots and labels each template puts on a page of a
// given size. Plain data so layouts can be tested at every page size; render/page.ts paints them.
import { DEFAULT_PAGE_SIZE, type PageSize, type Template } from './model';

/** How a line is coloured: faint writing rules, the red margin, grid cells, or heavier structure. */
export type LineTone = 'rule' | 'margin' | 'grid' | 'strong';

export interface TemplateLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tone: LineTone;
}

export interface TemplateLabel {
  x: number;
  y: number;
  text: string;
}

export interface TemplateLayout {
  lines: TemplateLine[];
  dots: { x: number; y: number }[];
  labels: TemplateLabel[];
}

/** Spacing of writing lines on lined paper. */
const RULE = 32;
/** First writing line on lined paper. */
const FIRST_RULE = 112;
const CELL = 28;

/** Line spacing of the paper, in page units; null for paper without regular writing lines. */
export function linePitch(template: Template): number | null {
  switch (template) {
    case 'ruled':
    case 'legal':
    case 'cornell':
      return RULE;
    case 'grid':
      return CELL;
    default:
      return null;
  }
}

/** The x of the Cornell cue column's right edge. */
export function cornellCueX(size: PageSize): number {
  return Math.round(size.w * 0.3);
}

/** Top of the Cornell summary area: about the bottom fifth of the page, on a ruled line. */
export function cornellSummaryY(size: PageSize): number {
  return FIRST_RULE + Math.max(1, Math.floor((size.h * 0.8 - FIRST_RULE) / RULE)) * RULE;
}

/** Where handwriting starts on a line: just right of the margin on paper that has one. */
export function writingLeft(template: Template, size: PageSize = DEFAULT_PAGE_SIZE): number {
  switch (template) {
    case 'ruled':
      return 104;
    case 'legal':
      return 104;
    case 'cornell':
      return cornellCueX(size) + 8;
    default:
      return 32;
  }
}

const hLine = (y: number, x1: number, x2: number, tone: LineTone): TemplateLine => ({ x1, y1: y, x2, y2: y, tone });
const vLine = (x: number, y1: number, y2: number, tone: LineTone): TemplateLine => ({ x1: x, y1, x2: x, y2, tone });

function rules(from: number, to: number, x1: number, x2: number, out: TemplateLine[]): void {
  for (let y = from; y < to; y += RULE) out.push(hLine(y, x1, x2, 'rule'));
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Notes'];

/** Five-line staves, spread evenly down the page. */
export const STAFF_GAP = 10;
const STAFF_SPACE = 48;
const MUSIC_MARGIN = 48;

export function templateLayout(template: Template, size: PageSize): TemplateLayout {
  const { w, h } = size;
  const lines: TemplateLine[] = [];
  const dots: TemplateLayout['dots'] = [];
  const labels: TemplateLabel[] = [];

  switch (template) {
    case 'ruled':
      rules(FIRST_RULE, h - 40, 0, w, lines);
      lines.push(vLine(96, 0, h, 'margin'));
      break;

    case 'legal':
      // A heavier header rule, writing lines, and the double margin of a legal pad.
      lines.push(hLine(80, 0, w, 'margin'));
      rules(FIRST_RULE, h - 40, 0, w, lines);
      lines.push(vLine(90, 0, h, 'margin'), vLine(96, 0, h, 'margin'));
      break;

    case 'cornell': {
      // Title band, cue column on the left, notes on the right, summary across the bottom.
      const cue = cornellCueX(size);
      const summary = cornellSummaryY(size);
      lines.push(hLine(80, 0, w, 'strong'));
      rules(FIRST_RULE, summary, 0, w, lines);
      lines.push(vLine(cue, 80, summary, 'strong'));
      lines.push(hLine(summary, 0, w, 'strong'));
      rules(summary + RULE * 2, h - 40, 0, w, lines);
      labels.push({ x: 16, y: 100, text: 'Cues' }, { x: cue + 12, y: 100, text: 'Notes' }, { x: 16, y: summary + 22, text: 'Summary' });
      break;
    }

    case 'grid':
      for (let x = CELL; x < w; x += CELL) lines.push(vLine(x, 0, h, 'grid'));
      for (let y = CELL; y < h; y += CELL) lines.push(hLine(y, 0, w, 'grid'));
      break;

    case 'dotted':
      for (let x = CELL; x < w; x += CELL) for (let y = CELL; y < h; y += CELL) dots.push({ x, y });
      break;

    case 'music': {
      const staff = STAFF_GAP * 4;
      const block = staff + STAFF_SPACE;
      const top = 72;
      const bottom = h - MUSIC_MARGIN;
      const n = Math.max(1, Math.floor((bottom - top + STAFF_SPACE) / block));
      const start = top + Math.max(0, (bottom - top - (n * block - STAFF_SPACE)) / 2);
      const x1 = MUSIC_MARGIN, x2 = w - MUSIC_MARGIN;
      for (let i = 0; i < n; i++) {
        const y0 = start + i * block;
        for (let k = 0; k < 5; k++) lines.push(hLine(y0 + k * STAFF_GAP, x1, x2, 'strong'));
        lines.push(vLine(x1, y0, y0 + staff, 'strong'), vLine(x2, y0, y0 + staff, 'strong'));
      }
      break;
    }

    case 'planner': {
      // A header, then seven days and a notes box: 2 columns on portrait pages, 4 on landscape.
      const cols = w > h ? 4 : 2;
      const rows = WEEKDAYS.length / cols;
      const left = 24, right = w - 24, top = 72, bottom = h - 24;
      const cw = (right - left) / cols;
      const rh = (bottom - top) / rows;
      labels.push({ x: left, y: 44, text: 'Week of' });
      lines.push(hLine(52, left + 64, Math.min(right, left + 320), 'rule'));
      for (let c = 0; c <= cols; c++) lines.push(vLine(left + c * cw, top, bottom, 'strong'));
      for (let r = 0; r <= rows; r++) lines.push(hLine(top + r * rh, left, right, 'strong'));
      WEEKDAYS.forEach((day, i) => {
        const x = left + (i % cols) * cw;
        const y = top + Math.floor(i / cols) * rh;
        labels.push({ x: x + 10, y: y + 22, text: day });
        rules(y + 32 + RULE, y + rh - 8, x + 8, x + cw - 8, lines);
      });
      break;
    }

    case 'blank':
      break;
  }
  return { lines, dots, labels };
}

/**
 * The part of a template inside `region` (page units), for painting one tile of a large page.
 * Grids and dots are generated for the region alone; other templates are filtered.
 */
export function templateLayoutIn(template: Template, size: PageSize, region: { minX: number; minY: number; maxX: number; maxY: number }): TemplateLayout {
  const minX = Math.max(0, region.minX), minY = Math.max(0, region.minY);
  const maxX = Math.min(size.w, region.maxX), maxY = Math.min(size.h, region.maxY);
  const first = (lo: number) => Math.max(CELL, Math.ceil(lo / CELL) * CELL);
  if (template === 'grid') {
    const lines: TemplateLine[] = [];
    for (let x = first(minX); x <= maxX && x < size.w; x += CELL) lines.push(vLine(x, minY, maxY, 'grid'));
    for (let y = first(minY); y <= maxY && y < size.h; y += CELL) lines.push(hLine(y, minX, maxX, 'grid'));
    return { lines, dots: [], labels: [] };
  }
  if (template === 'dotted') {
    const dots: TemplateLayout['dots'] = [];
    for (let x = first(minX - 1); x <= maxX + 1 && x < size.w; x += CELL) for (let y = first(minY - 1); y <= maxY + 1 && y < size.h; y += CELL) dots.push({ x, y });
    return { lines: [], dots, labels: [] };
  }
  const all = templateLayout(template, size);
  const inX = (a: number, b: number) => Math.max(a, b) >= minX && Math.min(a, b) <= maxX;
  const inY = (a: number, b: number) => Math.max(a, b) >= minY && Math.min(a, b) <= maxY;
  return {
    lines: all.lines.filter((l) => inX(l.x1, l.x2) && inY(l.y1, l.y2)),
    dots: all.dots.filter((d) => inX(d.x, d.x) && inY(d.y, d.y)),
    labels: all.labels.filter((l) => inY(l.y - 16, l.y)),
  };
}
