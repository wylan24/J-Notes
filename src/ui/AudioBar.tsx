import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Recording } from '../core/model';
import { formatDuration } from '../core/timer';
import { getBlob } from '../storage/db';
import { Icon } from './icons';
import { pauseRecording, recordingElapsed, resumeRecording, startRecording, useRecorderState } from './recorder';

export interface AudioApi {
  /** Play recording `rec` from `t` ms (tapping its ink). */
  seek: (rec: string, t: number) => void;
}

interface Props {
  docId: string;
  recordings: Recording[];
  /** Stop the recorder and save the result; resolves with the new recording's id. */
  onStopRecording: () => Promise<string | null>;
  onDelete: (rec: Recording) => void;
  /** Where playback is, for fading ink it hasn't reached; null when not playing back. */
  setPlayback: (p: { rec: string; t: number } | null) => void;
  api: MutableRefObject<AudioApi | null>;
  onClose: () => void;
}

/** Record audio while writing, and play it back with the ink following along. */
export function AudioBar({ docId, recordings, onStopRecording, onDelete, setPlayback, api, onClose }: Props) {
  const recState = useRecorderState();
  const [selected, setSelected] = useState<string | null>(recordings.at(-1)?.id ?? null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [active, setActive] = useState(false); // playback started at least once for this recording
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const rec = recordings.find((r) => r.id === selected) ?? null;

  // Keep a valid selection as recordings come and go (new recording, delete, undo).
  useEffect(() => {
    if (!rec) setSelected(recordings.at(-1)?.id ?? null);
  }, [rec, recordings]);

  // Load the selected recording's audio.
  useEffect(() => {
    setPlaying(false);
    setActive(false);
    setT(0);
    if (!rec) return;
    let url: string | null = null;
    let cancelled = false;
    const el = new Audio();
    el.preload = 'auto';
    audio.current = el;
    el.onended = () => setPlaying(false);
    el.onpause = () => setPlaying(false);
    el.onplay = () => setPlaying(true);
    void getBlob(docId, rec.blobId).then((b) => {
      if (cancelled) return;
      if (!b) return setError('The audio for this recording is missing.');
      url = URL.createObjectURL(new Blob([b.bytes], { type: b.type }));
      el.src = url;
      if (pendingSeek.current !== null) {
        const at = pendingSeek.current;
        pendingSeek.current = null;
        play(at);
      }
    });
    return () => {
      cancelled = true;
      el.pause();
      if (url) URL.revokeObjectURL(url);
      if (audio.current === el) audio.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.id, docId]);

  // Follow the audio about ten times a second while it plays.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = -1;
    const tick = () => {
      const now = (audio.current?.currentTime ?? 0) * 1000;
      if (Math.abs(now - last) >= 100) {
        last = now;
        setT(now);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    setPlayback(rec && active ? { rec: rec.id, t } : null);
  }, [rec, active, t, setPlayback]);
  useEffect(() => () => setPlayback(null), [setPlayback]);

  function play(fromMs?: number) {
    const el = audio.current;
    if (!el) return;
    if (fromMs !== undefined) {
      el.currentTime = fromMs / 1000;
      setT(fromMs);
    }
    setActive(true);
    setError(null);
    void el.play().catch((e: Error) => setError(`Could not play: ${e.message}`));
  }

  api.current = {
    seek: (recId, at) => {
      if (recId !== selected) {
        pendingSeek.current = at; // played once the audio has loaded
        setSelected(recId);
      } else play(at);
    },
  };

  // --- Recording ---
  const [, force] = useState(0);
  useEffect(() => {
    if (recState === 'idle') return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [recState]);

  const record = async () => {
    setError(null);
    audio.current?.pause();
    setActive(false);
    try {
      await startRecording();
    } catch (e) {
      setError((e as Error).name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser to record.' : `Could not record: ${(e as Error).message}`);
    }
  };
  const stop = async () => {
    const id = await onStopRecording();
    if (id) setSelected(id);
  };

  if (recState !== 'idle') {
    return (
      <div className="audio-bar recording" data-no-gesture role="region" aria-label="Recording">
        <span className={`rec-dot ${recState === 'paused' ? 'paused' : ''}`} aria-hidden="true" />
        <span className="audio-time">{formatDuration(recordingElapsed())}</span>
        <span className="muted small">{recState === 'paused' ? 'Paused: ink written now is not linked' : 'Recording: ink you write is linked to the audio'}</span>
        <span className="spacer" />
        {recState === 'recording' ? (
          <button className="btn sm" onClick={pauseRecording}>
            Pause
          </button>
        ) : (
          <button className="btn sm" onClick={resumeRecording}>
            Resume
          </button>
        )}
        <button className="btn sm primary" onClick={() => void stop()}>
          Stop
        </button>
      </div>
    );
  }

  return (
    <div className="audio-bar" data-no-gesture role="region" aria-label="Audio recordings">
      <button className="btn sm rec-btn" onClick={() => void record()} title="Record audio while you write">
        <span className="rec-dot" aria-hidden="true" /> Record
      </button>
      {rec ? (
        <>
          <span className="divider" />
          {recordings.length > 1 && (
            <select className="audio-select" value={rec.id} onChange={(e) => setSelected(e.target.value)} aria-label="Recording">
              {recordings.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({formatDuration(r.durationMs)})
                </option>
              ))}
            </select>
          )}
          <button className="icon-btn sm" aria-label={playing ? 'Pause' : 'Play'} onClick={() => (playing ? audio.current?.pause() : play())}>
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <span className="audio-time">{formatDuration(t)}</span>
          <input
            className="audio-scrub"
            type="range"
            min={0}
            max={rec.durationMs}
            step={100}
            value={Math.min(t, rec.durationMs)}
            aria-label="Position"
            onChange={(e) => {
              const v = Number(e.target.value);
              setT(v);
              setActive(true);
              if (audio.current) audio.current.currentTime = v / 1000;
            }}
          />
          <span className="audio-time muted">{formatDuration(rec.durationMs)}</span>
          <button
            className="icon-btn sm"
            aria-label={`Delete ${rec.name}`}
            title="Delete recording"
            onClick={() => confirm(`Delete “${rec.name}”? You can undo this.`) && onDelete(rec)}
          >
            <Icon name="trash" />
          </button>
          <span className="audio-hint muted small">{error ?? 'Tap ink to hear what was said as you wrote it'}</span>
        </>
      ) : (
        <span className="audio-hint muted small">{error ?? 'Record a lecture or meeting while you write; tap the ink later to replay that moment.'}</span>
      )}
      <button className="icon-btn sm" aria-label="Close audio" title="Close" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}
