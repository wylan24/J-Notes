import { describe, expect, it } from 'vitest';
import { addPreset, applyPreset, makePreset, matchesPreset, MAX_PRESETS, normalizePresets, removePreset } from '../src/core/presets';

const pen = { color: '#c00', width: 2.5, style: 'fountain', sharpness: 0.5, dash: 'solid', stabilise: 0.3 };

describe('tool presets', () => {
  it('saves a tool’s look and recognises it again', () => {
    const p = makePreset('pen', pen);
    expect(p.settings).toEqual(pen);
    expect(matchesPreset(p, 'pen', pen)).toBe(true);
    expect(matchesPreset(p, 'pen', { ...pen, width: 4 })).toBe(false);
    expect(matchesPreset(p, 'shapes', pen)).toBe(false);
  });

  it('keeps only plain values', () => {
    expect(makePreset('pen', { color: '#000', nested: { a: 1 }, fn: () => 1, n: NaN }).settings).toEqual({ color: '#000' });
  });

  it('applies over the current settings, so settings added since keep their value', () => {
    const old = makePreset('pen', { color: '#00f', width: 1 }); // saved before dashes existed
    expect(applyPreset({ ...pen, dash: 'dotted' }, old)).toEqual({ ...pen, dash: 'dotted', color: '#00f', width: 1 });
  });

  it('does not save the same look twice, and keeps at most the limit', () => {
    let list = addPreset([], makePreset('pen', pen));
    list = addPreset(list, makePreset('pen', { ...pen }));
    expect(list).toHaveLength(1);
    for (let i = 0; i < MAX_PRESETS + 3; i++) list = addPreset(list, makePreset('highlighter', { color: '#ff0', width: 10 + i }));
    expect(list).toHaveLength(MAX_PRESETS);
    expect(list.at(-1)!.settings.width).toBe(10 + MAX_PRESETS + 2);
  });

  it('removes a preset', () => {
    const a = makePreset('pen', pen);
    const b = makePreset('shapes', { color: '#000', width: 2 });
    expect(removePreset([a, b], a.id)).toEqual([b]);
  });

  it('reads saved presets, dropping malformed ones', () => {
    const good = makePreset('pen', pen);
    expect(normalizePresets([good, { id: 'x', tool: 'laser', settings: {} }, null, 'junk'])).toEqual([good]);
    expect(normalizePresets('nope')).toEqual([]);
  });
});
