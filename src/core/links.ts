// Links: page items that go to another page or to a web address when tapped.
import { newId } from './ids';
import type { LinkItem, LinkTarget, Page } from './model';
import type { Vec } from './geometry';

/** Only these schemes open; anything else (javascript:, data:, file:) is refused. */
const SAFE = /^(https?:\/\/|mailto:)/i;

/**
 * A web address from what someone typed: trimmed, with https:// added to a bare domain like
 * "example.com/x". Null if it isn't a safe, plausible address.
 */
export function normaliseUrl(input: string): string | null {
  const t = input.trim();
  if (!t || /\s/.test(t)) return null;
  const withScheme = SAFE.test(t) ? t : /^[a-z][a-z0-9+.-]*:/i.test(t) ? null : /^[^/]+\.[a-z]{2,}([/?#:]|$)/i.test(t) ? `https://${t}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    if (u.protocol === 'mailto:') return u.pathname.includes('@') ? withScheme : null;
    return u.hostname.includes('.') || u.hostname === 'localhost' ? u.href : null;
  } catch {
    return null;
  }
}

/** Pasted text that is exactly one http(s) address becomes a link; anything else stays text. */
export function pastedUrl(text: string): string | null {
  const t = text.trim();
  return /^https?:\/\/\S+$/i.test(t) ? normaliseUrl(t) : null;
}

/** What a link shows: the address without its scheme or a trailing slash, shortened if long. */
export function linkLabel(url: string, max = 48): string {
  const s = url.replace(/^(https?:\/\/|mailto:)/i, '').replace(/\/$/, '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** The top-most link under a point, with a little slack around it for fingers. */
export function linkAt(page: Page, pt: Vec, slack = 4): LinkItem | null {
  for (let i = page.items.length - 1; i >= 0; i--) {
    const it = page.items[i];
    if (it.kind === 'link' && pt.x >= it.x - slack && pt.x <= it.x + it.w + slack && pt.y >= it.y - slack && pt.y <= it.y + it.h + slack) return it;
  }
  return null;
}

export function newLink(rect: { x: number; y: number; w: number; h: number }, target: LinkTarget, label?: string): LinkItem {
  return { id: newId(), kind: 'link', x: rect.x, y: rect.y, w: Math.max(8, rect.w), h: Math.max(8, rect.h), target, ...(label ? { label } : {}) };
}

/** Text size of a visible link, in page units. */
export const LINK_TEXT_SIZE = 16;
export const LINK_PAD = 4;

/** A press that should follow a link rather than draw: short, and barely moved. */
export const TAP_MS = 500;
export const TAP_SLOP_PX = 6;

/** Places followed through page links, newest last, so Back can return to them. */
export interface BackEntry {
  scrollTop: number;
  scrollLeft: number;
  pageIndex: number;
}
export const MAX_BACK = 20;
export function pushBack(stack: readonly BackEntry[], entry: BackEntry): BackEntry[] {
  return [...stack, entry].slice(-MAX_BACK);
}
