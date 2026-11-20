import { describe, expect, it } from 'vitest';
import type { NotebookDoc, ReviewState, StudyCard } from '../src/core/model';
import { applyOp, inverseOp, replay, type DocEvent } from '../src/core/ops';
import { DocumentStore } from '../src/core/store';
import {
  addCardsOp,
  advance,
  answerOps,
  buildSession,
  cardBlobIds,
  cardStatus,
  dayKey,
  dayStart,
  deckStats,
  deckSummary,
  intervalLabel,
  isDue,
  logAnswer,
  MIN_EASE,
  newCard,
  removeCardsOp,
  resetCardOp,
  schedule,
  sideIsEmpty,
  sideLabel,
  summaryCounts,
  updateCardOp,
} from '../src/core/study';
import { fromFile, referencedBlobIds, toFile } from '../src/io/notebookFile';

// Noon on a fixed local day, so day boundaries are well away.
const NOON = new Date(2026, 10, 19, 12, 0, 0).getTime();
const HOUR = 3_600_000;

const card = (id: string, review?: ReviewState, createdAt = 0): StudyCard => ({ id, front: { text: `Q ${id}` }, back: { text: `A ${id}` }, createdAt, ...(review ? { review } : {}) });
const deck = (cards: StudyCard[]): NotebookDoc => ({ id: 'd', pages: [], cards });

describe('SM-2 scheduling', () => {
  it('schedules a new card 1 day, then 6 days, then interval × ease ahead', () => {
    const r1 = schedule(undefined, 'good', NOON);
    expect(r1).toMatchObject({ reps: 1, interval: 1, ease: 2.5, lapses: 0 });
    expect(r1.due).toBe(dayStart(NOON, 1));
    const r2 = schedule(r1, 'good', r1.due);
    expect(r2).toMatchObject({ reps: 2, interval: 6 });
    const r3 = schedule(r2, 'good', r2.due);
    expect(r3).toMatchObject({ reps: 3, interval: 15 }); // round(6 × 2.5)
    expect(r3.due).toBe(dayStart(r2.due, 15));
  });

  it('moves the easiness factor with the quality of the answer', () => {
    expect(schedule(undefined, 'easy', NOON).ease).toBeCloseTo(2.6);
    expect(schedule(undefined, 'good', NOON).ease).toBeCloseTo(2.5);
    expect(schedule(undefined, 'hard', NOON).ease).toBeCloseTo(2.36);
    expect(schedule(undefined, 'again', NOON).ease).toBeCloseTo(1.96);
  });

  it('never lets the easiness factor fall below 1.3', () => {
    let r: ReviewState | undefined;
    for (let i = 0; i < 10; i++) r = schedule(r, 'again', NOON);
    expect(r!.ease).toBe(MIN_EASE);
  });

  it('starts a forgotten card again, due at once, and counts a lapse only once it was learnt', () => {
    const fresh = schedule(undefined, 'again', NOON);
    expect(fresh).toMatchObject({ reps: 0, interval: 0, lapses: 0, due: NOON });
    const learnt = schedule(schedule(undefined, 'good', NOON), 'good', NOON + 24 * HOUR);
    const forgot = schedule(learnt, 'again', NOON + 8 * 24 * HOUR);
    expect(forgot).toMatchObject({ reps: 0, interval: 0, lapses: 1 });
    // Relearnt: back to 1 day, then 6.
    expect(schedule(forgot, 'good', forgot.due).interval).toBe(1);
  });

  it('makes a card due from the start of its day', () => {
    const late = new Date(2026, 10, 19, 23, 30).getTime();
    const r = schedule(undefined, 'good', late);
    const earlyNextDay = new Date(2026, 10, 20, 0, 5).getTime();
    expect(isDue(card('c', r), earlyNextDay)).toBe(true);
    expect(isDue(card('c', r), late)).toBe(false);
  });

  it('says intervals briefly', () => {
    const at = (interval: number) => intervalLabel({ ease: 2.5, interval, reps: 1, lapses: 0, due: 0, last: 0 });
    expect([at(0), at(1), at(6), at(45), at(400)]).toEqual(['again', '1 day', '6 days', '2 mo', '1.1 yr']);
  });
});

describe('card status', () => {
  it('is new, learning, or mastered once scheduled 21 days or more ahead', () => {
    expect(cardStatus(card('a'))).toBe('new');
    expect(cardStatus(card('a', { ease: 2.5, interval: 6, reps: 2, lapses: 0, due: 0, last: 0 }))).toBe('learning');
    expect(cardStatus(card('a', { ease: 2.5, interval: 21, reps: 4, lapses: 0, due: 0, last: 0 }))).toBe('mastered');
  });
});

