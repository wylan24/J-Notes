// Cropping a photo on the page: the whole image shows, turned and mirrored as the photo is, with
// the kept part bright and the rest dimmed. Edges, corners and the middle can be dragged.
import { useEffect, useRef, useState } from 'react';
import { cropOf, dragCrop, FULL_CROP, fullImageBox, itemMatrix, type CropHandle } from '../core/imageEdit';
import { itemBounds } from '../core/items';
import type { CropRect, ImageItem } from '../core/model';
import { invert, transformBounds } from '../core/transform';

interface Props {
  item: ImageItem;
  scale: number;
  image: CanvasImageSource | null;
  onDone: (crop: CropRect) => void;
  onCancel: () => void;
}

const HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function CropOverlay({ item, scale, image, onDone, onCancel }: Props) {
  const [crop, setCrop] = useState<CropRect>(cropOf(item));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<{ pointerId: number; handle: CropHandle; sx: number; sy: number; start: CropRect } | null>(null);
  const full = fullImageBox(item);
  const W = full.maxX - full.minX, H = full.maxY - full.minY;
  const m = itemMatrix(item);
  const inv = invert(m);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.max(1, Math.round(W * scale * dpr));
    cv.height = Math.max(1, Math.round(H * scale * dpr));
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (image) ctx.drawImage(image, 0, 0, cv.width, cv.height);
    else {
      ctx.fillStyle = '#ecebe7';
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
  }, [image, W, H, scale]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onDone(crop);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [crop, onCancel, onDone]);

  const down = (handle: CropHandle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = { pointerId: e.pointerId, handle, sx: e.clientX, sy: e.clientY, start: crop };
  };
  const move = (e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // Screen movement into the photo's own (unturned, unmirrored) frame, then into fractions of it.
    const dx = (e.clientX - d.sx) / scale, dy = (e.clientY - d.sy) / scale;
    const lx = inv[0] * dx + inv[2] * dy, ly = inv[1] * dx + inv[3] * dy;
    setCrop(dragCrop(d.start, d.handle, lx / W, ly / H));
  };
  const up = (e: React.PointerEvent) => {
    if (dragging.current?.pointerId === e.pointerId) dragging.current = null;
  };

  const b = itemBounds(item);
  const shown = transformBounds(full, m);
  const css = `matrix(${m[0]}, ${m[1]}, ${m[2]}, ${m[3]}, ${m[4] * scale}, ${m[5] * scale})`;
  const px = (v: number) => v * scale;
  return (
    <>
      <div className="crop-layer" data-no-gesture style={{ transform: css }} onPointerDown={(e) => e.stopPropagation()}>
        <canvas ref={canvasRef} className="crop-image" style={{ left: px(full.minX), top: px(full.minY), width: px(W), height: px(H) }} />
        <div
          className="crop-rect"
          style={{ left: px(full.minX + crop.x * W), top: px(full.minY + crop.y * H), width: px(crop.w * W), height: px(crop.h * H) }}
          onPointerDown={down('move')}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          {HANDLES.map((h) => (
            <div key={h} className={`crop-handle ${h}`} aria-label={`Crop ${h}`} onPointerDown={down(h)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          ))}
        </div>
      </div>
      <div className="selection-menu crop-menu" data-no-gesture style={{ left: px(Math.min(b.minX, shown.minX)), top: px(Math.max(b.maxY, shown.maxY)) + 16 }} onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={() => setCrop(FULL_CROP)}>Reset</button>
        <button className="primary" onClick={() => onDone(crop)}>
          Done
        </button>
      </div>
    </>
  );
}
