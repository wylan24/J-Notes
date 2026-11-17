import { describe, expect, it } from 'vitest';
import {
  elapsed,
  finishedAt,
  formatDuration,
  idle,
  isFinished,
  lap,
  pause,
  remaining,
  restore,
  sessionFrom,
  setMode,
  setTarget,
  start,
  summarize,
  type Session,
} from '../src/core/timer';

const MIN = 60_000;

describe('stopwatch', () => {
  it('counts only while running, across pauses', () => {
    let s = start(idle('stopwatch'), 1000);
    expect(elapsed(s, 4000)).toBe(3000);
    s = pause(s, 4000);
    expect(elapsed(s, 99_000)).toBe(3000);
    s = start(s, 10_000);
    expect(elapsed(s, 12_000)).toBe(5000);
    expect(s.sessionStart).toBe(1000); // the session began at the first start
  });

  it('records laps as split times', () => {
    let s = start(idle('stopwatch'), 0);
    s = lap(s, 1500);
    s = lap(s, 4000);
    expect(s.laps).toEqual([1500, 4000]);
    expect(lap(pause(s, 5000), 6000).laps).toEqual([1500, 4000]); // no laps while paused
  });

  it('starting or pausing twice is harmless', () => {
    const s = start(idle('stopwatch'), 0);
    expect(start(s, 500)).toBe(s);
    const p = pause(s, 1000);
    expect(pause(p, 2000)).toBe(p);
  });
});

describe('countdown', () => {
  it('counts down from the target and finishes at zero', () => {
    let s = start(setTarget(idle('countdown'), 5 * MIN), 0);
    expect(remaining(s, MIN)).toBe(4 * MIN);
    expect(isFinished(s, 5 * MIN - 1)).toBe(false);
    expect(isFinished(s, 5 * MIN)).toBe(true);
    expect(remaining(s, 9 * MIN)).toBe(0);
    s = pause(s, 2 * MIN);
    s = start(s, 10 * MIN);
    // 3 minutes were left when it resumed at 10 minutes.
    expect(finishedAt(s)).toBe(13 * MIN);
  });

  it('a paused or idle countdown never finishes', () => {
    const s = setTarget(idle('countdown'), MIN);
    expect(isFinished(s, 10 * MIN)).toBe(false);
    expect(finishedAt(s)).toBeNull();
    expect(isFinished(pause(start(s, 0), 30_000), 10 * MIN)).toBe(false);
  });

  it('the target can only change while idle', () => {
    const running = start(setTarget(idle('countdown'), MIN), 0);
    expect(setTarget(running, 10 * MIN)).toBe(running);
  });
});

describe('sessions', () => {
  it('builds a session from a run, or nothing for very short ones', () => {
    const s = pause(start(idle('stopwatch'), 1000), 61_000);
    expect(sessionFrom(s, 70_000, { notebookId: 'n', notebookTitle: 'Maths' })).toMatchObject({
      mode: 'stopwatch',
      startedAt: 1000,
      endedAt: 70_000,
      durationMs: 60_000,
      completed: false,
      notebookTitle: 'Maths',
    });
    expect(sessionFrom(pause(start(idle('stopwatch'), 0), 500), 600)).toBeNull();
  });

  it('a finished countdown ends when it reached zero, not when it was noticed', () => {
    const s = start(setTarget(idle('countdown'), 25 * MIN), 0);
    expect(sessionFrom(s, 40 * MIN)).toMatchObject({ endedAt: 25 * MIN, durationMs: 25 * MIN, targetMs: 25 * MIN, completed: true });
  });

  it('switching mode resets the timer', () => {
    const s = setMode(start(idle('stopwatch'), 0), 'countdown');
    expect(s.mode).toBe('countdown');
    expect(s.running).toBe(false);
    expect(elapsed(s, 10_000)).toBe(0);
  });

  it('summarises today', () => {
    const now = new Date(2026, 10, 17, 15, 0).getTime();
    const day = (h: number) => new Date(2026, 10, 17, h).getTime();
    const sessions: Session[] = [
      { id: 'a', mode: 'stopwatch', startedAt: day(9), endedAt: day(10), durationMs: 60 * MIN, completed: false },
      { id: 'b', mode: 'countdown', startedAt: day(11), endedAt: day(11) + 25 * MIN, durationMs: 25 * MIN, targetMs: 25 * MIN, completed: true },
      { id: 'c', mode: 'stopwatch', startedAt: day(9) - 86_400_000, endedAt: day(10) - 86_400_000, durationMs: 60 * MIN, completed: false },
    ];
    expect(summarize(sessions, now)).toEqual({ todayMs: 85 * MIN, todayCount: 2 });
    // A session saved after the caller's `now` was taken (a stale clock) still counts.
    expect(summarize(sessions, day(10)).todayCount).toBe(2);
  });
});

describe('restore', () => {
  it('accepts saved state and rejects junk', () => {
    const s = start(setTarget(idle('countdown'), MIN), 5);
    expect(restore(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(restore({ mode: 'nope' })).toEqual(idle('stopwatch'));
    expect(restore(null)).toEqual(idle('stopwatch'));
  });
});

describe('formatDuration', () => {
  it('formats as m:ss, or h:mm:ss past an hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(1_234, true)).toBe('0:01.2');
  });

  it('rounds countdowns up so the display hits 0:00 exactly at the end', () => {
    expect(formatDuration(59_001, false, 'up')).toBe('1:00');
    expect(formatDuration(1, false, 'up')).toBe('0:01');
  });
});
