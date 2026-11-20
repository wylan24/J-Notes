// Flashcard faces: showing a side (text and/or a drawing), and editing one (typing, drawing with
// the pen or a finger, adding a picture).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardSide, Drawing, Stroke } from '../core/model';
import { cropDrawing, fitDrawing, hasDrawing } from '../core/study';
import { newId } from '../core/ids';
import { newImage } from '../core/items';
import { paintRegion } from '../render/page';
import { imageResolver, onImagesLoaded, primeImage } from '../render/items';
import { prepareImage } from '../io/images';
import { putBlob } from '../storage/db';
import { Icon } from './icons';

/** Most a drawing is enlarged to fill a card face. */
const MAX_ZOOM = 3;

/** A drawing fitted and centred in its box, repainted as the box resizes and as photos load. */
export function DrawingView({ drawing, docId, className = 'card-drawing' }: { drawing: Drawing; docId: string; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, setLoaded] = useState(0);

  useLayoutEffect(() => {
    const el = canvas.current?.parentElement;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => onImagesLoaded(() => setLoaded((n) => n + 1)), []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w || !size.h) return;
    const pad = Math.max(drawing.w, drawing.h) * 0.04 + 4;
    // Fill the box, but never more than 3× life size: a lassoed word shouldn't turn into a poster.
    let rw = Math.max(drawing.w + 2 * pad, size.w / MAX_ZOOM);
    let rh = Math.max(drawing.h + 2 * pad, size.h / MAX_ZOOM);
    if (rw / rh < size.w / size.h) rw = (rh * size.w) / size.h;
    else rh = (rw * size.h) / size.w;
    const rect = { x: drawing.w / 2 - rw / 2, y: drawing.h / 2 - rh / 2, w: rw, h: rh };
    const page = { id: 'card', template: 'blank' as const, strokes: drawing.strokes, items: drawing.items };
    paintRegion(c, page, rect, size.w, size.h, window.devicePixelRatio || 1, { items: { images: imageResolver(docId) } });
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
  });

  return (
    <div className={className}>
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}

/** One side of a card, as it is studied. */
export function CardFace({ side, docId, label }: { side: CardSide; docId: string; label: string }) {
  const drawing = hasDrawing(side.drawing) ? side.drawing : null;
  const text = side.text.trim();
  return (
    <div className={`card-face ${drawing ? 'has-drawing' : ''} ${text.length > 120 ? 'long' : ''}`} aria-label={label}>
      {drawing && <DrawingView drawing={drawing} docId={docId} />}
      {text && <p className="card-text">{text}</p>}
      {!drawing && !text && <p className="card-text muted">Empty</p>}
    </div>
  );
}

/** Size of the drawing pad, in drawing units. */
const PAD_W = 480;
const PAD_H = 300;
const PAD_COLORS = ['#1c1c1e', '#2557c7', '#d1342f', '#1d8a4a'];

/**
 * Edit one side of a card: its text, and a drawing made on the pad (with any picture added to it).
 * Pictures are stored in `docId`'s blob store as they are added.
 */
