// Study sets: flashcards with text, photos or drawings on each side, studied with SM-2 spaced
// repetition. Plain data and pure functions; the deck lives in a document's `cards` and is changed
// with `cards.*` ops, so it is logged, undoable and persisted like everything else.
import type { CardPatch, CardSide, DeckSummary, Drawing, NotebookDoc, ReviewState, StudyCard, StudyDay } from './model';
import { updateDocOp, type DocOp } from './ops';
import { newId } from './ids';
import { makeElementContent } from './elements';
import { transformItem, transformStroke, type Matrix } from './transform';

/** How well a card was remembered. */
export type Grade = 'again' | 'hard' | 'good' | 'easy';
export const GRADES: readonly Grade[] = ['again', 'hard', 'good', 'easy'];
/** SM-2 quality (0–5) of each answer. Below 3 is a failure. */
export const QUALITY: Record<Grade, number> = { again: 1, hard: 3, good: 4, easy: 5 };

export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
/** A card scheduled this many days ahead or more counts as mastered. */
export const MASTERED_DAYS = 21;
/** New cards brought into one study session. */
export const NEW_PER_SESSION = 20;
/** Days of history kept for stats. */
const LOG_DAYS = 400;

/** Local midnight at the start of `now`'s day, `addDays` days on (calendar days, so DST is harmless). */
export function dayStart(now: number, addDays = 0): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (addDays) d.setDate(d.getDate() + addDays);
  return d.getTime();
}

/** Local date as YYYY-MM-DD. */
export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- Scheduling (SM-2) ------------------------------------------------------------

/**
 * The card's state after an answer, by SM-2: the easiness factor moves with the answer's quality
 * (never below 1.3); a correct answer schedules it 1 day, then 6 days, then the last interval times
 * the easiness factor ahead; a wrong one starts its repetitions again. A forgotten card is due again
 * at once, so the session brings it back until it is remembered. Reviews are due from the start of
 * their day, so a card due tomorrow can be studied any time tomorrow.
 */
