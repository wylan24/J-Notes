// Math Assist spike (task 10.5): what a line of handwritten maths says, and what to do with it.
// Model output (LaTeX from Pix2Text, plain text from TrOCR) is normalised to one ASCII form, parsed,
// and analysed: an unfinished sum gets its answer, a finished one is checked, and an equation in one
// variable (up to quadratic) is solved. Pure, so it is unit-tested.

/** A line to write for the spike: how it is shown, and what it says in canonical form. */
export interface MathPrompt {
  shown: string;
  truth: string;
  /** How to write it, when "on one line" isn't enough. */
  note?: string;
}

export const MATH_PROMPTS: readonly MathPrompt[] = [
  { shown: '12 + 7 = 19', truth: '12+7=19' },
  { shown: '45 − 18 = 27', truth: '45-18=27' },
  { shown: '8 × 7 = 56', truth: '8*7=56' },
  { shown: '9 × 6 = 56', truth: '9*6=56', note: 'wrong on purpose' },
  { shown: '144 ÷ 12 = 12', truth: '144/12=12' },
  { shown: '3.5 + 2.25 = 5.75', truth: '3.5+2.25=5.75' },
  { shown: '0.2 × 0.4 = 0.08', truth: '0.2*0.4=0.08' },
  { shown: '25% of 80 = 20', truth: '25%*80=20' },
  { shown: '3² + 4² = 25', truth: '3^2+4^2=25' },
  { shown: '2³ = 8', truth: '2^3=8' },
  { shown: '√81 = 9', truth: 'sqrt(81)=9' },
  { shown: '(4 + 5) × 3 = 27', truth: '(4+5)*3=27' },
  { shown: '7 × (8 − 3) = 35', truth: '7*(8-3)=35' },
  { shown: '100 − 4 × 9 = 64', truth: '100-4*9=64' },
  { shown: '7 + 6 = 14', truth: '7+6=14', note: 'wrong on purpose' },
  { shown: '17 × 23 =', truth: '17*23=' },
  { shown: '1.2 × 3 =', truth: '1.2*3=' },
  { shown: '360 ÷ 8 =', truth: '360/8=' },
  { shown: '6² − 5 =', truth: '6^2-5=' },
  { shown: '2x + 3 = 11', truth: '2x+3=11' },
  { shown: '5x − 7 = 18', truth: '5x-7=18' },
  { shown: '3(x + 2) = 21', truth: '3(x+2)=21' },
  { shown: 'x ÷ 4 = 7', truth: 'x/4=7' },
  { shown: 'x² = 49', truth: 'x^2=49' },
  { shown: 'x² − 5x + 6 = 0', truth: 'x^2-5x+6=0' },
  { shown: '4y = 2y + 10', truth: '4y=2y+10' },
  { shown: 'a + 15 = 32', truth: 'a+15=32' },
  { shown: '½ + ¼ = ¾', truth: '1/2+1/4=3/4', note: 'write the fractions stacked, one number over the other' },
  { shown: '⅔ × ¾ = ½', truth: '2/3*3/4=1/2', note: 'write the fractions stacked' },
  { shown: '⅗ + ⅕ =', truth: '3/5+1/5=', note: 'write the fractions stacked' },
];

// --- Normalising ---------------------------------------------------------------------------------

/** The argument of a LaTeX command at `i` (a braced group or one character), and where it ends. */
function group(s: string, i: number): [string, number] {
  while (s[i] === ' ') i++;
  if (s[i] !== '{') return [s[i] ?? '', i + 1];
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

/** LaTeX (as Pix2Text writes it) to the canonical ASCII form. */
export function fromLatex(latex: string): string {
  let s = latex;
  // \frac{a}{b} and \sqrt{a}, one at a time from the left (their arguments may hold more).
  for (let m = /\\[dt]?frac|\\sqrt/.exec(s); m; m = /\\[dt]?frac|\\sqrt/.exec(s)) {
    const start = m.index + m[0].length;
    if (m[0] === '\\sqrt') {
      const [a, end] = group(s, start);
      s = `${s.slice(0, m.index)}sqrt(${a})${s.slice(end)}`;
    } else {
      const [a, mid] = group(s, start);
      const [b, end] = group(s, mid);
      s = `${s.slice(0, m.index)}((${a})/(${b}))${s.slice(end)}`;
    }
  }
  s = s
    .replace(/\\left|\\right|\\displaystyle/g, '')
    .replace(/\\(times|cdot|ast)/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\%/g, '%')
    .replace(/\\(mathrm|text|operatorname|mathit|mathbf)\s*\{([^}]*)\}/g, '$2')
    .replace(/\\[,;:! ]|\\quad|\\qquad|~/g, '')
    .replace(/\^\s*\{([^}]*)\}/g, '^($1)')
    .replace(/_\s*\{[^}]*\}|_\s*\S/g, '')
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
    .replace(/\\[a-zA-Z]+/g, '')
    // "25% of 80": "of" is a times sign (Pix2Text spells it out, letter by letter).
    .replace(/o\s*f/g, '*');
  return canonical(s);
}

