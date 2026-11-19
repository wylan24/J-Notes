// Export pages as a PDF with pdf-lib (loaded on first use). PDF pages are copied from the
// original file, so their text stays selectable; everything drawn on them is added as vectors:
// ink as filled outlines, templates as lines, text as real text. Layers match the screen:
// background, template, images and text boxes, highlighter, pen, sticky notes.
import type { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import { itemRect, LINE_HEIGHT, STICKY_ICON, STICKY_PAD, STICKY_TEXT_SIZE, TEXT_PAD, textLines, wrapLines } from '../core/items';
import { bulletShape, layoutRich, markerPlace } from '../core/richText';
import { pagePaper, pageSize, type RichBlock, type NotebookDoc, type Page, type PageItem, type Stroke } from '../core/model';
import { hexToRgb, placement, type Placement } from '../core/pdfPlacement';
import { templateLayout } from '../core/templates';
import { HIGHLIGHTER_ALPHA, steadied, strokeSvgPath } from '../render/stroke';
import { isOverItem, LINK_COLOR, shapeInk } from '../render/items';
import { fullImageBox, itemMatrix } from '../core/imageEdit';
import { invert, isIdentity, multiply, type Matrix } from '../core/transform';
import { LINK_PAD, LINK_TEXT_SIZE } from '../core/links';
import { dabsByLevel, pencilAlpha, pencilDabs, type Dab } from '../core/pencil';
import { PAPER_STYLES } from '../render/page';
import { getBlob } from '../storage/db';
import { contentByLayer } from '../core/layers';

export interface PdfExportOptions {
  /** 0-based indices of the pages to export, in order. */
  pages: number[];
  /** Include PDF pages, template images, paper colour and template lines. Off exports content only. */
  background: boolean;
}

type PdfLib = typeof import('pdf-lib');

export async function exportPdf(doc: NotebookDoc, docId: string, title: string, opts: PdfExportOptions): Promise<Uint8Array> {
  const lib: PdfLib = await import('pdf-lib');
  const out = await lib.PDFDocument.create();
  out.setTitle(title);
  out.setCreator('J Notes');
  out.setProducer('J Notes');
  const ctx = new ExportContext(lib, out, docId);
  for (const index of opts.pages) {
    const page = doc.pages[index];
    if (page) await ctx.addPage(page, opts.background);
  }
  return out.save();
}

class ExportContext {
  private sources = new Map<string, Promise<PDFDocument>>();
  private images = new Map<string, Promise<PDFImage | null>>();
  private fonts = new Map<string, Promise<PDFFont>>();

  constructor(
    private lib: PdfLib,
    private out: PDFDocument,
    private docId: string,
  ) {}

  async addPage(page: Page, withBackground: boolean): Promise<void> {
    const size = pageSize(page);
    const bg = page.background;
    let target: PDFPage;
    let place: Placement;
    if (withBackground && bg?.kind === 'pdf') {
      // Copy the original page: text, vectors and fonts survive untouched.
      const src = await this.source(bg.blobId);
      const [copied] = await this.out.copyPages(src, [bg.pageIndex]);
      target = this.out.addPage(copied);
      place = placement(target.getCropBox(), target.getRotation().angle);
    } else {
      target = this.out.addPage([size.w * 0.75, size.h * 0.75]);
      place = placement({ x: 0, y: 0, width: size.w * 0.75, height: size.h * 0.75 }, 0);
    }
    const draw = new PageDrawer(this.lib, target, place);

    if (withBackground && bg?.kind !== 'pdf') {
      const colors = PAPER_STYLES[pagePaper(page)];
      draw.rect(0, 0, size.w, size.h, colors.fill);
      if (bg?.kind === 'image') {
        const img = await this.image(bg.blobId);
        if (img) {
          const k = Math.min(size.w / img.width, size.h / img.height);
          draw.image(img, (size.w - img.width * k) / 2, (size.h - img.height * k) / 2, img.width * k, img.height * k);
        }
      }
      const { lines, dots, labels } = templateLayout(page.template, size);
      for (const l of lines) draw.line(l.x1, l.y1, l.x2, l.y2, colors[l.tone]);
      for (const d of dots) draw.rect(d.x - 1, d.y - 1, 2, 2, colors.dot);
      if (labels.length) {
        const font = await this.font('sans', true);
        for (const l of labels) draw.text(l.text, l.x, l.y, 12, font, colors.label);
      }
    }

    // Shown layers, bottom to top, each layered like the page on screen.
    for (const { strokes, items } of contentByLayer(page)) {
      for (const it of items) if (!isOverItem(it)) await draw.within(it, () => this.item(draw, it));
      for (const tool of ['highlighter', 'pen'] as const) for (const s of strokes) if (s.tool === tool) draw.stroke(s);
      for (const it of items) if (isOverItem(it)) await draw.within(it, () => this.item(draw, it));
    }
  }

  private async item(draw: PageDrawer, it: PageItem): Promise<void> {
    if (it.kind === 'image') {
      const img = await this.image(it.blobId);
      // A cropped photo is the whole image placed so the crop fills the box, clipped to the box (see `within`).
      const full = fullImageBox(it);
      if (img) draw.image(img, full.minX, full.minY, full.maxX - full.minX, full.maxY - full.minY);
      else draw.rect(it.x, it.y, it.w, it.h, '#ecebe7');
      return;
    }
    if (it.kind === 'text' && it.rich) {
      await this.richText(draw, it.rich, it.x + TEXT_PAD, it.y + TEXT_PAD, it.w - 2 * TEXT_PAD, it.size, it.font, it.color, Infinity);
      return;
    }
    if (it.kind === 'text') {
      const font = await this.font(it.font, false);
      const fit = encodable(font);
      const lines = textLines(it, (s) => font.widthOfTextAtSize(fit(s), it.size));
      draw.textLines(lines.map(fit), it.x + TEXT_PAD, it.y + TEXT_PAD, it.size, font, it.color);
      return;
    }
    if (it.kind === 'link') {
      // A visible link keeps its blue underlined label; a hotspot over other content adds nothing visible.
      if (!it.label) return;
      const font = await this.font('sans', false);
      const fit = encodable(font);
      draw.textLines([fit(it.label)], it.x + LINK_PAD, it.y + it.h / 2 - (LINK_TEXT_SIZE * LINE_HEIGHT) / 2, LINK_TEXT_SIZE, font, LINK_COLOR);
      return;
    }
    // Shapes and lines: the fill, then the outline as the same vector ink the pen exports.
    if (it.kind === 'shape' || it.kind === 'line') {
      const { fill, strokes } = shapeInk(it);
      if (fill && it.kind === 'shape' && it.fill) draw.polygon(fill, it.fill);
      for (const s of strokes) draw.stroke(s);
      return;
    }
    // Tape exports covering what is under it, as on the page.
    if (it.kind === 'tape') {
      draw.rect(it.x, it.y, it.w, it.h, it.color);
      return;
    }
    // Sticky note.
    if (it.collapsed) {
      draw.rect(it.x, it.y, STICKY_ICON, STICKY_ICON, it.color);
      return;
    }
    draw.rect(it.x, it.y, it.w, it.h, it.color);
    if (it.rich) {
      await this.richText(draw, it.rich, it.x + STICKY_PAD, it.y + STICKY_PAD, it.w - 2 * STICKY_PAD, STICKY_TEXT_SIZE, 'sans', '#1d1d1f', it.h - 2 * STICKY_PAD);
      return;
    }
    const font = await this.font('sans', false);
    const fit = encodable(font);
    const lines = wrapLines(it.text, it.w - 2 * STICKY_PAD, (s) => font.widthOfTextAtSize(fit(s), STICKY_TEXT_SIZE));
    // Keep to the note's box, as the screen clips it.
    const max = Math.max(0, Math.floor((it.h - 2 * STICKY_PAD) / (STICKY_TEXT_SIZE * LINE_HEIGHT)));
    draw.textLines(lines.slice(0, max).map(fit), it.x + STICKY_PAD, it.y + STICKY_PAD, STICKY_TEXT_SIZE, font, '#1d1d1f');
  }

  /** Formatted text, laid out as on screen with the PDF fonts' widths; lines past `maxH` are left off. */
  private async richText(draw: PageDrawer, blocks: RichBlock[], x: number, y: number, w: number, size: number, family: string, color: string, maxH: number): Promise<void> {
    const fonts = await Promise.all([false, true].flatMap((b) => [false, true].map((i) => this.font(family, b, i))));
    const pick = (b?: boolean, i?: boolean) => fonts[(b ? 2 : 0) + (i ? 1 : 0)];
    const fits = fonts.map(encodable);
    const fit = (s: string, b?: boolean, i?: boolean) => fits[(b ? 2 : 0) + (i ? 1 : 0)](s);
    const lines = layoutRich(blocks, w, size, (s, b, i) => pick(b, i).widthOfTextAtSize(fit(s, b, i), size));
    const lh = size * LINE_HEIGHT;
    const shown = lines.slice(0, Math.max(0, Math.floor(maxH / lh)));
    shown.forEach((line, n) => {
      const top = y + n * lh;
      for (const p of line.pieces) if (p.hl) draw.rect(x + p.x, top, p.w, lh, p.hl);
      if (line.marker) {
        const shape = bulletShape(line.marker.text);
        const { cx, right, r } = markerPlace(line.marker, size);
        if (shape === 'square') draw.rect(x + cx - r, top + lh / 2 - r, 2 * r, 2 * r, color);
        else if (shape) draw.circle(x + cx, top + lh / 2, shape === 'circle' ? r * 0.85 : r, color, shape === 'disc');
        else {
          const label = fit(line.marker.text);
          draw.textLines([label], x + right - pick().widthOfTextAtSize(label, size), top, size, pick(), color);
        }
      }
      for (const p of line.pieces) draw.textLines([fit(p.text, p.b, p.i)], x + p.x, top, size, pick(p.b, p.i), color);
    });
  }

  private source(blobId: string): Promise<PDFDocument> {
    let p = this.sources.get(blobId);
    if (!p) {
      p = getBlob(this.docId, blobId).then((b) => {
        if (!b) throw new Error('The PDF this page comes from is missing');
        return this.lib.PDFDocument.load(b.bytes, { ignoreEncryption: true, updateMetadata: false });
      });
      this.sources.set(blobId, p);
    }
    return p;
  }

  /** Embed a stored image. PNG and JPEG go in as they are; other formats are converted to PNG first. */
  private image(blobId: string): Promise<PDFImage | null> {
    let p = this.images.get(blobId);
    if (!p) {
      p = (async () => {
        const b = await getBlob(this.docId, blobId);
        if (!b) return null;
        try {
          if (b.type === 'image/png') return await this.out.embedPng(b.bytes);
          if (b.type === 'image/jpeg' || b.type === 'image/jpg') return await this.out.embedJpg(b.bytes);
          return await this.out.embedPng(await toPng(b.bytes, b.type));
        } catch (e) {
          console.error('Could not embed image', e);
          return null;
        }
      })();
      this.images.set(blobId, p);
    }
    return p;
  }

  /** The standard PDF font closest to an app font. Standard fonts need no embedding but only cover Latin text. */
  private font(key: string, bold: boolean, italic = false): Promise<PDFFont> {
    const F = this.lib.StandardFonts;
    const name =
      key === 'serif'
        ? italic
          ? bold ? F.TimesRomanBoldItalic : F.TimesRomanItalic
          : bold ? F.TimesRomanBold : F.TimesRoman
        : key === 'mono'
          ? italic
            ? bold ? F.CourierBoldOblique : F.CourierOblique
            : bold ? F.CourierBold : F.Courier
          : italic
            ? bold ? F.HelveticaBoldOblique : F.HelveticaOblique
            : bold ? F.HelveticaBold : F.Helvetica;
    let p = this.fonts.get(name);
    if (!p) {
      p = this.out.embedFont(name);
      this.fonts.set(name, p);
    }
    return p;
  }
}

/** Replace characters a standard font can't encode, so one emoji doesn't fail the whole export. */
function encodable(font: PDFFont): (s: string) => string {
  const supported = new Set(font.getCharacterSet());
  return (s) => [...s].map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : '?')).join('');
}

