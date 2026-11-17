// App-wide timer: one stopwatch/countdown shared by every screen, saved to localStorage so it
// survives reloads and moving between notebooks. Finished runs go to the IndexedDB history.
import { useEffect, useState, useSyncExternalStore } from 'react';
import * as T from '../core/timer';
import { addSession } from '../storage/db';

const KEY = 'jnotes.timer';

interface Context {
  notebookId?: string;
  notebookTitle?: string;
}

interface Stored {
  timer: T.TimerState;
  /** The notebook open when the run started, for the history label. */
  ctx: Context;
}

export interface TimerAlert {
  targetMs: number;
  at: number;
}

let stored: Stored = load();
let alert: TimerAlert | null = null;
let historyVersion = 0;
const listeners = new Set<() => void>();
let snapshot: Stored & { alert: TimerAlert | null; historyVersion: number } = { ...stored, alert, historyVersion };

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Stored> | null;
    return { timer: T.restore(raw?.timer), ctx: raw?.ctx ?? {} };
  } catch {
    return { timer: T.idle('stopwatch'), ctx: {} };
  }
}

function emit() {
  snapshot = { ...stored, alert, historyVersion };
  listeners.forEach((l) => l());
}

function commit(next: Stored) {
  stored = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* private mode: the timer still works for this page */
  }
  emit();
}

function save(session: T.Session | null) {
  if (!session) return;
  void addSession(session)
    .then(() => {
      historyVersion++;
      emit();
    })
    .catch((e) => console.error('Could not save timer session', e));
}

// --- Chime ----------------------------------------------------------------------------
// Browsers only allow audio after a user gesture, so the context is created when Start is pressed.
let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = null;
  }
}
function chime() {
  navigator.vibrate?.([200, 100, 200]);
  if (!audio) return;
  const t0 = audio.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = i === 2 ? 1175 : 880;
    gain.gain.setValueAtTime(0.0001, t0 + i * 0.28);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.28 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 0.25);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + i * 0.28);
    osc.stop(t0 + i * 0.28 + 0.26);
  }
}

// --- Actions -------------------------------------------------------------------------

export const timer = {
  start(ctx: Context = {}) {
    unlockAudio();
    const fresh = stored.timer.sessionStart === null;
    commit({ timer: T.start(stored.timer, Date.now()), ctx: fresh ? ctx : stored.ctx });
  },
  pause() {
    commit({ ...stored, timer: T.pause(stored.timer, Date.now()) });
  },
  lap() {
    commit({ ...stored, timer: T.lap(stored.timer, Date.now()) });
  },
  /** Stop and keep the run in history (if it was long enough). */
  reset() {
    save(T.sessionFrom(stored.timer, Date.now(), stored.ctx));
    commit({ timer: T.reset(stored.timer), ctx: {} });
  },
  setMode(mode: T.TimerMode) {
    if (mode === stored.timer.mode) return;
    save(T.sessionFrom(stored.timer, Date.now(), stored.ctx));
    commit({ timer: T.setMode(stored.timer, mode), ctx: {} });
  },
  setTarget(ms: number) {
    commit({ ...stored, timer: T.setTarget(stored.timer, ms) });
  },
  dismissAlert() {
    alert = null;
    emit();
  },
  /** Called on a tick: a countdown that reached zero is saved, reset and announced. */
  check(now = Date.now()) {
    if (!T.isFinished(stored.timer, now)) return;
    save(T.sessionFrom(stored.timer, now, stored.ctx));
    alert = { targetMs: stored.timer.target, at: T.finishedAt(stored.timer)! };
    commit({ timer: T.reset(stored.timer), ctx: {} });
    chime();
  },
};

// Another tab started or stopped the timer.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  stored = load();
  emit();
});

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useTimer() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** The current time, refreshed every `ms` while `active`. */
export function useNow(active: boolean, ms = 200): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}
