// Stopwatch and countdown as pure state transitions over wall-clock timestamps.
// Nothing ticks: elapsed time is computed from `now`, so the timer stays exact when the
// tab is in the background or the page is reloaded mid-run.
import { newId } from './ids';

export type TimerMode = 'stopwatch' | 'countdown';

export interface TimerState {
  mode: TimerMode;
  running: boolean;
  /** When the current running segment began. */
  segmentStart: number | null;
  /** Time accumulated by earlier segments. */
  accumulated: number;
  /** Countdown length in ms. */
  target: number;
  /** Stopwatch split times (elapsed ms at each lap). */
  laps: number[];
  /** When this session was first started; null until then. */
  sessionStart: number | null;
}

export interface Session {
  id: string;
  mode: TimerMode;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  targetMs?: number;
  /** A countdown that reached zero. */
  completed: boolean;
  notebookId?: string;
  notebookTitle?: string;
}

const DEFAULT_TARGET = 25 * 60_000;
/** Runs shorter than this are not worth keeping in history. */
const MIN_SESSION_MS = 1000;

export function idle(mode: TimerMode, target = DEFAULT_TARGET): TimerState {
  return { mode, running: false, segmentStart: null, accumulated: 0, target, laps: [], sessionStart: null };
}

export function elapsed(s: TimerState, now: number): number {
  const total = s.accumulated + (s.running && s.segmentStart !== null ? now - s.segmentStart : 0);
  return s.mode === 'countdown' ? Math.min(total, s.target) : total;
}

export function remaining(s: TimerState, now: number): number {
  return Math.max(0, s.target - elapsed(s, now));
}

export function start(s: TimerState, now: number): TimerState {
  if (s.running || (s.mode === 'countdown' && s.accumulated >= s.target)) return s;
  return { ...s, running: true, segmentStart: now, sessionStart: s.sessionStart ?? now };
}

export function pause(s: TimerState, now: number): TimerState {
  if (!s.running) return s;
  return { ...s, running: false, segmentStart: null, accumulated: elapsed(s, now) };
}

export function lap(s: TimerState, now: number): TimerState {
  return s.running && s.mode === 'stopwatch' ? { ...s, laps: [...s.laps, elapsed(s, now)] } : s;
}

/** Back to idle, keeping the mode and countdown length. */
export const reset = (s: TimerState): TimerState => idle(s.mode, s.target);

export function setMode(s: TimerState, mode: TimerMode): TimerState {
  return idle(mode, s.target);
}

export function setTarget(s: TimerState, target: number): TimerState {
  if (s.running || s.sessionStart !== null) return s;
  return { ...s, target: Math.max(1000, Math.round(target)) };
}

/** When a running countdown reaches (or reached) zero; null if it isn't running. */
export function finishedAt(s: TimerState): number | null {
  if (s.mode !== 'countdown' || !s.running || s.segmentStart === null) return null;
  return s.segmentStart + (s.target - s.accumulated);
}

export function isFinished(s: TimerState, now: number): boolean {
  const end = finishedAt(s);
  return end !== null && now >= end;
}

/** The history entry for this run, or null if it was too short to keep. */
export function sessionFrom(s: TimerState, now: number, ctx: { notebookId?: string; notebookTitle?: string } = {}): Session | null {
  if (s.sessionStart === null) return null;
  const done = isFinished(s, now);
  const durationMs = elapsed(s, now);
  if (durationMs < MIN_SESSION_MS) return null;
  return {
    id: newId(),
    mode: s.mode,
    startedAt: s.sessionStart,
    endedAt: done ? finishedAt(s)! : now,
    durationMs,
    ...(s.mode === 'countdown' ? { targetMs: s.target } : {}),
    completed: done,
    ...ctx,
  };
}

export function summarize(sessions: Session[], now: number): { todayMs: number; todayCount: number } {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = sessions.filter((x) => x.endedAt >= midnight.getTime());
  return { todayMs: today.reduce((t, x) => t + x.durationMs, 0), todayCount: today.length };
}

/** Validate state read back from storage. */
export function restore(raw: unknown): TimerState {
  const r = raw as Partial<TimerState> | null;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!r || (r.mode !== 'stopwatch' && r.mode !== 'countdown') || !num(r.accumulated) || !num(r.target)) return idle('stopwatch');
  const running = r.running === true && num(r.segmentStart);
  return {
    mode: r.mode,
    running,
    segmentStart: running ? (r.segmentStart as number) : null,
    accumulated: r.accumulated as number,
    target: r.target as number,
    laps: Array.isArray(r.laps) ? r.laps.filter(num) : [],
    sessionStart: num(r.sessionStart) ? (r.sessionStart as number) : null,
  };
}

/**
 * "m:ss", or "h:mm:ss" from an hour, optionally with tenths. Countdowns round up ('up'),
 * so the display reads 0:00 only once the time has actually run out.
 */
export function formatDuration(ms: number, tenths = false, round: 'down' | 'up' = 'down'): string {
  const unit = tenths ? 100 : 1000;
  const units = round === 'up' ? Math.ceil(ms / unit) : Math.floor(ms / unit);
  const totalSec = tenths ? Math.floor(units / 10) : units;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = String(totalSec % 60).padStart(2, '0');
  const base = h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  return tenths ? `${base}.${units % 10}` : base;
}
