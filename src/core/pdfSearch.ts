// Searching the text of PDF pages. Pages are given as runs of text with their boxes in page units
// (from pdf.js); matching ignores case and treats any run of whitespace as one space, so a phrase
// still matches where the PDF breaks a line or splits words into separate runs.

/** A run of text on a page and its box, in page units. */
export interface TextRun {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The run ends a line: a space is assumed before the next run. */
  eol?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageMatch {
  /** Text around the match, with the match at [start, end). */
  snippet: string;
  start: number;
  end: number;
  /** Boxes covering the matched text, one per run it spans. */
  rects: Rect[];
}

/** The page's text as one normalised string, and for each of its characters, the run and offset it came from. */
interface Flat {
  /** Lowercased, for matching. */
  text: string;
  /** The same characters in their original case, for showing. */
  shown: string;
  from: Array<[run: number, offset: number] | null>;
}

function flatten(runs: readonly TextRun[]): Flat {
  let text = '';
  let shown = '';
  const from: Flat['from'] = [];
  const push = (ch: string, src: [number, number] | null) => {
    if (/\s/.test(ch)) {
      if (!text.length || text.endsWith(' ')) return; // collapse whitespace
      text += ' ';
      shown += ' ';
      from.push(src);
      return;
    }
    // Case-folding keeps length for the text PDFs hold; fall back to the original if it wouldn't.
    const lower = ch.toLowerCase();
    text += lower.length === 1 ? lower : ch;
    shown += ch;
    from.push(src);
  };
  runs.forEach((r, i) => {
    for (let k = 0; k < r.str.length; k++) push(r.str[k], [i, k]);
    if (r.eol) push(' ', null);
  });
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    shown = shown.slice(0, -1);
    from.pop();
  }
  return { text, shown, from };
}

export function normaliseQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ').toLowerCase();
}

const SNIPPET_CONTEXT = 32;

/** Every match of `query` on a page, in reading order. */
export function findInPage(runs: readonly TextRun[], query: string): PageMatch[] {
  const q = normaliseQuery(query);
  if (!q) return [];
  const { text, shown, from } = flatten(runs);
  const out: PageMatch[] = [];
  for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
    out.push({ ...snippet(shown, at, at + q.length), rects: rectsFor(runs, from.slice(at, at + q.length)) });
  }
  return out;
}

function snippet(text: string, start: number, end: number): Pick<PageMatch, 'snippet' | 'start' | 'end'> {
  const a = Math.max(0, start - SNIPPET_CONTEXT);
  const b = Math.min(text.length, end + SNIPPET_CONTEXT);
  const pre = a > 0 ? '…' : '';
  const post = b < text.length ? '…' : '';
  return { snippet: pre + text.slice(a, b) + post, start: pre.length + start - a, end: pre.length + end - a };
}

/** One box per run the matched characters fall in, sized by the share of the run's characters they cover. */
function rectsFor(runs: readonly TextRun[], chars: Flat['from']): Rect[] {
  const spans = new Map<number, [number, number]>();
  for (const c of chars) {
    if (!c) continue;
    const [run, k] = c;
    const s = spans.get(run);
    spans.set(run, s ? [Math.min(s[0], k), Math.max(s[1], k + 1)] : [k, k + 1]);
  }
  return [...spans].map(([i, [a, b]]) => {
    const r = runs[i];
    const per = r.w / Math.max(1, r.str.length);
    return { x: r.x + a * per, y: r.y, w: (b - a) * per, h: r.h };
  });
}
