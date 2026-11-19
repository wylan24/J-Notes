// The laser pointer's fading trail, drawn by the editor and mirrored in the presentation window.
import type { Vec } from '../core/geometry';

export const LASER_FADE_MS = 700;
export const LASER_COLOR = '#ff3b30';

export interface LaserPoint extends Vec {
  t: number;
}

/** Drop trail points older than the fade time (the trail is oldest first). */
export function pruneTrail(trail: LaserPoint[], now: number): void {
  while (trail.length && now - trail[0].t > LASER_FADE_MS) trail.shift();
}

/** A fading glowing trail; older segments are more transparent. */
export function paintLaser(ctx: CanvasRenderingContext2D, trail: LaserPoint[], now: number, scale: number, head: Vec | null) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = LASER_COLOR;
  ctx.shadowColor = LASER_COLOR;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 4 / scale;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    ctx.globalAlpha = Math.max(0, 1 - (now - b.t) / LASER_FADE_MS);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  if (head) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = LASER_COLOR;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 6 / scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(head.x, head.y, 2.5 / scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