async function toPng(bytes: ArrayBuffer, type: string): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('could not convert image');
  return blob.arrayBuffer();
}

/** A pencil stroke's dabs at one opacity level, as one SVG path of circles. */
function dabsPath(dabs: readonly Dab[]): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  return dabs.map((d) => `M${f(d.x - d.r)} ${f(d.y)}a${f(d.r)} ${f(d.r)} 0 1 0 ${f(2 * d.r)} 0a${f(d.r)} ${f(d.r)} 0 1 0 ${f(-2 * d.r)} 0Z`).join('');
}

/** Draws in page units (top-left origin) onto a PDF page through a placement. */
class PageDrawer {
  constructor(
    private lib: PdfLib,
    private page: PDFPage,
    private place: Placement,
  ) {}

  private color(hex: string) {
    const [r, g, b] = hexToRgb(hex);
    return this.lib.rgb(r, g, b);
  }

  private get rotate() {
    return this.lib.degrees(this.place.rotate);
  }

  /** A box given by its top-left corner; pdf-lib anchors boxes at their bottom-left. */
  rect(x: number, y: number, w: number, h: number, color: string): void {
    const [px, py] = this.place.at(x, y + h);
    this.page.drawRectangle({ x: px, y: py, width: w * this.place.s, height: h * this.place.s, rotate: this.rotate, color: this.color(color) });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const [ax, ay] = this.place.at(x1, y1);
    const [bx, by] = this.place.at(x2, y2);
    this.page.drawLine({ start: { x: ax, y: ay }, end: { x: bx, y: by }, thickness: this.place.s, color: this.color(color) });
  }

