import { useState } from 'react';
import { matchesPreset, type PresetTool, type ToolPreset } from '../core/presets';
import { Icon } from './icons';

const TOOL_LABEL: Record<PresetTool, string> = { pen: 'Pen', highlighter: 'Highlighter', shapes: 'Shapes' };

/** A preset's look in words, for its label. */
function describe(p: ToolPreset): string {
  const s = p.settings;
  const parts = [TOOL_LABEL[p.tool], String(s.color ?? '')];
  if (p.tool === 'pen' && s.style) parts.push(String(s.style));
  if (s.width !== undefined) parts.push(`width ${s.width}`);
  if (s.dash && s.dash !== 'solid') parts.push(String(s.dash));
  return parts.filter(Boolean).join(', ');
}

/**
 * Saved tool looks, shown for every ink tool: one tap switches to that tool with that look. "+" saves
 * the current tool's look; in edit mode each preset can be removed.
 */
export function ToolPresets({
  presets,
  tool,
  settings,
  onApply,
  onSave,
  onRemove,
}: {
  presets: readonly ToolPreset[];
  /** The ink tool in use and its current settings (for marking the matching preset). */
  tool: PresetTool;
  settings: object;
  onApply: (p: ToolPreset) => void;
  onSave: () => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const saved = presets.some((p) => matchesPreset(p, tool, settings));
  return (
    <div className="tool-presets" role="group" aria-label="Presets">
      {presets.map((p) => {
        const active = matchesPreset(p, tool, settings);
        const width = Number(p.settings.width ?? 2);
        const label = describe(p);
        return (
          <span key={p.id} className="preset-wrap">
            <button
              className={`preset ${active ? 'active' : ''}`}
              aria-pressed={active}
              aria-label={`Preset: ${label}`}
              title={label}
              onClick={() => (editing ? onRemove(p.id) : onApply(p))}
            >
              <span className={`preset-ink ${p.tool}`} style={{ background: String(p.settings.color ?? '#000'), width: Math.min(18, 5 + width * 1.2), height: p.tool === 'highlighter' ? 7 : Math.min(18, 5 + width * 1.2) }} />
              <span className="preset-tool">
                <Icon name={p.tool === 'pen' ? `pen-${p.settings.style ?? 'fountain'}` : p.tool} />
              </span>
            </button>
            {editing && (
              <span className="preset-remove" aria-hidden="true">
                ×
              </span>
            )}
          </span>
        );
      })}
      <button className="icon-btn sm" onClick={onSave} disabled={saved} aria-label="Save this look as a preset" title={saved ? 'Already saved' : 'Save this look as a preset'}>
        <Icon name="plus" />
      </button>
      {presets.length > 0 && (
        <button className={`icon-btn sm ${editing ? 'active' : ''}`} aria-pressed={editing} onClick={() => setEditing(!editing)} aria-label="Remove presets" title={editing ? 'Done' : 'Remove presets'}>
          <Icon name={editing ? 'close' : 'trash'} />
        </button>
      )}
    </div>
  );
}