export function SideEditor({
  label,
  side,
  docId,
  onChange,
  autoFocus,
  pictures = true,
}: {
  label: string;
  side: CardSide;
  docId: string;
  onChange: (s: CardSide) => void;
  autoFocus?: boolean;
  /** Offer adding a picture. */
  pictures?: boolean;
}) {
  // The pad works in its own units; the side's drawing is fitted into it once, and cropped back on each change.
  const [pad, setPad] = useState<Drawing>(() => (hasDrawing(side.drawing) ? fitDrawing(side.drawing, PAD_W, PAD_H) : { strokes: [], items: [], w: PAD_W, h: PAD_H }));
  const [drawingOpen, setDrawingOpen] = useState(() => hasDrawing(side.drawing));
  const [color, setColor] = useState(PAD_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const setDrawing = (next: Drawing) => {
    setPad(next);
    onChange({ ...side, drawing: cropDrawing(next.strokes, next.items) });
  };

  const addPicture = async (file: File) => {
    setBusy(true);
    try {
      const img = await prepareImage(file);
      const blobId = newId();
      await putBlob({ docId, id: blobId, type: img.type, bytes: img.bytes });
      primeImage(docId, blobId, img.img);
      const item = newImage(blobId, img.width, img.height, { x: PAD_W / 2, y: PAD_H / 2 }, { w: PAD_W - 32, h: PAD_H - 32 });
      // Centre it on the pad (it was fitted to a box 16 units smaller on each side).
      setDrawing({ ...pad, items: [...pad.items, { ...item, x: (PAD_W - item.w) / 2, y: (PAD_H - item.h) / 2 }] });
      setDrawingOpen(true);
    } catch (e) {
      alert(`Could not add this picture: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const empty = !pad.strokes.length && !pad.items.length;
  return (
    <fieldset className="field side-editor">
      <legend>{label}</legend>
      <textarea
        className="side-text"
        value={side.text}
        autoFocus={autoFocus}
        rows={2}
        placeholder={drawingOpen ? 'Text (optional)' : 'Type, or draw below'}
        aria-label={`${label} text`}
        onChange={(e) => onChange({ ...side, text: e.target.value })}
      />
      {drawingOpen ? (
        <>
          <DrawPad drawing={pad} docId={docId} color={color} onDrawing={setDrawing} label={`${label} drawing`} />
          <div className="pad-tools">
            <div className="pad-colors" role="radiogroup" aria-label="Pen colour">
              {PAD_COLORS.map((c) => (
                <button type="button" key={c} role="radio" aria-checked={color === c} aria-label={`Pen colour ${c}`} className={`pad-swatch ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
            <button type="button" className="btn sm ghost" disabled={!pad.strokes.length} onClick={() => setDrawing({ ...pad, strokes: pad.strokes.slice(0, -1) })}>
              <Icon name="undo" /> Undo
            </button>
            {pictures && (
              <button type="button" className="btn sm ghost" disabled={busy} onClick={() => fileInput.current?.click()}>
                <Icon name="image" /> {busy ? 'Adding…' : 'Picture'}
              </button>
            )}
            <button
              type="button"
              className="btn sm ghost danger"
              disabled={empty}
              onClick={() => setDrawing({ strokes: [], items: [], w: PAD_W, h: PAD_H })}
            >
              Clear
            </button>
          </div>
        </>
      ) : (
        <div className="pad-tools">
          <button type="button" className="btn sm ghost" onClick={() => setDrawingOpen(true)}>
            <Icon name="pen" /> Draw
          </button>
          {pictures && (
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => fileInput.current?.click()}>
              <Icon name="image" /> {busy ? 'Adding…' : 'Add picture'}
            </button>
          )}
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void addPicture(f);
        }}
      />
    </fieldset>
  );
}

/** A small canvas to draw on with a pen, finger or mouse. */
function DrawPad({ drawing, docId, color, onDrawing, label }: { drawing: Drawing; docId: string; color: string; onDrawing: (d: Drawing) => void; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<Stroke | null>(null);
  const [, repaint] = useState(0);
  useEffect(() => onImagesLoaded(() => repaint((n) => n + 1)), []);

  const paint = () => {
    const c = canvas.current;
    if (!c) return;
    const w = c.clientWidth || PAD_W;
    const strokes = live.current ? [...drawing.strokes, live.current] : drawing.strokes;
    const page = { id: 'pad', template: 'blank' as const, strokes, items: drawing.items };
    paintRegion(c, page, { x: 0, y: 0, w: PAD_W, h: PAD_H }, w, (w * PAD_H) / PAD_W, window.devicePixelRatio || 1, { items: { images: imageResolver(docId) } });
  };
  useEffect(paint);
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toPad = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * PAD_W) / r.width, y: ((e.clientY - r.top) * PAD_H) / r.height, p: e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5 };
  };

  return (
    <canvas
      ref={canvas}
      className="draw-pad"
      role="img"
      aria-label={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        live.current = { id: newId(), tool: 'pen', penStyle: 'ball', color, width: 3, simulatePressure: e.pointerType !== 'pen', points: [toPad(e)] };
        paint();
      }}
      onPointerMove={(e) => {
        const s = live.current;
        if (!s) return;
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
        const pts = events.length ? events.map((ev) => toPad(ev as unknown as React.PointerEvent)) : [toPad(e)];
        live.current = { ...s, points: [...s.points, ...pts] };
        paint();
      }}
      onPointerUp={() => {
        const s = live.current;
        live.current = null;
        if (s) onDrawing({ ...drawing, strokes: [...drawing.strokes, s] });
      }}
      onPointerCancel={() => {
        live.current = null;
        paint();
      }}
    />
  );
}
