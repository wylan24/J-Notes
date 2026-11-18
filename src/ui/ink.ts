import type { InputPoint, Stroke } from '../core/model';
import { newId } from '../core/ids';
import type { ToolState } from './PageView';
import { audioStamp } from './recorder';

/** A new stroke in the current tool's style, starting at `pt`. Pen and highlighter only (Shapes draws with the ball pen). */
export function newInkStroke(tool: ToolState, pt: InputPoint, pointerType: string): Stroke {
  const highlighter = tool.kind === 'highlighter';
  const stroke: Stroke = {
    id: newId(),
    tool: highlighter ? 'highlighter' : 'pen',
    color: tool.color,
    width: tool.width,
    points: [pt],
    // Mouse and finger report no real pressure; it is simulated from speed.
    simulatePressure: pointerType !== 'pen',
  };
  // Written during a recording: link it, so playback can show it and tapping it can replay that moment.
  const stamp = audioStamp();
  if (stamp) {
    stroke.rec = stamp.rec;
    stroke.points = [{ ...pt, t: stamp.t }];
  }
  // Shapes are drawn with the ball pen so their width stays even.
  if (tool.kind === 'shapes') stroke.penStyle = 'ball';
  else if (tool.kind === 'pen') {
    stroke.penStyle = tool.penStyle;
    if (tool.penStyle === 'fountain') stroke.sharpness = tool.sharpness;
  }
  // Dashes and dots for the pen and Shapes (the pencil's grain is its own texture, so it stays solid).
  if (tool.dash !== 'solid' && (tool.kind === 'shapes' || (tool.kind === 'pen' && tool.penStyle !== 'pencil'))) stroke.dash = tool.dash;
  return stroke;
}

/** Pressure for a pointer sample: real for a stylus, a constant 0.5 otherwise (synthesised later). */
export const pressureOf = (e: { pressure: number }, pointerType: string) => (pointerType === 'pen' ? Math.max(0.05, e.pressure) : 0.5);

/** `{ t }` (ms into the running recording) for a new input point, or nothing when not recording. */
export function timeStamp(): { t?: number } {
  const s = audioStamp();
  return s ? { t: s.t } : {};
}