  /**
   * Draw an item's content under its rotation and mirroring, as on screen; a cropped photo is also
   * clipped to its box.
   */
  async within(it: PageItem, paint: () => Promise<void>): Promise<void> {
    const m = itemMatrix(it);
    const crop = it.kind === 'image' && !!it.crop;
    if (isIdentity(m) && !crop) return paint();
    const L = this.lib;
    // The page-unit transform conjugated into PDF space: placement ∘ m ∘ placement⁻¹.
    const [ox, oy] = this.place.at(0, 0);
    const [ax, ay] = this.place.at(1, 0);
    const [bx, by] = this.place.at(0, 1);
    const P: Matrix = [ax - ox, ay - oy, bx - ox, by - oy, ox, oy];
    const M = multiply(multiply(P, m), invert(P));
    const ops = [L.pushGraphicsState(), L.concatTransformationMatrix(...M)];
    if (crop) {
      const r = itemRect(it);
      const corners = [this.place.at(r.minX, r.minY), this.place.at(r.maxX, r.minY), this.place.at(r.maxX, r.maxY), this.place.at(r.minX, r.maxY)];
      ops.push(L.moveTo(...corners[0]), ...corners.slice(1).map((c) => L.lineTo(...c)), L.closePath(), L.clip(), L.endPath());
    }
    this.page.pushOperators(...ops);
    try {
      await paint();
    } finally {
      this.page.pushOperators(L.popGraphicsState());
    }
  }