export function schedule(prev: ReviewState | undefined, grade: Grade, now: number): ReviewState {
  const q = QUALITY[grade];
  const ease = Math.max(MIN_EASE, (prev?.ease ?? START_EASE) + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  const lapses = prev?.lapses ?? 0;
  if (q < 3) {
    return { ease, interval: 0, reps: 0, lapses: prev && prev.reps > 0 ? lapses + 1 : lapses, due: now, last: now };
  }
  const reps = (prev?.reps ?? 0) + 1;
  const interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.max(1, Math.round((prev?.interval || 1) * ease));
  return { ease, interval, reps, lapses, due: dayStart(now, interval), last: now };
}

/** When a card would be due after each answer, said briefly ("again", "1 day", "6 days", "2 mo"). */
export function intervalLabel(review: ReviewState): string {
  const n = review.interval;
  if (n <= 0) return 'again';
  if (n === 1) return '1 day';
  if (n < 30) return `${n} days`;
  if (n < 365) return `${Math.round(n / 30)} mo`;
  const y = Math.round((n / 365) * 10) / 10;
  return `${y} yr`;
}

// --- Card state --------------------------------------------------------------------

export type CardStatus = 'new' | 'learning' | 'mastered';

export function cardStatus(card: Pick<StudyCard, 'review'>): CardStatus {
  if (!card.review) return 'new';
  return card.review.interval >= MASTERED_DAYS ? 'mastered' : 'learning';
}

/** Studied before, and due for review now. New cards aren't "due"; they are new. */
export const isDue = (card: Pick<StudyCard, 'review'>, now: number): boolean => !!card.review && card.review.due <= now;

// --- Sessions ----------------------------------------------------------------------

export type StudyMode = 'due' | 'all';

/**
 * Card ids to study, in order. `due`: cards due for review (most overdue first), then up to
 * `newLimit` new cards in the order they were made. `all`: every card, shuffled, for practice that
 * doesn't change the schedule.
 */
export function buildSession(cards: readonly StudyCard[], now: number, mode: StudyMode, opts: { newLimit?: number; random?: () => number } = {}): string[] {
  if (mode === 'all') return shuffle(cards.map((c) => c.id), opts.random ?? Math.random);
  const due = cards.filter((c) => isDue(c, now)).sort((a, b) => a.review!.due - b.review!.due);
  const fresh = cards.filter((c) => !c.review).slice(0, opts.newLimit ?? NEW_PER_SESSION);
  return [...due, ...fresh].map((c) => c.id);
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The queue after answering its first card: done with it, or (Again) back at the end to try once more. */
export function advance(queue: readonly string[], grade: Grade): string[] {
  const [head, ...rest] = queue;
  if (head === undefined) return [];
  return grade === 'again' ? [...rest, head] : rest;
}

// --- Stats -------------------------------------------------------------------------

/** The history with one more answer counted on `now`'s day; only the last 400 days are kept. */
export function logAnswer(log: readonly StudyDay[] | undefined, now: number, correct: boolean): StudyDay[] {
  const day = dayKey(now);
  const out = (log ?? []).slice();
  const last = out[out.length - 1];
  if (last?.day === day) out[out.length - 1] = { day, reviewed: last.reviewed + 1, correct: last.correct + (correct ? 1 : 0) };
  else out.push({ day, reviewed: 1, correct: correct ? 1 : 0 });
  return out.slice(-LOG_DAYS);
}

export interface DeckStats {
  total: number;
  new: number;
  learning: number;
  mastered: number;
  /** Studied cards due now. */
  due: number;
  /** Answers ever given (as far as the history goes). */
  reviews: number;
  /** Share of answers that weren't Again, 0..1; null before any. */
  accuracy: number | null;
  /** Days in a row with at least one answer, ending today (or yesterday, if not yet today). */
  streak: number;
  /** Answers on each of the last `days` days, oldest first, today last. */
  recent: { day: string; reviewed: number; correct: number }[];
}

export function deckStats(cards: readonly StudyCard[], log: readonly StudyDay[] | undefined, now: number, days = 14): DeckStats {
  const counts = { new: 0, learning: 0, mastered: 0 };
  for (const c of cards) counts[cardStatus(c)]++;
  const byDay = new Map((log ?? []).map((d) => [d.day, d]));
  const reviews = (log ?? []).reduce((n, d) => n + d.reviewed, 0);
  const correct = (log ?? []).reduce((n, d) => n + d.correct, 0);
  let streak = 0;
  // Today without answers yet doesn't break a streak that ran to yesterday.
  for (let i = byDay.has(dayKey(now)) ? 0 : 1; byDay.has(dayKey(dayStart(now, -i))); i++) streak++;
  const recent = Array.from({ length: days }, (_, i) => {
    const day = dayKey(dayStart(now, i - days + 1));
    const d = byDay.get(day);
    return { day, reviewed: d?.reviewed ?? 0, correct: d?.correct ?? 0 };
  });
  return {
    total: cards.length,
    ...counts,
    due: cards.filter((c) => isDue(c, now)).length,
    reviews,
    accuracy: reviews ? correct / reviews : null,
    streak,
    recent,
  };
}

/** What the library shows of a study set. */
export function deckSummary(cards: readonly StudyCard[]): DeckSummary {
  return { cards: cards.length, due: cards.map((c) => c.review?.due ?? 0) };
}

/** Cards due for review now, and new cards, from a library summary. */
export function summaryCounts(summary: DeckSummary | undefined, now: number): { due: number; new: number } {
  let due = 0;
  let fresh = 0;
  for (const t of summary?.due ?? []) {
    if (t === 0) fresh++;
    else if (t <= now) due++;
  }
  return { due, new: fresh };
}

// --- Cards -------------------------------------------------------------------------

export const emptySide = (): CardSide => ({ text: '' });

export const sideIsEmpty = (s: CardSide): boolean => !s.text.trim() && !hasDrawing(s.drawing);

export const hasDrawing = (d: Drawing | undefined): d is Drawing => !!d && (d.strokes.length > 0 || d.items.length > 0);

/** A side as stored: trimmed text, and no empty drawing. */
export function cleanSide(s: CardSide): CardSide {
  const text = s.text.trim();
  return hasDrawing(s.drawing) ? { text, drawing: s.drawing } : { text };
}

export function newCard(front: CardSide, back: CardSide, now: number, source?: StudyCard['source']): StudyCard {
  return { id: newId(), front: cleanSide(front), back: cleanSide(back), createdAt: now, ...(source ? { source } : {}) };
}

/** A side as one line of text, for lists and screen readers. */
export function sideLabel(s: CardSide): string {
  const text = s.text.trim().replace(/\s+/g, ' ');
  if (text) return text;
  if (!hasDrawing(s.drawing)) return 'Empty';
  return s.drawing.items.length && !s.drawing.strokes.length && s.drawing.items.every((it) => it.kind === 'image') ? 'Picture' : 'Drawing';
}

/** Blob ids of the photos on a card's sides. */
export function cardBlobIds(card: Pick<StudyCard, 'front' | 'back'>): string[] {
  const ids = new Set<string>();
  for (const side of [card.front, card.back]) for (const it of side.drawing?.items ?? []) if (it.kind === 'image') ids.add(it.blobId);
  return [...ids];
}

/** Does the card mention `query` in its typed text? Case-insensitive. */
export function cardMatches(card: StudyCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || card.front.text.toLowerCase().includes(q) || card.back.text.toLowerCase().includes(q);
}

/** The drawing scaled (up to 2×, so ink doesn't get heavy) and centred to fit a w×h box with `pad` around it, for editing. */
export function fitDrawing(d: Drawing, w: number, h: number, pad = 16): Drawing {
  const k = Math.min(2, (w - 2 * pad) / Math.max(1, d.w), (h - 2 * pad) / Math.max(1, d.h));
  const m: Matrix = [k, 0, 0, k, (w - d.w * k) / 2, (h - d.h * k) / 2];
  return { strokes: d.strokes.map((s) => transformStroke(s, m)), items: d.items.map((it) => transformItem(it, m)), w, h };
}

/** Strokes and items as a drawing, moved so its bounds start at the origin; undefined when empty. */
export function cropDrawing(strokes: Drawing['strokes'], items: Drawing['items']): Drawing | undefined {
  const page = { id: 'card', template: 'blank' as const, strokes, items };
  return makeElementContent(page, { pageId: 'card', strokeIds: strokes.map((s) => s.id), itemIds: items.map((it) => it.id) }) ?? undefined;
}

// --- Ops ---------------------------------------------------------------------------

export function addCardsOp(cards: StudyCard[]): DocOp | null {
  return cards.length ? { type: 'cards.added', cards } : null;
}

/** Remove cards, recording where they were so undo puts them back in place. */
export function removeCardsOp(doc: NotebookDoc, ids: Iterable<string>): DocOp | null {
  const set = new Set(ids);
  const cards: StudyCard[] = [];
  const indices: number[] = [];
  (doc.cards ?? []).forEach((c, i) => {
    if (set.has(c.id)) {
      cards.push(c);
      indices.push(i);
    }
  });
  return cards.length ? { type: 'cards.removed', cards, indices } : null;
}

/** Change a card, recording each changed field's current value; null if nothing would change. */
export function updateCardOp(doc: NotebookDoc, id: string, patch: CardPatch): DocOp | null {
  const card = (doc.cards ?? []).find((c) => c.id === id) as unknown as Record<string, unknown> | undefined;
  if (!card) return null;
  const keys = Object.keys(patch).filter((k) => JSON.stringify(card[k]) !== JSON.stringify((patch as Record<string, unknown>)[k]));
  if (!keys.length) return null;
  const pick = (src: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, src[k]])) as CardPatch;
  return { type: 'cards.updated', id, patch: pick(patch as Record<string, unknown>), previous: pick(card) };
}

/**
 * Ops for answering a card in a study session: its new schedule and the day's tally, as one
 * undo step. Practice (`schedule: false`) leaves the schedule alone and only counts the answer.
 */
export function answerOps(doc: NotebookDoc, cardId: string, grade: Grade, now: number, opts: { schedule?: boolean } = {}): DocOp[] {
  const card = (doc.cards ?? []).find((c) => c.id === cardId);
  if (!card) return [];
  const ops: DocOp[] = [];
  if (opts.schedule !== false) {
    const op = updateCardOp(doc, cardId, { review: schedule(card.review, grade, now) });
    if (op) ops.push(op);
  }
  const log = updateDocOp(doc, { studyLog: logAnswer(doc.studyLog, now, grade !== 'again') });
  if (log) ops.push(log);
  return ops;
}

/** Forget a card's progress, so it is studied as new. */
export function resetCardOp(doc: NotebookDoc, id: string): DocOp | null {
  return updateCardOp(doc, id, { review: undefined });
}