const SUPERSCRIPT: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** Plain text (as TrOCR writes it) to the canonical ASCII form. */
export function fromText(text: string): string {
  let s = text
    .replace(/[−–—]/g, '-')
    .replace(/[×✕]/g, '*')
    .replace(/÷/g, '/')
    .replace(/√\s*(\d+(?:\.\d+)?|\([^)]*\))/g, 'sqrt($1)')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `^${[...m].map((c) => SUPERSCRIPT[c]).join('')}`)
    .replace(/\bof\b/gi, '*');
  // A lone x or X between numbers, with space around it, is a times sign.
  s = s.replace(/([\d)])\s+[xX]\s+(?=[\d(])/g, '$1*');
  return canonical(s.toLowerCase());
}

/**
 * The one form both readings and the truth are compared in: no spaces, no brackets round a lone
 * number or letter, and no times sign where it can be left out (3*x → 3x, 3*(x → 3(x).
 */
export function canonical(s: string): string {
  let out = s.replace(/\s+/g, '').replace(/,/g, '.');
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/\((-?[\d.]+|[a-z])\)/g, '$1');
  }
  return out.replace(/(\d|\))\*(?=[a-z(])/g, '$1');
}

// --- Parsing and evaluating --------------------------------------------------------------------

type Node = { n: number } | { v: string } | { op: string; a: Node; b?: Node };

