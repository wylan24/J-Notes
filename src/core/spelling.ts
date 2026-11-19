// Convert-to-text and spellcheck on recognised handwriting. Pure: the recognised text comes from
// the handwriting cache (./handwriting), and the dictionary is passed in as a function.
import type { Stroke, TextItem } from './model';
import type { Bounds } from './geometry';
import type { InkLine, InkParagraph } from './segment';
import { LINE_HEIGHT, TEXT_PAD } from './items';
import { newId } from './ids';

/** A word on a page that the dictionary doesn't know. */
export interface Misspelling {
  pageId: string;
  /** The word's ink. */
  strokeIds: string[];
  box: Bounds;
  /** The word as recognised, with any punctuation around it. */
  token: string;
  /** The letters checked: the token without leading and trailing punctuation. */
  word: string;
  /** A font size matching its line's writing, for the correction. */
  size: number;
  /** The middle of its line at the word, where the correction is centred. */
  mid: number;
}

/** The letters of a token, without punctuation around it ("milk," → "milk", "‘don’t’" → "don’t"). */
export function coreWord(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Whether a word is worth checking: letters (and apostrophes) only, at least two of them, and not
 * an acronym in capitals (Q3, NASA, II), which no dictionary is expected to hold.
 */
export function checkable(word: string): boolean {
  return word.length >= 2 && /^[\p{L}'’]+$/u.test(word) && word !== word.toUpperCase();
}

/**
 * The misspelt words in recognised lines. Only lines whose text has as many words as the ink are
 * checked, since only then is it known which ink each word is.
 */
export function findMisspellings(
  lines: readonly { pageId: string; key: string; line: InkLine }[],
  textOf: (key: string) => string | undefined,
  isCorrect: (word: string) => boolean,
): Misspelling[] {
  const out: Misspelling[] = [];
  for (const { pageId, key, line } of lines) {
    const tokens = textOf(key)?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (!tokens.length || tokens.length !== line.words.length) continue;
    tokens.forEach((token, i) => {
      const word = coreWord(token);
      if (!checkable(word) || isCorrect(word)) return;
      const w = line.words[i];
      out.push({ pageId, strokeIds: w.strokeIds, box: w.box, token, word, size: textSizeFor(line), mid: (line.box.minY + line.box.maxY) / 2 });
    });
  }
  return out;
}

/** A correction in the shape of what it replaces: same punctuation around it, capitalised the same way. */
export function replacementFor(token: string, suggestion: string): string {
  const word = coreWord(token);
  const at = token.indexOf(word);
  const before = at >= 0 ? token.slice(0, at) : '';
  const after = at >= 0 ? token.slice(at + word.length) : '';
  let fixed = suggestion;
  if (word.length > 1 && word === word.toUpperCase()) fixed = suggestion.toUpperCase();
  else if (word[0] && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) fixed = suggestion[0].toUpperCase() + suggestion.slice(1);
  return before + fixed + after;
}

/**
 * The text of handwriting, for converting: a paragraph's lines run together (so the text box
 * rewraps them), paragraphs on lines of their own. Lines not read are left out.
 */
export function convertedText(paras: readonly InkParagraph[], textOf: (line: InkLine) => string | undefined): string {
  return paras
    .map((p) => p.lines.map((l) => textOf(l)?.trim() ?? '').filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n');
}

/**
 * The font size that matches a line of handwriting. Two estimates, taking the larger: the line's
 * ink from top to bottom (ascenders to descenders), which in type is about 1.2 of the font size,
 * and its letter height, about 0.6 of it. A line of short letters only ("a man ran") has a small
 * ink height but a fair letter height; a line of mostly short letters with a few tall ones has a
 * small letter height but a full ink height.
 */
export function textSizeFor(line: Pick<InkLine, 'letter' | 'box'>): number {
  const size = Math.max(line.letter / 0.6, (line.box.maxY - line.box.minY) / 1.2);
  return Math.max(8, Math.min(96, Math.round(size)));
}

/** The most used colour among the strokes (what the converted text is written in). */
export function inkColour(strokes: readonly Stroke[]): string {
  const counts = new Map<string, number>();
  for (const s of strokes) counts.set(s.color, (counts.get(s.color) ?? 0) + s.points.length);
  let best = '#000000', most = -1;
  for (const [c, n] of counts) if (n > most) [best, most] = [c, n];
  return best;
}

/**
 * A text box over handwriting's box, in the ink's colour, its first line of text centred on `mid`
 * (the middle of the first line of writing). Its height is one line; the caller measures the real
 * height once the text is known.
 */
export function textOverInk(box: Bounds, text: string, size: number, color: string, mid: number, minWidth = 40): TextItem {
  const h = size * LINE_HEIGHT + 2 * TEXT_PAD;
  const w = Math.max(minWidth, box.maxX - box.minX + 2 * TEXT_PAD);
  return { id: newId(), kind: 'text', x: box.minX - TEXT_PAD, y: mid - h / 2, w, h, text, font: 'sans', size, color };
}
