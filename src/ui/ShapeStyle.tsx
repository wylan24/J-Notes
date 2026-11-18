import type { ArrowEnds, DashStyle, ItemPatch, LineItem, ShapeItem } from '../core/model';
import { ROUND_RADIUS } from '../core/shapeItems';

/** Pale fills, so a shape's outline and anything written in it stay readable. */
export const FILL_COLORS = ['#fdf0a6', '#cfe1ff', '#ffd2cc', '#c9efd3', '#e6d6ff', '#eeeeee'];

const DASHES: { dash: DashStyle; label: string }[] = [
  { dash: 'solid', label: 'Solid' },
  { dash: 'dashed', label: 'Dashed' },
  { dash: 'dotted', label: 'Dotted' },
];
const ARROWS: { arrow: ArrowEnds | undefined; label: string; glyph: string }[] = [
  { arrow: undefined, label: 'No arrowheads', glyph: '—' },
  { arrow: 'end', label: 'Arrowhead at the end', glyph: '→' },
  { arrow: 'both', label: 'Arrowheads at both ends', glyph: '↔' },
];

/** The "no fill" swatch: white with a red slash. */
export function NoFillSwatch() {
  return <span className="swatch no-fill" />;
}

interface Props {
  item: ShapeItem | LineItem;
  colors: string[];
  onRecolor: (c: string) => void;
  onPatch: (patch: ItemPatch) => void;
}

/** Style controls for one selected shape or line: outline colour, fill, corners, arrowheads, line style. */
export function ShapeStyleRow({ item, colors, onRecolor, onPatch }: Props) {
  const dash = item.dash ?? 'solid';
  const nextDash = DASHES[(DASHES.findIndex((d) => d.dash === dash) + 1) % DASHES.length];
  return (
    <>
      {colors.map((c) => (
        <button key={c} className={`swatch-btn ${item.color === c ? 'active' : ''}`} aria-label={`Outline ${c}`} onClick={() => onRecolor(c)}>
          <span className="swatch" style={{ background: c }} />
        </button>
      ))}
      <span className="divider" />
      <button title={`Line style: ${DASHES.find((d) => d.dash === dash)!.label}`} aria-label={`Line style ${dash}, change to ${nextDash.label}`} onClick={() => onPatch({ dash: nextDash.dash === 'solid' ? undefined : nextDash.dash })}>
        {dash === 'solid' ? '───' : dash === 'dashed' ? '─ ─' : '···'}
      </button>
      {item.kind === 'line' ? (
        ARROWS.map((a) => (
          <button key={a.label} className={item.arrow === a.arrow ? 'active' : ''} aria-pressed={item.arrow === a.arrow} aria-label={a.label} title={a.label} onClick={() => onPatch({ arrow: a.arrow })}>
            {a.glyph}
          </button>
        ))
      ) : (
        <>
          {item.shape === 'rect' && (
            <button title="Corners" aria-pressed={!!item.radius} onClick={() => onPatch({ radius: item.radius ? undefined : ROUND_RADIUS })}>
              {item.radius ? 'Rounded' : 'Square'}
            </button>
          )}
          <span className="divider" />
          <button className={`swatch-btn ${!item.fill ? 'active' : ''}`} aria-label="No fill" title="No fill" onClick={() => onPatch({ fill: undefined })}>
            <NoFillSwatch />
          </button>
          {FILL_COLORS.map((c) => (
            <button key={c} className={`swatch-btn ${item.fill === c ? 'active' : ''}`} aria-label={`Fill ${c}`} onClick={() => onPatch({ fill: c })}>
              <span className="swatch" style={{ background: c }} />
            </button>
          ))}
        </>
      )}
    </>
  );
}