/** Parse an expression (no "="). Throws on anything it doesn't understand. */
export function parse(src: string): Node {
  const toks = src.match(/\d+(?:\.\d+)?|\.\d+|sqrt|[a-z]|[-+*/^()%]/g) ?? [];
  if (toks.join('') !== src) throw new Error(`can't read "${src}"`);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const startsAtom = (t?: string) => !!t && (/^[\d.a-z(]/.test(t) || t === 'sqrt');
  // Lowest to highest: + -, * / and implicit, unary -, ^, postfix %.
  function sum(): Node {
    let a = product();
    while (peek() === '+' || peek() === '-') a = { op: next(), a, b: product() };
    return a;
  }
  function product(): Node {
    let a = unary();
    for (;;) {
      if (peek() === '*' || peek() === '/') a = { op: next(), a, b: unary() };
      else if (startsAtom(peek())) a = { op: '*', a, b: power() };
      else return a;
    }
  }
  function unary(): Node {
    if (peek() === '-') {
      next();
      return { op: 'neg', a: unary() };
    }
    if (peek() === '+') next();
    return power();
  }
  function power(): Node {
    const a = postfix();
    if (peek() === '^') {
      next();
      return { op: '^', a, b: unary() };
    }
    return a;
  }
  function postfix(): Node {
    let a = atom();
    while (peek() === '%') {
      next();
      a = { op: '%', a };
    }
    return a;
  }
  function atom(): Node {
    const t = next();
    if (t === undefined) throw new Error('ends too soon');
    if (t === '(') {
      const a = sum();
      if (next() !== ')') throw new Error('unclosed bracket');
      return a;
    }
    if (t === 'sqrt') return { op: 'sqrt', a: postfix() };
    if (/^[\d.]/.test(t)) return { n: Number(t) };
    if (/^[a-z]$/.test(t)) return { v: t };
    throw new Error(`unexpected "${t}"`);
  }
  const tree = sum();
  if (i !== toks.length) throw new Error(`unexpected "${toks[i]}"`);
  return tree;
}

export function evaluate(node: Node, vars: Record<string, number> = {}): number {
  if ('n' in node) return node.n;
  if ('v' in node) {
    if (!(node.v in vars)) throw new Error(`unknown ${node.v}`);
    return vars[node.v];
  }
  const a = evaluate(node.a, vars);
  const b = node.b ? evaluate(node.b, vars) : 0;
  switch (node.op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '^': return a ** b;
    case 'neg': return -a;
    case '%': return a / 100;
    case 'sqrt': return Math.sqrt(a);
  }
  throw new Error(`unknown operator ${node.op}`);
}

function variables(node: Node, out = new Set<string>()): Set<string> {
  if ('v' in node) out.add(node.v);
  else if ('op' in node) {
    variables(node.a, out);
    if (node.b) variables(node.b, out);
  }
  return out;
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, '^': 4, '%': 5, sqrt: 5 };
const precOf = (n: Node) => ('op' in n ? PREC[n.op] : 9);

/** A parsed expression written back with only the brackets it needs, and every times sign. */
export function print(n: Node): string {
  if ('n' in n) return String(n.n);
  if ('v' in n) return n.v;
  const p = PREC[n.op];
  const wrap = (c: Node, tight: boolean) => (precOf(c) < p || (tight && precOf(c) === p) ? `(${print(c)})` : print(c));
  if (n.op === 'neg') return `-${wrap(n.a, false)}`;
  if (n.op === '%') return `${wrap(n.a, true)}%`;
  if (n.op === 'sqrt') return `sqrt(${print(n.a)})`;
  // ^ groups to the right; - and / to the left (so their right side needs brackets at equal rank).
  if (n.op === '^') return `${wrap(n.a, true)}^${wrap(n.b!, false)}`;
  return `${wrap(n.a, false)}${n.op}${wrap(n.b!, n.op === '-' || n.op === '/')}`;
}

/** The structure of a line of maths, for comparing readings: each side parsed and printed. Unparseable sides compare as text. */
export function structure(expr: string): string {
  return canonical(expr)
    .split('=')
    .map((side) => {
      if (!side) return '';
      try {
        return print(parse(side));
      } catch {
        return side;
      }
    })
    .join('=');
}

// --- What a line means -------------------------------------------------------------------------

export type Analysis =
  /** "17 × 23 =": the answer to write. */
  | { kind: 'answer'; value: number }
  /** "9 × 6 = 56": whether it is right, and what it should be. */
  | { kind: 'check'; correct: boolean; value: number }
  /** "2x + 3 = 11": the values of the variable that make it true. */
  | { kind: 'solve'; variable: string; values: number[] }
  | { kind: 'none'; why: string };

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** What to do with a line of maths, in canonical form. */
export function analyse(expr: string): Analysis {
  const sides = expr.split('=');
  if (sides.length !== 2) return { kind: 'none', why: sides.length < 2 ? 'no equals sign' : 'more than one equals sign' };
  try {
    const lhs = parse(sides[0]);
    const rhs = sides[1] ? parse(sides[1]) : null;
    const vars = new Set([...variables(lhs), ...(rhs ? variables(rhs) : [])]);
    if (!rhs) {
      if (vars.size) return { kind: 'none', why: 'unfinished, with a variable' };
      return { kind: 'answer', value: evaluate(lhs) };
    }
    if (!vars.size) {
      const l = evaluate(lhs), r = evaluate(rhs);
      return { kind: 'check', correct: close(l, r), value: l };
    }
    if (vars.size > 1) return { kind: 'none', why: 'more than one variable' };
    const [v] = vars;
    const f = (x: number) => evaluate(lhs, { [v]: x }) - evaluate(rhs, { [v]: x });
    // f is taken to be a polynomial of degree ≤ 2: fit it from three points and check a fourth.
    const f0 = f(0), f1 = f(1), fm = f(-1);
    const c = f0, b = (f1 - fm) / 2, a = (f1 + fm) / 2 - c;
    const fit = (x: number) => a * x * x + b * x + c;
    if (![2, 3.5, -7].every((x) => close(fit(x), f(x)))) return { kind: 'none', why: 'not linear or quadratic' };
    let values: number[];
    if (Math.abs(a) < 1e-12) values = Math.abs(b) < 1e-12 ? [] : [-c / b];
    else {
      const d = b * b - 4 * a * c;
      values = d < 0 ? [] : d === 0 ? [-b / (2 * a)] : [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)];
    }
    return { kind: 'solve', variable: v, values: values.sort((p, q) => p - q) };
  } catch (e) {
    return { kind: 'none', why: (e as Error).message };
  }
}

/** Whether two analyses say the same thing (what a person would see). */
export function sameVerdict(a: Analysis, b: Analysis): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'answer' && b.kind === 'answer') return close(a.value, b.value);
  if (a.kind === 'check' && b.kind === 'check') return a.correct === b.correct && close(a.value, b.value);
  if (a.kind === 'solve' && b.kind === 'solve') return a.variable === b.variable && a.values.length === b.values.length && a.values.every((x, i) => close(x, b.values[i]));
  return a.kind === 'none';
}

/** A number as a person would write the answer: a whole number, a simple fraction, or a short decimal. */
export function formatNumber(x: number): string {
  if (Number.isInteger(x)) return String(x);
  for (let q = 2; q <= 20; q++) {
    const p = Math.round(x * q);
    if (Math.abs(p / q - x) < 1e-9) return `${p}/${q}`;
  }
  return String(Number(x.toPrecision(6)));
}
