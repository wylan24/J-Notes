// Scoring for the handwriting recognition spike (task 10.0). Pure, so it is unit-tested.

/** Edit distance between two sequences (insertions, deletions and substitutions all cost 1). */
export function editDistance<T>(a: readonly T[], b: readonly T[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Collapse runs of whitespace and trim. */
export const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * What search cares about: lower case, curly quotes made straight, and punctuation dropped, so
 * "Don't" and "dont" match.
 */
export function loose(s: string): string {
  return tidy(
    s
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^\p{L}\p{N}\s]/gu, ''),
  );
}

export interface Score {
  /** Character error rate: edits ÷ characters in the truth. */
  cer: number;
  /** Word error rate: word edits ÷ words in the truth. */
  wer: number;
}

export function score(truth: string, guess: string): Score {
  const t = tidy(truth), g = tidy(guess);
  const tw = t ? t.split(' ') : [], gw = g ? g.split(' ') : [];
  return {
    cer: t.length ? editDistance([...t], [...g]) / t.length : g.length ? 1 : 0,
    wer: tw.length ? editDistance(tw, gw) / tw.length : gw.length ? 1 : 0,
  };
}

/** Errors summed over a whole set (not the mean of per-line rates, so long lines count for more). */
export function corpusScore(pairs: readonly { truth: string; guess: string }[], norm: (s: string) => string = tidy): Score {
  let ce = 0, cn = 0, we = 0, wn = 0;
  for (const { truth, guess } of pairs) {
    const t = norm(truth), g = norm(guess);
    const tw = t ? t.split(' ') : [], gw = g ? g.split(' ') : [];
    ce += editDistance([...t], [...g]);
    cn += t.length;
    we += editDistance(tw, gw);
    wn += tw.length;
  }
  return { cer: cn ? ce / cn : 0, wer: wn ? we / wn : 0 };
}

export interface Timing {
  n: number;
  median: number;
  p95: number;
  max: number;
}

/** Median, 95th percentile (nearest rank) and maximum of some times, in ms. */
export function timing(ms: readonly number[]): Timing {
  if (!ms.length) return { n: 0, median: 0, p95: 0, max: 0 };
  const s = [...ms].sort((a, b) => a - b);
  const rank = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
  const mid = s.length >> 1;
  return { n: s.length, median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2, p95: rank(0.95), max: s[s.length - 1] };
}
