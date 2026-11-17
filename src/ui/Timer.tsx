import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { elapsed, formatDuration, remaining, summarize, type Session, type TimerMode } from '../core/timer';
import { clearSessions, listSessions } from '../storage/db';
import { Icon } from './icons';
import { timer, useNow, useTimer } from './timerStore';

const PRESETS = [5, 10, 15, 25, 45, 60];
const MIN = 60_000;

function humanize(ms: number): string {
  const m = Math.floor(ms / MIN);
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}

/**
 * Mounted once for the whole app: finishes countdowns whichever screen is open
 * (and on load, for one that ran out while the app was closed), and shows the alert.
 */
export function TimerWatcher() {
  const { timer: t, alert } = useTimer();
  const counting = t.mode === 'countdown' && t.running;
  useEffect(() => {
    if (!counting) return;
    timer.check();
    const id = setInterval(() => timer.check(), 250);
    return () => clearInterval(id);
  }, [counting]);

  if (!alert) return null;
  return (
    <div className="timer-alert" role="alert" data-no-gesture>
      <Icon name="timer" />
      <span>
        <strong>Time's up</strong> · {humanize(alert.targetMs)} timer
      </span>
      <button className="btn sm" onClick={() => timer.dismissAlert()} autoFocus>
        Dismiss
      </button>
    </div>
  );
}

/** Toolbar button that shows the running time, and opens the timer panel. */
export function TimerButton({ notebookId, notebookTitle }: { notebookId: string; notebookTitle: string }) {
  const [open, setOpen] = useState(false);
  // The panel hangs left from the button; if that would run off the left edge, it hangs right instead.
  // Measured before paint, so it never flashes on the wrong side.
  const [alignLeft, setAlignLeft] = useState(false);
  useLayoutEffect(() => {
    if (!open) return setAlignLeft(false);
    const panel = wrap.current?.querySelector('.timer-panel');
    if (panel && panel.getBoundingClientRect().left < 8) setAlignLeft(true);
  }, [open]);
  const { timer: t } = useTimer();
  const now = useNow(t.running, 500);
  const wrap = useRef<HTMLDivElement>(null);
  const active = t.sessionStart !== null;

  // Close on a tap outside or Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = t.mode === 'countdown' ? formatDuration(remaining(t, now), false, 'up') : formatDuration(elapsed(t, now));
  return (
    <div className={`timer-wrap ${alignLeft ? 'align-left' : ''}`} ref={wrap}>
      <button
        className={`icon-btn timer-btn ${active ? 'has-time' : ''} ${t.running ? 'running' : ''}`}
        aria-label={active ? `Timer, ${label}${t.running ? '' : ', paused'}` : 'Timer'}
        aria-expanded={open}
        title="Timer and stopwatch"
        onClick={() => setOpen(!open)}
      >
        <Icon name="timer" />
        {active && <span className="timer-chip">{label}</span>}
      </button>
      {open && <TimerPanel notebookId={notebookId} notebookTitle={notebookTitle} />}
    </div>
  );
}

function TimerPanel({ notebookId, notebookTitle }: { notebookId: string; notebookTitle: string }) {
  const { timer: t, historyVersion } = useTimer();
  const now = useNow(t.running, t.mode === 'stopwatch' ? 100 : 250);
  const [history, setHistory] = useState<Session[] | null>(null);
  const idle = t.sessionStart === null;

  useEffect(() => {
    let live = true;
    listSessions(30)
      .then((s) => live && setHistory(s))
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [historyVersion]);

  const left = remaining(t, now);
  const shown = t.mode === 'countdown' ? formatDuration(left, false, 'up') : formatDuration(elapsed(t, now), true);
  const today = history ? summarize(history, now) : null;

  return (
    <div className="timer-panel" role="dialog" aria-label="Timer" data-no-gesture>
      <div className="segmented timer-modes" role="radiogroup" aria-label="Mode">
        {(['stopwatch', 'countdown'] as TimerMode[]).map((m) => (
          <button key={m} role="radio" aria-checked={t.mode === m} className={t.mode === m ? 'active' : ''} onClick={() => timer.setMode(m)}>
            {m === 'stopwatch' ? 'Stopwatch' : 'Timer'}
          </button>
        ))}
      </div>

      <div className={`timer-display ${t.running ? 'running' : ''}`} aria-live="off">
        {shown}
      </div>
      {t.mode === 'countdown' && (
        <div className="timer-progress" aria-hidden="true">
          <span style={{ width: `${(1 - left / t.target) * 100}%` }} />
        </div>
      )}

      {t.mode === 'countdown' && idle && (
        <div className="timer-presets">
          {PRESETS.map((m) => (
            <button key={m} className={`chip ${t.target === m * MIN ? 'active' : ''}`} onClick={() => timer.setTarget(m * MIN)}>
              {m} min
            </button>
          ))}
          <label className="timer-custom">
            <input
              type="number"
              min={1}
              max={600}
              value={Math.round(t.target / MIN)}
              aria-label="Minutes"
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 1 && v <= 600) timer.setTarget(v * MIN);
              }}
            />
            min
          </label>
        </div>
      )}

      <div className="timer-actions">
        {t.running ? (
          <button className="btn primary" onClick={() => timer.pause()}>
            Pause
          </button>
        ) : (
          <button className="btn primary" onClick={() => timer.start({ notebookId, notebookTitle })}>
            {idle ? 'Start' : 'Resume'}
          </button>
        )}
        {t.mode === 'stopwatch' && t.running && (
          <button className="btn" onClick={() => timer.lap()}>
            Lap
          </button>
        )}
        {!idle && (
          <button className="btn ghost" onClick={() => timer.reset()} title="Stop and save to history">
            Reset
          </button>
        )}
      </div>

      {t.laps.length > 0 && (
        <ol className="timer-laps">
          {t.laps
            .map((at, i) => ({ at, split: at - (t.laps[i - 1] ?? 0), n: i + 1 }))
            .reverse()
            .map(({ at, split, n }) => (
              <li key={n}>
                <span>Lap {n}</span>
                <span>{formatDuration(split, true)}</span>
                <span className="muted">{formatDuration(at, true)}</span>
              </li>
            ))}
        </ol>
      )}

      <div className="timer-history">
        <div className="timer-history-head">
          <span>{today ? `Today: ${humanize(today.todayMs)} · ${today.todayCount} session${today.todayCount === 1 ? '' : 's'}` : 'History'}</span>
          {!!history?.length && (
            <button
              className="link-btn"
              onClick={() => {
                if (confirm('Clear all timer history?')) void clearSessions().then(() => setHistory([]));
              }}
            >
              Clear
            </button>
          )}
        </div>
        {history?.length === 0 && <p className="muted small">Finished timers and stopwatch runs appear here.</p>}
        <ul>
          {history?.map((s) => (
            <li key={s.id}>
              <span className="timer-h-kind">{s.mode === 'stopwatch' ? 'Stopwatch' : s.completed ? `Timer ✓` : 'Timer (stopped)'}</span>
              <span className="timer-h-dur">{formatDuration(s.durationMs)}</span>
              <span className="muted">
                {new Date(s.endedAt).toLocaleString(undefined, sameDay(s.endedAt, now) ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' })}
                {s.notebookTitle ? ` · ${s.notebookTitle}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
