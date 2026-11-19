// Presentation mode: the editor (presenter) drives a second window (audience) over a BroadcastChannel.
// The audience shows only what it is sent; it never reads the notebook from storage itself.
import type { Vec } from './geometry';
import type { NotebookDoc } from './model';
import { applyOp, type DocOp } from './ops';

export type PresentMessage =
  /** Audience → presenter: "I'm here, send me everything." Repeated until answered. */
  | { type: 'hello' }
  /** Presenter → audience: the whole notebook and where it is. */
  | { type: 'sync'; doc: NotebookDoc; pageId: string; title: string }
  /** Presenter → audience: changes made while presenting. */
  | { type: 'ops'; ops: DocOp[] }
  /** Presenter → audience: the page now showing. */
  | { type: 'page'; pageId: string }
  /** Presenter → audience: laser points on a page (page units); head null when the pen lifts. */
  | { type: 'laser'; pageId: string; points: Vec[]; head: Vec | null }
  /** Presenter → audience: presenting stopped. */
  | { type: 'end' }
  /** Audience → presenter: the window was closed. */
  | { type: 'bye' };

export const presentChannel = (docId: string) => `jnotes-present-${docId}`;

export interface AudienceState {
  doc: NotebookDoc | null;
  pageId: string | null;
  title: string;
  ended: boolean;
}

export const INITIAL_AUDIENCE: AudienceState = { doc: null, pageId: null, title: '', ended: false };

/** What the audience shows after a message. Laser messages don't change it (they're drawn, not stored). */
export function reduceAudience(state: AudienceState, msg: PresentMessage): AudienceState {
  switch (msg.type) {
    case 'sync':
      return { doc: msg.doc, pageId: msg.pageId, title: msg.title, ended: false };
    case 'ops':
      return state.doc ? { ...state, doc: msg.ops.reduce(applyOp, state.doc) } : state;
    case 'page':
      return { ...state, pageId: msg.pageId };
    case 'end':
      return { ...state, ended: true };
    default:
      return state;
  }
}

/** The page the audience should show: the one it was told, or the first if that one is gone. */
export function shownPage(state: AudienceState) {
  const pages = state.doc?.pages ?? [];
  return pages.find((p) => p.id === state.pageId) ?? pages[0] ?? null;
}

/** Scale and offset that fit a page inside a w×h viewport, centred. */
export function fitPage(page: { w: number; h: number }, view: { w: number; h: number }, margin = 0): { scale: number; x: number; y: number } {
  const scale = Math.max(0.01, Math.min((view.w - 2 * margin) / page.w, (view.h - 2 * margin) / page.h));
  return { scale, x: (view.w - page.w * scale) / 2, y: (view.h - page.h * scale) / 2 };
}
