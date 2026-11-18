import { useCallback, useEffect, useRef, useState } from 'react';
import type { Vec } from '../core/geometry';
import { presentChannel, type PresentMessage } from '../core/presentation';
import type { DocumentStore } from '../core/store';

/**
 * Presenting from the editor: opens the audience window and keeps it in step: the notebook on
 * request, every change, the current page, and the laser pointer.
 */
export function usePresenter(store: DocumentStore, title: string, pageId: string | undefined) {
  const [presenting, setPresenting] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const win = useRef<Window | null>(null);
  const latest = useRef({ title, pageId });
  latest.current = { title, pageId };

  const post = (msg: PresentMessage) => channel.current?.postMessage(msg);

  const stop = useCallback(() => {
    channel.current?.postMessage({ type: 'end' } satisfies PresentMessage);
    channel.current?.close();
    channel.current = null;
    win.current?.close();
    win.current = null;
    setPresenting(false);
  }, []);

  const start = () => {
    if (channel.current) {
      win.current?.focus();
      return;
    }
    const ch = new BroadcastChannel(presentChannel(store.doc.id));
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<PresentMessage>) => {
      if (e.data.type === 'hello') {
        const { title: t, pageId: p } = latest.current;
        post({ type: 'sync', doc: store.doc, pageId: p ?? store.doc.pages[0]?.id ?? '', title: t });
      } else if (e.data.type === 'bye') {
        stop();
      }
    };
    // A popup the presenter can move to the projector or second screen.
    win.current = window.open(`${location.pathname}${location.search}#/present/${store.doc.id}`, 'jnotes-presentation', 'popup,width=1024,height=768');
    if (!win.current) {
      ch.close();
      channel.current = null;
      alert('The presentation window was blocked. Allow pop-ups for J Notes and try again.');
      return;
    }
    setPresenting(true);
  };

  // Changes made while presenting.
  useEffect(() => {
    if (!presenting) return;
    return store.onEvents((events) => post({ type: 'ops', ops: events.map((e) => e.op) }));
  }, [presenting, store]);

  // The page being shown.
  useEffect(() => {
    if (presenting && pageId) post({ type: 'page', pageId });
  }, [presenting, pageId]);

  // A closed audience window ends presenting (its 'bye' may not arrive if it is closed abruptly).
  useEffect(() => {
    if (!presenting) return;
    const t = setInterval(() => win.current?.closed && stop(), 1000);
    return () => clearInterval(t);
  }, [presenting, stop]);

  // Leaving the notebook ends the presentation.
  useEffect(() => stop, [stop]);

  const sendLaser = useCallback((laserPage: string, points: Vec[], head: Vec | null) => {
    channel.current?.postMessage({ type: 'laser', pageId: laserPage, points, head } satisfies PresentMessage);
  }, []);

  return { presenting, start, stop, sendLaser };
}
