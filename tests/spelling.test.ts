import { describe, expect, it } from 'vitest';
import type { Stroke } from '../src/core/model';
import { segment } from '../src/core/segment';
import { checkable, convertedText, coreWord, findMisspellings, inkColour, replacementFor, textOverInk, textSizeFor } from '../src/core/spelling';
import { LINE_HEIGHT, TEXT_PAD } from '../src/core/items';

const H = 20;
let n = 0;
const letter = (x: number, y: number, color = '#000'): Stroke => ({
  id: `s${n++}`,
  tool: 'pen',
  color,
  width: 2,
  simulatePressure: false,
  points: [
    { x, y: y + H, p: 0.5 },
    { x: x + 4, y, p: 0.5 },
    { x: x + 8, y: y + H, p: 0.5 },
    { x: x + 12, y, p: 0.5 },
  ],
});
const line = (x: number, y: number, words: number[]): Stroke[] => {
  const out: Stroke[] = [];
  let at = x;
  for (const count of words) {
    for (let i = 0; i < count; i++, at += 15) out.push(letter(at, y));
    at += 30;
  }
  return out;
};

const DICT = new Set(['the', 'quick', 'brown', 'fox', 'buy', 'milk', 'eggs', "don't"]);
const isCorrect = (w: string) => DICT.has(w) || DICT.has(w.toLowerCase());

describe('words to check', () => {
  it('strips punctuation round a word but keeps apostrophes inside it', () => {
    expect(coreWord('milk,')).toBe('milk');
    expect(coreWord('“Hello!”')).toBe('Hello');
    expect(coreWord("don't")).toBe("don't");
    expect(coreWord('...')).toBe('');
  });

  it('skips numbers, single letters and acronyms', () => {
    expect(checkable('milk')).toBe(true);
    expect(checkable('Paris')).toBe(true);
    expect(checkable('3pm')).toBe(false);
    expect(checkable('a')).toBe(false);
    expect(checkable('NASA')).toBe(false);
    expect(checkable('II')).toBe(false);
  });
});

describe('finding misspellings', () => {
  const strokes = line(100, 100, [3, 5, 3]);
  const { lines } = segment(strokes);
  const entry = [{ pageId: 'p', key: 'k', line: lines[0] }];

  it('marks the ink of each word the dictionary does not know', () => {
    const marks = findMisspellings(entry, () => 'The quikc fox.', isCorrect);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ pageId: 'p', token: 'quikc', word: 'quikc', strokeIds: lines[0].words[1].strokeIds });
    expect(marks[0].size).toBe(textSizeFor(lines[0]));
    expect(marks[0].mid).toBeCloseTo(100 + H / 2);
  });

  it('checks nothing when the text and the ink have different numbers of words', () => {
    expect(findMisspellings(entry, () => 'Thequikc fox', isCorrect)).toEqual([]);
    expect(findMisspellings(entry, () => undefined, isCorrect)).toEqual([]);
  });
});

describe('corrections and conversion', () => {
  it('keeps the punctuation and capitals of what it replaces', () => {
    expect(replacementFor('quikc,', 'quick')).toBe('quick,');
    expect(replacementFor('Teh', 'the')).toBe('The');
    expect(replacementFor('TEH', 'the')).toBe('THE');
    expect(replacementFor('“recieve”', 'receive')).toBe('“receive”');
  });

  it('runs a paragraph’s lines together and puts paragraphs on their own lines', () => {
    const { paragraphs } = segment([...line(100, 100, [3, 3]), ...line(100, 135, [3]), ...line(100, 260, [2])]);
    expect(paragraphs.map((p) => p.lines.length)).toEqual([2, 1]);
    const texts = ['buy milk', 'and eggs', 'Done'];
    const all = paragraphs.flatMap((p) => p.lines);
    expect(convertedText(paragraphs, (l) => texts[all.indexOf(l)])).toBe('buy milk and eggs\nDone');
    // Lines not read are left out.
    expect(convertedText(paragraphs, (l) => (all.indexOf(l) === 1 ? undefined : texts[all.indexOf(l)]))).toBe('buy milk\nDone');
  });

  it('writes the text over the ink, in its colour and a matching size', () => {
    const box = (h: number) => ({ minX: 0, maxX: 100, minY: 0, maxY: h });
    // Full ink height decides for a line with ascenders and descenders...
    expect(textSizeFor({ letter: 12, box: box(30) })).toBe(25);
    // ...letter height for a line of short letters.
    expect(textSizeFor({ letter: 12, box: box(12) })).toBe(20);
    expect(textSizeFor({ letter: 1, box: box(1) })).toBe(8);
    expect(inkColour([letter(0, 0, '#c00'), letter(0, 0, '#00c'), letter(0, 0, '#00c')])).toBe('#00c');
    const item = textOverInk({ minX: 100, minY: 100, maxX: 300, maxY: 130 }, 'buy milk', 28, '#00c', 110);
    expect(item).toMatchObject({ kind: 'text', text: 'buy milk', x: 100 - TEXT_PAD, w: 200 + 2 * TEXT_PAD, size: 28, color: '#00c', font: 'sans' });
    expect(item.h).toBeCloseTo(28 * LINE_HEIGHT + 2 * TEXT_PAD);
    // Centred on the first line of writing.
    expect(item.y + item.h / 2).toBeCloseTo(110);
  });
});
