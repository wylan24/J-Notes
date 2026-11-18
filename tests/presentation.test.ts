import { describe, expect, it } from 'vitest';
import type { NotebookDoc } from '../src/core/model';
import { fitPage, INITIAL_AUDIENCE, reduceAudience, shownPage } from '../src/core/presentation';

const doc: NotebookDoc = { id: 'd', pages: ['a', 'b'].map((id) => ({ id, template: 'blank', strokes: [], items: [] })) };
const ink = { id: 's', tool: 'pen' as const, color: '#000', width: 2, simulatePressure: false, points: [{ x: 1, y: 1, p: 0.5 }] };

describe('presentation window', () => {
  it('shows nothing until synced, then the presenter’s page', () => {
    expect(shownPage(INITIAL_AUDIENCE)).toBeNull();
    const s = reduceAudience(INITIAL_AUDIENCE, { type: 'sync', doc, pageId: 'b', title: 'Lecture' });
    expect(shownPage(s)?.id).toBe('b');
    expect(s.title).toBe('Lecture');
  });

  it('follows page changes and edits made while presenting', () => {
    let s = reduceAudience(INITIAL_AUDIENCE, { type: 'sync', doc, pageId: 'a', title: 'T' });
    s = reduceAudience(s, { type: 'ops', ops: [{ type: 'strokes.added', pageId: 'a', strokes: [ink] }] });
    expect(shownPage(s)?.strokes).toHaveLength(1);
    s = reduceAudience(s, { type: 'page', pageId: 'b' });
    expect(shownPage(s)?.id).toBe('b');
    // The page was deleted: fall back to the first page rather than going blank.
    s = reduceAudience(s, { type: 'ops', ops: [{ type: 'page.removed', page: doc.pages[1], index: 1 }] });
    expect(shownPage(s)?.id).toBe('a');
  });

  it('ignores edits before it has the notebook, and laser messages', () => {
    expect(reduceAudience(INITIAL_AUDIENCE, { type: 'ops', ops: [] })).toBe(INITIAL_AUDIENCE);
    const s = reduceAudience(INITIAL_AUDIENCE, { type: 'sync', doc, pageId: 'a', title: 'T' });
    expect(reduceAudience(s, { type: 'laser', pageId: 'a', points: [{ x: 1, y: 2 }], head: null })).toBe(s);
  });

  it('notes the end, and a new sync starts again', () => {
    let s = reduceAudience(INITIAL_AUDIENCE, { type: 'sync', doc, pageId: 'a', title: 'T' });
    s = reduceAudience(s, { type: 'end' });
    expect(s.ended).toBe(true);
    expect(reduceAudience(s, { type: 'sync', doc, pageId: 'a', title: 'T' }).ended).toBe(false);
  });

  it('fits a page inside the window, centred', () => {
    expect(fitPage({ w: 800, h: 1000 }, { w: 1600, h: 1000 })).toEqual({ scale: 1, x: 400, y: 0 });
    expect(fitPage({ w: 1000, h: 500 }, { w: 500, h: 1000 })).toEqual({ scale: 0.5, x: 0, y: 375 });
  });
});