describe('study sessions', () => {
  const review = (due: number): ReviewState => ({ ease: 2.5, interval: 1, reps: 1, lapses: 0, due, last: 0 });

  it('brings due cards first, most overdue first, then new cards up to the limit', () => {
    const cards = [card('n1'), card('later', review(NOON + 48 * HOUR)), card('d2', review(NOON - HOUR)), card('n2'), card('d1', review(NOON - 48 * HOUR)), card('n3')];
    expect(buildSession(cards, NOON, 'due', { newLimit: 2 })).toEqual(['d1', 'd2', 'n1', 'n2']);
  });

  it('practises every card in a shuffled order', () => {
    const cards = ['a', 'b', 'c', 'd'].map((id) => card(id, review(NOON + 99 * HOUR)));
    const ids = buildSession(cards, NOON, 'all', { random: () => 0 });
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(ids).not.toEqual(['a', 'b', 'c', 'd']);
  });

  it('puts a card answered Again at the back of the queue', () => {
    expect(advance(['a', 'b', 'c'], 'again')).toEqual(['b', 'c', 'a']);
    expect(advance(['a', 'b', 'c'], 'good')).toEqual(['b', 'c']);
    expect(advance(['a'], 'again')).toEqual(['a']);
    expect(advance([], 'good')).toEqual([]);
  });
});

describe('stats', () => {
  it('tallies answers per day', () => {
    let log = logAnswer(undefined, NOON, true);
    log = logAnswer(log, NOON + HOUR, false);
    log = logAnswer(log, NOON + 24 * HOUR, true);
    expect(log).toEqual([
      { day: dayKey(NOON), reviewed: 2, correct: 1 },
      { day: dayKey(NOON + 24 * HOUR), reviewed: 1, correct: 1 },
    ]);
  });

  it('counts cards by state, accuracy and the streak', () => {
    const r = (interval: number, due: number): ReviewState => ({ ease: 2.5, interval, reps: 2, lapses: 0, due, last: 0 });
    const cards = [card('a'), card('b', r(6, NOON - HOUR)), card('c', r(30, NOON + 9 * 24 * HOUR))];
    let log = logAnswer(undefined, dayStart(NOON, -2) + HOUR, true);
    log = logAnswer(log, dayStart(NOON, -1) + HOUR, true);
    log = logAnswer(log, dayStart(NOON, -1) + 2 * HOUR, false);
    const s = deckStats(cards, log, NOON, 7);
    expect(s).toMatchObject({ total: 3, new: 1, learning: 1, mastered: 1, due: 1, reviews: 3, streak: 2 });
    expect(s.accuracy).toBeCloseTo(2 / 3);
    expect(s.recent).toHaveLength(7);
    expect(s.recent[6]).toEqual({ day: dayKey(NOON), reviewed: 0, correct: 0 });
    expect(s.recent[5].reviewed).toBe(2);
    // A gap ends the streak.
    expect(deckStats(cards, log, dayStart(NOON, 2) + HOUR).streak).toBe(0);
  });

  it('summarises a deck for the library', () => {
    const cards = [card('a'), card('b', { ease: 2.5, interval: 1, reps: 1, lapses: 0, due: NOON - 1, last: 0 }), card('c', { ease: 2.5, interval: 1, reps: 1, lapses: 0, due: NOON + 1, last: 0 })];
    const summary = deckSummary(cards);
    expect(summary.cards).toBe(3);
    expect(summaryCounts(summary, NOON)).toEqual({ due: 1, new: 1 });
    expect(summaryCounts(undefined, NOON)).toEqual({ due: 0, new: 0 });
  });
});

describe('cards', () => {
  const drawing = { strokes: [], items: [{ id: 'i', kind: 'image' as const, x: 0, y: 0, w: 10, h: 10, blobId: 'photo' }], w: 10, h: 10 };

  it('stores sides trimmed and without empty drawings', () => {
    const c = newCard({ text: '  term ', drawing: { strokes: [], items: [], w: 0, h: 0 } }, { text: 'meaning' }, NOON, { docId: 'n', pageId: 'p' });
    expect(c.front).toEqual({ text: 'term' });
    expect(c.source).toEqual({ docId: 'n', pageId: 'p' });
    expect(sideIsEmpty({ text: '  ' })).toBe(true);
    expect(sideIsEmpty({ text: '', drawing })).toBe(false);
  });

  it('labels sides for lists', () => {
    expect(sideLabel({ text: ' two\nlines ' })).toBe('two lines');
    expect(sideLabel({ text: '', drawing })).toBe('Picture');
    expect(sideLabel({ text: '' })).toBe('Empty');
  });

  it('finds the photos on both sides', () => {
    expect(cardBlobIds({ front: { text: '', drawing }, back: { text: 'x' } })).toEqual(['photo']);
  });
});

