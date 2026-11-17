import { useEffect, useRef } from 'react';
import { rotateRuler, rulerDegrees, setRulerAngle, twoFingerRuler, type Ruler } from '../core/ruler';
import type { Vec } from '../core/geometry';
import { Icon } from './icons';

const CM = 96 / 2.54; // page units per centimetre (pages are 96 dpi)

/**
 * The ruler overlay, positioned in the canvas area's coordinates. Drag it to move it; two fingers,
 * the wheel or the end knob turn it; double-click levels it. Strokes snap to it in PageView.
 */
export function RulerOverlay({ ruler, setRuler, zoom, onClose }: { ruler: Ruler; setRuler: (r: Ruler) => void; zoom: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Vec>());
  const latest = useRef(ruler);
  latest.current = ruler;

  // Wheel turns the ruler, 1° a notch. A native listener, because React's wheel handler is passive.
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return; // leave pinch-zoom alone
      e.preventDefault();
      setRuler(rotateRuler(latest.current, (Math.sign(e.deltaY || e.deltaX) * Math.PI) / 180));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setRuler]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    const r = latest.current;
    if (ps.size >= 2) {
      const [a, b] = [...ps.entries()];
      const from: [Vec, Vec] = [a[1], b[1]];
      const to: [Vec, Vec] = [a[0] === e.pointerId ? next : a[1], b[0] === e.pointerId ? next : b[1]];
      setRuler(twoFingerRuler(r, from, to));
    } else {
      setRuler({ ...r, cx: r.cx + next.x - prev.x, cy: r.cy + next.y - prev.y });
    }
    ps.set(e.pointerId, next);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => pointers.current.delete(e.pointerId);

  // The end knob turns the ruler to point at the pointer.
  const onKnobDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onKnobMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const area = ref.current!.offsetParent!.getBoundingClientRect();
    const r = latest.current;
    setRuler(setRulerAngle(r, Math.atan2(e.clientY - area.top - r.cy, e.clientX - area.left - r.cx)));
  };

  const cm = CM * zoom;
  const minor = cm / 10 >= 4 ? cm / 10 : cm / 2;
  const tick = (size: number, len: string) => `linear-gradient(to right, var(--ruler-tick) 1px, transparent 1px) 0 0 / ${size}px ${len} repeat-x`;
  const deg = rulerDegrees(ruler);

  return (
    <div
      ref={ref}
      className="ruler"
      data-no-gesture
      role="slider"
      aria-label="Ruler angle"
      aria-valuemin={0}
      aria-valuemax={179}
      aria-valuenow={deg}
      aria-valuetext={`${deg} degrees`}
      tabIndex={0}
      style={{
        left: ruler.cx - ruler.length / 2,
        top: ruler.cy - ruler.width / 2,
        width: ruler.length,
        height: ruler.width,
        transform: `rotate(${ruler.angle}rad)`,
        background: `${tick(cm, '38%')}, ${tick(minor, '20%')}, var(--ruler-bg)`,
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => setRuler(setRulerAngle(latest.current, 0))}
      onKeyDown={(e) => {
        // Arrow keys turn it a degree at a time.
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          setRuler(rotateRuler(latest.current, ((e.key === 'ArrowRight' ? 1 : -1) * Math.PI) / 180));
        }
      }}
    >
      <span className="ruler-angle">{deg}°</span>
      <button className="ruler-close" aria-label="Put the ruler away" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
        <Icon name="close" />
      </button>
      <div className="ruler-knob" aria-hidden="true" title="Drag to turn" onPointerDown={onKnobDown} onPointerMove={onKnobMove} />
    </div>
  );
}
