// Tool presets: a saved look for an ink tool (colour, width, style, line, steadiness) that one tap brings back.
import { newId } from './ids';

export type PresetTool = 'pen' | 'highlighter' | 'shapes';
type Value = string | number | boolean;

export interface ToolPreset {
  id: string;
  tool: PresetTool;
  /** The tool's settings as saved; only plain values. */
  settings: Record<string, Value>;
}

export const MAX_PRESETS = 12;

const isValue = (v: unknown): v is Value => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

function plain(settings: object): Record<string, Value> {
  return Object.fromEntries(Object.entries(settings).filter(([, v]) => isValue(v))) as Record<string, Value>;
}

export function makePreset(tool: PresetTool, settings: object): ToolPreset {
  return { id: newId(), tool, settings: plain(settings) };
}

/** Whether a tool's current settings are exactly a preset's. */
export function matchesPreset(p: ToolPreset, tool: PresetTool, settings: object): boolean {
  if (p.tool !== tool) return false;
  const cur = plain(settings);
  const keys = new Set([...Object.keys(p.settings), ...Object.keys(cur)]);
  return [...keys].every((k) => p.settings[k] === cur[k]);
}

/** Add a preset at the end. Saving the same look twice changes nothing; past the limit the oldest goes. */
export function addPreset(list: readonly ToolPreset[], preset: ToolPreset): ToolPreset[] {
  if (list.some((p) => matchesPreset(p, preset.tool, preset.settings))) return [...list];
  return [...list, preset].slice(-MAX_PRESETS);
}

export function removePreset(list: readonly ToolPreset[], id: string): ToolPreset[] {
  return list.filter((p) => p.id !== id);
}

/**
 * A tool's settings with a preset applied over the current ones: fields the preset doesn't have
 * (added since it was saved) keep their current value.
 */
export function applyPreset<T extends object>(current: T, preset: ToolPreset): T {
  return { ...current, ...preset.settings };
}

/** Saved presets from storage, keeping only well-formed ones. */
export function normalizePresets(raw: unknown): ToolPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is ToolPreset =>
        !!p && typeof p.id === 'string' && (p.tool === 'pen' || p.tool === 'highlighter' || p.tool === 'shapes') && !!p.settings && typeof p.settings === 'object',
    )
    .map((p) => ({ id: p.id, tool: p.tool, settings: plain(p.settings) }))
    .slice(-MAX_PRESETS);
}