  /** A dot (filled) or ring, centred at (cx, cy), in page units. */
  circle(cx: number, cy: number, r: number, color: string, filled: boolean): void {
    const [x, y] = this.place.at(cx, cy);
    const c = this.color(color);
    const rr = r * this.place.s;
    this.page.drawEllipse({ x, y, xScale: rr, yScale: rr, ...(filled ? { color: c } : { borderColor: c, borderWidth: rr * 0.35 }) });
  }

  /** A filled polygon, in page units. */
  polygon(pts: readonly { x: number; y: number }[], color: string): void {
    if (pts.length < 3) return;
    const f = (n: number) => Math.round(n * 100) / 100;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + 'Z';
    const [x, y] = this.place.at(0, 0);
    this.page.drawSvgPath(d, { x, y, scale: this.place.s, rotate: this.rotate, color: this.color(color) });
  }

  image(img: PDFImage, x: number, y: number, w: number, h: number): void {
    const [px, py] = this.place.at(x, y + h);
    this.page.drawImage(img, { x: px, y: py, width: w * this.place.s, height: h * this.place.s, rotate: this.rotate });
  }

  /** Text whose alphabetic baseline is at (x, y). */
  text(text: string, x: number, y: number, size: number, font: PDFFont, color: string): void {
    if (!text) return;
    const [px, py] = this.place.at(x, y);
    this.page.drawText(text, { x: px, y: py, size: size * this.place.s, font, color: this.color(color), rotate: this.rotate });
  }

  /** Lines laid out as on screen: each centred in its line box (the canvas uses a middle baseline). */
  textLines(lines: string[], x: number, y: number, size: number, font: PDFFont, color: string): void {
    const lh = size * LINE_HEIGHT;
    // Distance from the middle of the line to the baseline: half the font's cap height.
    const toBaseline = (font.heightAtSize(size, { descender: false }) / 2) * 0.9;
    lines.forEach((line, i) => this.text(line, x, y + (i + 0.5) * lh + toBaseline, size, font, color));
  }

  stroke(s: Stroke): void {
    if (s.tool === 'pen' && s.penStyle === 'pencil') return this.pencil(s);
    const d = strokeSvgPath(s);
    if (!d) return;
    const [x, y] = this.place.at(0, 0);
    const highlighter = s.tool === 'highlighter';
    this.page.drawSvgPath(d, {
      x,
      y,
      scale: this.place.s,
      rotate: this.rotate,
      color: this.color(s.color),
      opacity: highlighter ? HIGHLIGHTER_ALPHA : 1,
      blendMode: highlighter ? this.lib.BlendMode.Multiply : undefined,
    });
  }

  /** Pencil: its dabs as vector circles, one path per opacity level, so pressure survives (the grain doesn't). */
  private pencil(s: Stroke): void {
    const [x, y] = this.place.at(0, 0);
    for (const [level, dabs] of dabsByLevel(pencilDabs(steadied(s.points, s), s.width, s.simulatePressure))) {
      this.page.drawSvgPath(dabsPath(dabs), { x, y, scale: this.place.s, rotate: this.rotate, color: this.color(s.color), opacity: pencilAlpha(level) });
    }
  }
}
