import { describe, expect, it } from 'vitest';
import { corpusScore, editDistance, loose, score, timing } from '../spike/hwr/metrics';
import { splitWords } from '../spike/hwr/segment';
import { PROMPTS } from '../spike/hwr/prompts';

describe('HWR spike scoring', () => {
  it('counts edits', () => {
    expect(editDistance([...'kitten'], [...'sitting'])).toBe(3);
    expect(editDistance([], [...'abc'])).toBe(3);
    expect(editDistance(['a', 'b'], ['a', 'b'])).toBe(0);
  });

  it('scores characters and words', () => {
    expect(score('the cat sat', 'the cat sat')).toEqual({ cer: 0, wer: 0 });
    const s = score('the cat sat', 'the bat sat');
    expect(s.cer).toBeCloseTo(1 / 11);
    expect(s.wer).toBeCloseTo(1 / 3);
    expect(score('', '')).toEqual({ cer: 0, wer: 0 });
    expect(score('', 'x')).toEqual({ cer: 1, wer: 1 });
  });

  it('loose matching ignores case and punctuation', () => {
    expect(loose('Don’t   STOP, now!')).toBe('dont stop now');
    expect(corpusScore([{ truth: 'Hello, World', guess: 'hello world' }], loose)).toEqual({ cer: 0, wer: 0 });
  });

  it('sums errors over the set rather than averaging lines', () => {
    const s = corpusScore([
      { truth: 'ab', guess: 'xb' },
      { truth: 'abcdefgh', guess: 'abcdefgh' },
    ]);
    expect(s.cer).toBeCloseTo(1 / 10);
  });

  it('summarises times', () => {
    expect(timing([5, 1, 3])).toEqual({ n: 3, median: 3, p95: 5, max: 5 });
    expect(timing([1, 2, 3, 4]).median).toBe(2.5);
    expect(timing(Array.from({ length: 100 }, (_, i) => i + 1)).p95).toBe(95);
    expect(timing([]).n).toBe(0);
  });
});

describe('HWR spike word splitting', () => {
  // A "letter" is a 20-unit-tall vertical stroke at x.
  const letter = (x: number, h = 20) => [
    { x, y: 0 },
    { x: x + 8, y: h },
  ];

  it('splits at gaps wider than a letter height', () => {
    // "ab cd": letters 4 units apart, words 30 apart, letters 20 tall.
    const strokes = [letter(0), letter(12), letter(50), letter(62)];
    expect(splitWords(strokes)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('keeps an i-dot and a crossing stroke with their word, whatever order they were written in', () => {
    const dot = [
      { x: 14, y: -10 },
      { x: 15, y: -9 },
    ];
    const strokes = [letter(50), letter(0), dot, letter(12)];
    expect(splitWords(strokes)).toEqual([[1, 2, 3], [0]]);
  });

  it('keeps a gap of under a letter height inside a word', () => {
    expect(splitWords([letter(0), letter(26)])).toEqual([[0, 1]]);
  });

  it('joins a comma written apart to the word before it, but not a one-letter word', () => {
    const comma = [
      { x: 60, y: 16 },
      { x: 57, y: 24 },
    ];
    // "ab, a": the comma is 32 units after "ab"; the lone "a" is a full letter.
    expect(splitWords([letter(0), letter(12), comma, letter(100)])).toEqual([[0, 1, 2], [3]]);
  });

  it('handles nothing written', () => {
    expect(splitWords([])).toEqual([]);
  });
});

describe('HWR spike prompts', () => {
  it('has 50 distinct prompts using only characters both models can write out', () => {
    expect(PROMPTS).toHaveLength(50);
    expect(new Set(PROMPTS).size).toBe(50);
    // SimpleHTR's charset: letters, digits and these marks.
    for (const p of PROMPTS) expect(p).toMatch(/^[A-Za-z0-9 !"#&'()*+,\-./:;?]+$/);
  });
});