describe('card ops', () => {
  it('add, remove and update are undoable and replay', () => {
    const doc = deck([card('a'), card('b'), card('c')]);
    const add = addCardsOp([card('d')])!;
    const added = applyOp(doc, add);
    expect(added.cards!.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(applyOp(added, inverseOp(add)).cards).toEqual(doc.cards);

    const remove = removeCardsOp(doc, ['b', 'c'])!;
    const removed = applyOp(doc, remove);
    expect(removed.cards!.map((c) => c.id)).toEqual(['a']);
    expect(applyOp(removed, inverseOp(remove)).cards!.map((c) => c.id)).toEqual(['a', 'b', 'c']);

    const update = updateCardOp(doc, 'b', { front: { text: 'new' } })!;
    const updated = applyOp(doc, update);
    expect(updated.cards![1].front.text).toBe('new');
    expect(applyOp(updated, inverseOp(update)).cards![1]).toEqual(doc.cards![1]);
    expect(updateCardOp(doc, 'b', { front: { text: 'Q b' } })).toBeNull();
    expect(updateCardOp(doc, 'missing', { front: { text: 'x' } })).toBeNull();

    const events: DocEvent[] = [add, remove].map((op, i) => ({ docId: 'd', seq: i + 1, ts: 0, op }));
    expect(replay(doc, events).cards!.map((c) => c.id)).toEqual(['a', 'd']);
  });

  it('answers schedule the card and tally the day, undone as one step', () => {
    const store = new DocumentStore(deck([card('a')]));
    store.dispatch(answerOps(store.doc, 'a', 'good', NOON));
    expect(store.doc.cards![0].review).toMatchObject({ reps: 1, interval: 1 });
    expect(store.doc.studyLog).toEqual([{ day: dayKey(NOON), reviewed: 1, correct: 1 }]);
    store.undo();
    expect(store.doc.cards![0].review).toBeUndefined();
    expect(store.doc.studyLog).toBeUndefined();
  });

  it('practice counts the answer but leaves the schedule alone', () => {
    const doc = deck([card('a')]);
    const ops = answerOps(doc, 'a', 'again', NOON, { schedule: false });
    const after = ops.reduce(applyOp, doc);
    expect(after.cards![0].review).toBeUndefined();
    expect(after.studyLog).toEqual([{ day: dayKey(NOON), reviewed: 1, correct: 0 }]);
  });

  it('resets a card to new', () => {
    const doc = deck([card('a', schedule(undefined, 'good', NOON))]);
    const after = applyOp(doc, resetCardOp(doc, 'a')!);
    expect('review' in after.cards![0]).toBe(false);
    expect(resetCardOp(after, 'a')).toBeNull();
  });
});

describe('study set files', () => {
  it('round-trip with their cards, history and photos', () => {
    const c: StudyCard = { ...card('a'), front: { text: '', drawing: { strokes: [], items: [{ id: 'i', kind: 'image', x: 0, y: 0, w: 1, h: 1, blobId: 'photo' }], w: 1, h: 1 } } };
    const doc: NotebookDoc = { id: 'd', pages: [], cards: [c], studyLog: [{ day: '2026-11-19', reviewed: 3, correct: 2 }] };
    expect(referencedBlobIds(doc)).toEqual(['photo']);
    const meta = { id: 'd', kind: 'deck' as const, title: 'Verbs', cover: '#2a9d8f', template: 'blank' as const, createdAt: 0, updatedAt: 0, favourite: false, trashedAt: null, pageCount: 0 };
    const file = JSON.parse(JSON.stringify(toFile(meta, doc, [{ id: 'photo', type: 'image/png', bytes: new Uint8Array([1, 2, 3]).buffer }])));
    const back = fromFile(file);
    expect(back.meta.kind).toBe('deck');
    expect(back.meta.deck).toEqual({ cards: 1, due: [0] });
    expect(back.doc.cards).toEqual([c]);
    expect(back.doc.studyLog).toEqual(doc.studyLog);
    expect(back.blobs.map((b) => b.id)).toEqual(['photo']);
  });

  it('drops malformed cards from a file', () => {
    const file = {
      format: 'jnotes-notebook',
      version: 2,
      kind: 'deck',
      title: 'x',
      cover: '#000',
      template: 'blank',
      doc: { id: 'x', pages: [], cards: [card('ok'), { id: 'bad' }, null, { ...card('noback'), back: 5 }] },
    };
    expect(fromFile(file).doc.cards!.map((c) => c.id)).toEqual(['ok']);
  });
});

describe('editing drawings', () => {
  const stroke = (pts: [number, number][]) => ({ id: 's', tool: 'pen' as const, color: '#000', width: 2, simulatePressure: false, points: pts.map(([x, y]) => ({ x, y, p: 0.5 })) });

  it('fits a drawing into the pad and crops it back to the origin', async () => {
    const { fitDrawing, cropDrawing } = await import('../src/core/study');
    const d = { strokes: [stroke([[0, 0], [100, 50]])], items: [], w: 100, h: 50 };
    const fitted = fitDrawing(d, 480, 300, 20);
    // Width allows (480 − 40) / 100 = 4.4×; capped at 2×, centred.
    const xs = fitted.strokes[0].points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(200);
    expect(Math.min(...xs)).toBeCloseTo(140);
    const back = cropDrawing(fitted.strokes, fitted.items)!;
    // At the origin, give or take the line's own half-width (bounds include it).
    const minX = Math.min(...back.strokes[0].points.map((p) => p.x));
    expect(minX).toBeGreaterThanOrEqual(0);
    expect(minX).toBeLessThanOrEqual(back.strokes[0].width);
    expect(back.w).toBeGreaterThan(200);
    expect(cropDrawing([], [])).toBeUndefined();
  });
});
