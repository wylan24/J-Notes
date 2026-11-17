// The microphone recorder. One recording at a time for the whole app; ink drawn while it runs is
// stamped with its id and the time into the audio (paused time excluded), via `audioStamp`.
import { useSyncExternalStore } from 'react';
import { newId } from '../core/ids';

export type RecorderState = 'idle' | 'recording' | 'paused';

interface Session {
  id: string;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  /** Audio time before the current running segment. */
  accumulated: number;
  segmentStart: number | null;
  mimeType: string;
}

let session: Session | null = null;
let state: RecorderState = 'idle';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Opus in WebM where supported (Chrome, Firefox), else MP4/AAC (Safari). */
function pickMimeType(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export const recordingSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export function recordingElapsed(now = performance.now()): number {
  if (!session) return 0;
  return session.accumulated + (session.segmentStart === null ? 0 : now - session.segmentStart);
}

/** The recording and time (ms into it) to stamp new ink with, or null when not recording (or paused). */
export function audioStamp(): { rec: string; t: number } | null {
  return session && state === 'recording' ? { rec: session.id, t: Math.round(recordingElapsed()) } : null;
}

export async function startRecording(): Promise<void> {
  if (session) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const s: Session = { id: newId(), recorder, stream, chunks: [], accumulated: 0, segmentStart: performance.now(), mimeType: recorder.mimeType || mimeType || 'audio/webm' };
  recorder.ondataavailable = (e) => e.data.size && s.chunks.push(e.data);
  recorder.start(1000); // a chunk a second, so little is lost if the tab dies
  session = s;
  state = 'recording';
  emit();
}

export function pauseRecording(): void {
  if (!session || state !== 'recording') return;
  session.recorder.pause();
  session.accumulated = recordingElapsed();
  session.segmentStart = null;
  state = 'paused';
  emit();
}

export function resumeRecording(): void {
  if (!session || state !== 'paused') return;
  session.recorder.resume();
  session.segmentStart = performance.now();
  state = 'recording';
  emit();
}

/** Stop, release the microphone, and hand back the audio (null if nothing was recording). */
export function stopRecording(): Promise<{ id: string; blob: Blob; durationMs: number; mimeType: string } | null> {
  const s = session;
  if (!s) return Promise.resolve(null);
  const durationMs = Math.round(recordingElapsed());
  return new Promise((resolve) => {
    s.recorder.onstop = () => {
      s.stream.getTracks().forEach((t) => t.stop());
      resolve({ id: s.id, blob: new Blob(s.chunks, { type: s.mimeType }), durationMs, mimeType: s.mimeType });
    };
    s.recorder.stop();
    session = null;
    state = 'idle';
    emit();
  });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const useRecorderState = () => useSyncExternalStore(subscribe, () => state);
