// Which toolbar buttons to show, and in what order. Saved per device as a preference.

/** Every customisable toolbar item, in the default order. */
export const TOOLBAR_ITEMS = [
  'pen',
  'highlighter',
  'shapes',
  'text',
  'sticky',
  'eraser',
  'lasso',
  'laser',
  'tape',
  'ruler',
  'zoomWindow',
  'photo',
  'audio',
  'elements',
  'timer',
] as const;

export type ToolbarItem = (typeof TOOLBAR_ITEMS)[number];

const DRAWING: ReadonlySet<ToolbarItem> = new Set(['pen', 'highlighter', 'shapes', 'text', 'sticky', 'eraser', 'lasso', 'laser', 'tape']);
/** Tools that select what the pointer does (as opposed to panels and overlays). */
export const isDrawingTool = (item: ToolbarItem) => DRAWING.has(item);

export interface ToolbarPrefs {
  order: ToolbarItem[];
  hidden: ToolbarItem[];
}

export const DEFAULT_PREFS: ToolbarPrefs = { order: [...TOOLBAR_ITEMS], hidden: [] };

const isItem = (v: unknown): v is ToolbarItem => typeof v === 'string' && (TOOLBAR_ITEMS as readonly string[]).includes(v);

export function visibleItems(p: ToolbarPrefs): ToolbarItem[] {
  return p.order.filter((i) => !p.hidden.includes(i));
}

/** Keep at least one drawing tool on the toolbar, so the page can always be written on with a tap. */
function ensureDrawingTool(p: ToolbarPrefs): ToolbarPrefs {
  if (visibleItems(p).some(isDrawingTool)) return p;
  return { ...p, hidden: p.hidden.filter((i) => i !== 'pen') };
}

export function toggleItem(p: ToolbarPrefs, item: ToolbarItem): ToolbarPrefs {
  if (p.hidden.includes(item)) return { ...p, hidden: p.hidden.filter((i) => i !== item) };
  const next = { ...p, hidden: [...p.hidden, item] };
  // Hiding the last visible drawing tool is refused.
  return visibleItems(next).some(isDrawingTool) ? next : p;
}

/** Move `item` to position `to` in the order (clamped). */
export function moveItem(p: ToolbarPrefs, item: ToolbarItem, to: number): ToolbarPrefs {
  const order = p.order.filter((i) => i !== item);
  order.splice(Math.max(0, Math.min(order.length, to)), 0, item);
  return { ...p, order };
}

/**
 * Repair saved preferences: drop unknown and duplicate items, and put back any missing item
 * (such as a tool added in a later version) right after the item it follows by default.
 */
export function normalizePrefs(raw: unknown): ToolbarPrefs {
  const r = raw as Partial<Record<keyof ToolbarPrefs, unknown>> | null;
  if (!r || !Array.isArray(r.order)) return DEFAULT_PREFS;
  const order = [...new Set(r.order.filter(isItem))];
  TOOLBAR_ITEMS.forEach((item, i) => {
    if (order.includes(item)) return;
    const prev = TOOLBAR_ITEMS.slice(0, i).reverse().find((x) => order.includes(x));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, item);
  });
  const hidden = Array.isArray(r.hidden) ? [...new Set(r.hidden.filter(isItem))] : [];
  return ensureDrawingTool({ order, hidden });
}
