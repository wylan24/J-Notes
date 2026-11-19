// Formatted text in text boxes and sticky notes: bold, italic, highlight, bulleted and numbered
// lists, and indents. The editor (TipTap) is only loaded to edit; the page, thumbnails and PDF
// export draw from this pure layout, so they agree with each other.
import type { RichBlock, RichRun } from './model';

/** Width of `s` in the item's font, in bold and/or italic. */
export type MeasureStyled = (s: string, bold?: boolean, italic?: boolean) => number;

/** One indent step, as a multiple of the font size. Also the gutter a list marker sits in. */
export const INDENT_EM = 1.5;
/** Default highlight colour. */
export const HIGHLIGHT = '#fde68a';

export interface RichPiece {
  text: string;
  /** Left edge, from the start of the text area. */
  x: number;
  w: number;
  b?: true;
  i?: true;
  hl?: string;
}

export interface RichLine {
  pieces: RichPiece[];
  /** A list item's bullet or number, on its first line. */
  marker?: { text: string; x: number };
}

const sameStyle = (a: Pick<RichRun, 'b' | 'i' | 'hl'>, b: Pick<RichRun, 'b' | 'i' | 'hl'>) => !!a.b === !!b.b && !!a.i === !!b.i && a.hl === b.hl;
const styleOf = (r: Pick<RichRun, 'b' | 'i' | 'hl'>): Pick<RichRun, 'b' | 'i' | 'hl'> => ({ ...(r.b ? { b: true } : {}), ...(r.i ? { i: true } : {}), ...(r.hl ? { hl: r.hl } : {}) });

/** The text without formatting: paragraphs joined by newlines. */
export function plainText(blocks: readonly RichBlock[]): string {
  return blocks.map((b) => b.runs.map((r) => r.text).join('')).join('\n');
}

/** Plain text as unformatted paragraphs, one per line. */
export function blocksFromPlain(text: string): RichBlock[] {
  return text.split('\n').map((t) => ({ runs: t ? [{ text: t }] : [] }));
}

/** Whether the blocks have no formatting at all, so plain text says everything. */
export function isPlain(blocks: readonly RichBlock[]): boolean {
  return blocks.every((b) => !b.list && !b.indent && b.runs.every((r) => !r.b && !r.i && !r.hl));
}

/** Tidy blocks: empty runs dropped, neighbouring runs in the same style merged, zero indents removed. */
export function normalizeBlocks(blocks: readonly RichBlock[]): RichBlock[] {
  return blocks.map((b) => {
    const runs: RichRun[] = [];
    for (const r of b.runs) {
      if (!r.text) continue;
      const last = runs[runs.length - 1];
      if (last && sameStyle(last, r)) last.text += r.text;
      else runs.push({ text: r.text, ...styleOf(r) });
    }
    const indent = Math.max(0, Math.min(8, Math.round(b.indent ?? 0)));
    return { runs, ...(b.list ? { list: b.list } : {}), ...(indent ? { indent } : {}) };
  });
}

/** The formatted text of an item: its `rich` blocks, or its plain text as paragraphs. */
export const itemBlocks = (it: { text: string; rich?: RichBlock[] }): RichBlock[] => it.rich ?? blocksFromPlain(it.text);

/**
 * The patch that stores edited blocks on an item: `text` always, `rich` only when there is
 * formatting (undefined removes it).
 */
export function richPatch(blocks: readonly RichBlock[]): { text: string; rich: RichBlock[] | undefined } {
  const tidy = normalizeBlocks(blocks);
  return { text: plainText(tidy), rich: isPlain(tidy) ? undefined : tidy };
}

const BULLETS = ['•', '◦', '▪'];

export type BulletShape = 'disc' | 'circle' | 'square';
/** How to draw a bullet marker (drawn as a shape, since not every font has these glyphs), or null for a number. */
export function bulletShape(marker: string): BulletShape | null {
  return marker === '•' ? 'disc' : marker === '◦' ? 'circle' : marker === '▪' ? 'square' : null;
}

