import { describe, expect, it } from 'vitest';
import { analyse, canonical, formatNumber, fromLatex, fromText, MATH_PROMPTS, sameVerdict, structure } from '../spike/hwr/maths';

describe('Math Assist spike: reading', () => {
  it('turns Pix2Text’s LaTeX into the canonical form', () => {
    expect(fromLatex('1 2 \\times 7 = 8 4')).toBe('12*7=84');
    expect(fromLatex('\\frac { 1 } { 2 } + \\frac { 1 } { 4 } = \\frac { 3 } { 4 }')).toBe('(1/2)+(1/4)=(3/4)');
    expect(fromLatex('\\sqrt { 8 1 } = 9')).toBe('sqrt81=9');
    expect(fromLatex('3 ^ { 2 } + 4 ^ { 2 } = 2 5')).toBe('3^2+4^2=25');
    expect(fromLatex('1 4 4 \\div 1 2 = 1 2')).toBe('144/12=12');
    expect(fromLatex('2 5 \\% \\mathrm { o f } 8 0 = 2 0')).toBe('25%*80=20');
    expect(fromLatex('2 5 \\% o f 8 0 = 2 0')).toBe('25%*80=20');
    expect(fromLatex('3 \\left( x + 2 \\right) = 2 1')).toBe('3(x+2)=21');
    expect(structure(fromLatex('\\frac{\\frac{1}{2}}{3}'))).toBe('1/2/3');
  });

  it('turns TrOCR’s text into the canonical form, telling a times x from a variable x', () => {
    expect(fromText('8 x 7 = 56')).toBe('8*7=56');
    expect(fromText('2x + 3 = 11')).toBe('2x+3=11');
    expect(fromText('45 − 18 = 27')).toBe('45-18=27');
    expect(fromText('3² + 4² = 25')).toBe('3^2+4^2=25');
    expect(fromText('√81 = 9')).toBe('sqrt81=9');
    expect(fromText('25% of 80 = 20')).toBe('25%*80=20');
  });

  it('compares readings by structure, whatever brackets and times signs they use', () => {
    expect(structure(fromLatex('\\frac { 1 } { 2 } + \\frac { 1 } { 4 } = \\frac { 3 } { 4 }'))).toBe(structure('1/2+1/4=3/4'));
    expect(structure('3(x+2)=21')).toBe('3*(x+2)=21');
    expect(structure('17*23=')).toBe('17*23=');
    expect(structure('10-(4-3)=9')).toBe('10-(4-3)=9');
    expect(structure('(10-4)-3=3')).toBe('10-4-3=3');
    expect(structure('2^3^2=')).toBe('2^3^2=');
    expect(structure('(2^3)^2=')).toBe('(2^3)^2=');
    expect(structure('x+((=')).toBe('x+((=');
  });

  it('compares in one form: no spaces, lone brackets or droppable times signs', () => {
    expect(canonical('3 * (x + 2) = 21')).toBe('3(x+2)=21');
    expect(canonical('(1)/(2)')).toBe('1/2');
    expect(canonical('2*x')).toBe('2x');
  });
});

describe('Math Assist spike: solving and checking', () => {
  it('answers, checks and solves every prompt as intended', () => {
    const seen = MATH_PROMPTS.map((p) => analyse(p.truth));
    expect(seen.filter((a) => a.kind === 'none')).toEqual([]);
    expect(seen.filter((a) => a.kind === 'check' && !a.correct)).toHaveLength(2);
    expect(analyse('17*23=')).toEqual({ kind: 'answer', value: 391 });
    expect(analyse('9*6=56')).toEqual({ kind: 'check', correct: false, value: 54 });
    expect(analyse('25%*80=20')).toMatchObject({ kind: 'check', correct: true });
    expect(analyse('sqrt(81)=9')).toMatchObject({ kind: 'check', correct: true });
    expect(analyse('1/2+1/4=3/4')).toMatchObject({ kind: 'check', correct: true });
    expect(analyse('2x+3=11')).toEqual({ kind: 'solve', variable: 'x', values: [4] });
    expect(analyse('3(x+2)=21')).toEqual({ kind: 'solve', variable: 'x', values: [5] });
    expect(analyse('x^2-5x+6=0')).toEqual({ kind: 'solve', variable: 'x', values: [2, 3] });
    expect(analyse('x^2=49')).toEqual({ kind: 'solve', variable: 'x', values: [-7, 7] });
    expect(analyse('4y=2y+10')).toEqual({ kind: 'solve', variable: 'y', values: [5] });
  });

  it('says when it can’t help', () => {
    expect(analyse('12+7')).toMatchObject({ kind: 'none' });
    expect(analyse('x+y=3')).toMatchObject({ kind: 'none' });
    expect(analyse('x^3=8')).toMatchObject({ kind: 'none' });
    expect(analyse('2x+=')).toMatchObject({ kind: 'none' });
    expect(analyse('x+1=')).toMatchObject({ kind: 'none' });
  });

  it('compares verdicts as a person would see them', () => {
    expect(sameVerdict(analyse('8*7=56'), analyse('(8)*(7)=56'))).toBe(true);
    expect(sameVerdict(analyse('9*6=56'), analyse('9*6=54'))).toBe(false);
    expect(sameVerdict(analyse('2x+3=11'), analyse('2x+3=1l'))).toBe(false);
  });

  it('writes answers as a person would', () => {
    expect(formatNumber(391)).toBe('391');
    expect(formatNumber(0.75)).toBe('3/4');
    expect(formatNumber(1 / 3)).toBe('1/3');
    expect(formatNumber(Math.SQRT2)).toBe('1.41421');
  });
});
