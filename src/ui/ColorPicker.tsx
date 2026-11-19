import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hexToHsv, hsToWheel, hsvToHex, parseHexColor, wheelToHs, type Hsv } from '../core/color';
import { Icon } from './icons';

const WHEEL = 168;

/** The hue/saturation disc at full brightness, painted once. */
function paintWheel(c: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const size = Math.round(WHEEL * dpr);
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r + 0.5, dy = y - r + 0.5;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const { h, s } = wheelToHs(dx, dy, r);
      const hex = hsvToHex({ h, s, v: 1 });
      const n = parseInt(hex.slice(1), 16);
      const i = (y * size + x) * 4;
      img.data[i] = (n >> 16) & 255;
      img.data[i + 1] = (n >> 8) & 255;
      img.data[i + 2] = n & 255;
      img.data[i + 3] = d > r - 1 ? Math.round(255 * (r - d)) : 255; // soft rim
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * A colour picker popover: a hue/saturation wheel with a brightness slider, a HEX field, picking a
 * colour off the page, and the viewer's own swatches (add the current colour, or remove one).
 */
export function ColorPicker({
  color,
  anchor,
  swatches,
  onChange,
  onPickFromPage,
  onAddSwatch,
  onRemoveSwatch,
  onClose,
}: {
  color: string;
  /** The button it opened from, to sit beneath. */
  anchor: DOMRect;
  swatches: readonly string[];
  onChange: (hex: string) => void;
  onPickFromPage: () => void;
  onAddSwatch: (hex: string) => void;
  onRemoveSwatch: (hex: string) => void;
  onClose: () => void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));
  const [hexText, setHexText] = useState(color);
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hex = hsvToHex(hsv);

  useLayoutEffect(() => {
    if (wheelRef.current) paintWheel(wheelRef.current);
  }, []);

  // Close on a press outside, or Escape.
  useEffect(() => {
    const down = (e: PointerEvent) => !panelRef.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const set = (next: Hsv) => {
    setHsv(next);
    const h = hsvToHex(next);
    setHexText(h);
    onChange(h);
  };

  const fromWheel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const { h, s } = wheelToHs(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, r.width / 2);
    // Picking a hue from a black colour would show nothing: lift brightness so the choice is visible.
    set({ h, s, v: hsv.v < 0.15 ? 1 : hsv.v });
  };

  const marker = hsToWheel(hsv.h, hsv.s, WHEEL / 2);
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 248));
  const top = Math.min(anchor.bottom + 8, window.innerHeight - 420);

  return createPortal(
    <div ref={panelRef} className="color-picker" style={{ left, top }} role="dialog" aria-label="Colour picker" data-no-gesture>
      <div className="color-wheel-wrap" style={{ width: WHEEL, height: WHEEL }}>
        <canvas
          ref={wheelRef}
          className="color-wheel-canvas"
          style={{ width: WHEEL, height: WHEEL, filter: `brightness(${0.15 + 0.85 * hsv.v})` }}
          aria-label="Hue and saturation"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            fromWheel(e);
          }}
          onPointerMove={(e) => e.buttons && fromWheel(e)}
        />
        <span className="color-wheel-marker" style={{ left: WHEEL / 2 + marker.x, top: WHEEL / 2 + marker.y, background: hex }} />
      </div>
      <label className="color-value">
        <span>Brightness</span>
        <input type="range" min={0} max={100} value={Math.round(hsv.v * 100)} onChange={(e) => set({ ...hsv, v: Number(e.target.value) / 100 })} aria-label="Brightness" />
      </label>
      <div className="color-row">
        <span className="color-preview" style={{ background: hex }} />
        <input
          className="color-hex"
          value={hexText}
          aria-label="HEX colour"
          aria-invalid={!parseHexColor(hexText)}
          spellCheck={false}
          onChange={(e) => {
            setHexText(e.target.value);
            const c = parseHexColor(e.target.value);
            if (c) {
              setHsv(hexToHsv(c));
              onChange(c);
            }
          }}
          onBlur={() => setHexText(hex)}
        />
        <button className="icon-btn sm" onClick={onPickFromPage} aria-label="Pick a colour from the page" title="Pick from the page">
          <Icon name="eyedropper" />
        </button>
      </div>
      <div className="color-swatches">
        <span className="color-swatches-label">My colours</span>
        <div className="color-swatch-row">
          {swatches.map((c) => (
            <span key={c} className="color-swatch-wrap">
              <button className={`swatch-btn ${c === hex ? 'active' : ''}`} onClick={() => set(hexToHsv(c))} aria-label={`Colour ${c}`} title={c}>
                <span className="swatch" style={{ background: c }} />
              </button>
              <button className="color-swatch-remove" onClick={() => onRemoveSwatch(c)} aria-label={`Remove ${c} from my colours`}>
                ×
              </button>
            </span>
          ))}
          <button className="icon-btn sm" onClick={() => onAddSwatch(hex)} disabled={swatches.includes(hex)} aria-label="Add this colour to my colours" title="Add to my colours">
            <Icon name="plus" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