/**
 * Where a marker goes, from the start of the text area: a bullet's centre is half the font size into
 * its gutter; a number ends a little before the text. (As the editor shows them.)
 */
export function markerPlace(marker: { text: string; x: number }, size: number): { cx: number; right: number; r: number } {
  return { cx: marker.x + size * 0.5, right: marker.x + size * INDENT_EM - size * 0.3, r: size * 0.15 };
}

/** Each block's list marker: bullets by depth, numbers counting up through a list (and restarting after it). */
export function listMarkers(blocks: readonly RichBlock[]): (string | null)[] {
  const counters: number[] = [];
  return blocks.map((b) => {
    const level = b.indent ?? 0;
    if (!b.list) {
      counters.length = 0;
      return null;
    }
    counters.length = Math.min(counters.length, level + 1);
    if (b.list === 'bullet') {
      counters[level] = 0;
      return BULLETS[level % BULLETS.length];
    }
    counters[level] = (counters[level] ?? 0) + 1;
    return `${counters[level]}.`;
  });
}

interface Token {
  text: string;
  style: Pick<RichRun, 'b' | 'i' | 'hl'>;
  /** A line break inside the paragraph. */
  br?: true;
}

function tokens(runs: readonly RichRun[]): Token[] {
  const out: Token[] = [];
  for (const r of runs) {
    const style = styleOf(r);
    r.text.split('\n').forEach((seg, i) => {
      if (i) out.push({ text: '', style, br: true });
      for (const w of seg.split(/(\s+)/)) if (w) out.push({ text: w, style });
    });
  }
  return out;
}

/**
 * Lay formatted text out in lines no wider than `maxWidth`, wrapping between words as plain text
 * does (whitespace at a wrap is dropped, words longer than a line are broken). Positions are from
 * the start of the text area; every line is `size × LINE_HEIGHT` tall.
 */
export function layoutRich(blocks: readonly RichBlock[], maxWidth: number, size: number, measure: MeasureStyled): RichLine[] {
  const step = size * INDENT_EM;
  const markers = listMarkers(blocks);
  const out: RichLine[] = [];
  blocks.forEach((block, bi) => {
    const level = block.indent ?? 0;
    const x0 = (level + (block.list ? 1 : 0)) * step;
    const avail = Math.max(1, maxWidth - x0);
    let line: Token[] = [];
    let width = 0;
    let first = true;
    const push = () => {
      while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
      const pieces: RichPiece[] = [];
      let x = x0;
      for (const t of line) {
        const last = pieces[pieces.length - 1];
        if (last && sameStyle(last, t.style)) last.text += t.text;
        else pieces.push({ text: t.text, x: 0, w: 0, ...t.style });
      }
      for (const p of pieces) {
        p.x = x;
        p.w = measure(p.text, !!p.b, !!p.i);
        x += p.w;
      }
      const marker = first && markers[bi] ? { text: markers[bi]!, x: level * step } : undefined;
      out.push({ pieces, ...(marker ? { marker } : {}) });
      first = false;
      line = [];
      width = 0;
    };
    for (const tok of tokens(block.runs)) {
      if (tok.br) {
        push();
        continue;
      }
      const w = measure(tok.text, !!tok.style.b, !!tok.style.i);
      if (!line.length || width + w <= avail) {
        line.push(tok);
        width += w;
      } else if (/^\s+$/.test(tok.text)) {
        continue; // whitespace at a wrap point is dropped
      } else {
        push();
        line.push(tok);
        width = w;
      }
      // Break a single over-long word across lines.
      while (line.length === 1 && width > avail && line[0].text.length > 1) {
        const t = line[0];
        let n = t.text.length - 1;
        while (n > 1 && measure(t.text.slice(0, n), !!t.style.b, !!t.style.i) > avail) n--;
        line = [{ ...t, text: t.text.slice(0, n) }];
        push();
        line = [{ ...t, text: t.text.slice(n) }];
        width = measure(line[0].text, !!t.style.b, !!t.style.i);
      }
    }
    push();
  });
  return out;
}
