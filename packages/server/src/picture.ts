import { execFileSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { fitRect, type FitMode } from '@pnp/shared';
import { imageDimensions, sniffImage } from './imagefile.js';

// Scaling a picture on the server (the browser does it for the GM's own imports; this is for what the AI does with a
// picture: making it a map's picture, a reference for the image model, or a smaller copy to look at). resvg draws
// PNG and JPEG; WebP goes through ImageMagick first, when it is installed.

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

/** PNG / JPEG bytes resvg can draw (a WebP is converted), with its size. */
function drawable(bytes: Buffer): { bytes: Buffer; mime: string; w: number; h: number } {
  let b = bytes;
  let ext = sniffImage(b);
  if (!ext) throw new Error('That is not a PNG, JPEG or WebP picture.');
  if (ext === 'webp') {
    try {
      b = execFileSync('magick', ['webp:-', 'png:-'], { input: b, maxBuffer: 256 * 1024 * 1024, timeout: 60_000 });
    } catch {
      throw new Error('This WebP picture cannot be converted here (ImageMagick is not installed). PNG and JPEG work.');
    }
    ext = 'png';
  }
  const dim = imageDimensions(b);
  if (!dim) throw new Error('The size of the picture cannot be read.');
  return { bytes: b, mime: MIME[ext], ...dim };
}

/** The picture drawn into exactly w×h px (fit = whole picture with bars, fill = cropped, stretch = squeezed), as a PNG. */
export function scalePicture(bytes: Buffer, w: number, h: number, mode: FitMode = 'stretch', bars = '#0b0d12'): Buffer {
  const p = drawable(bytes);
  const r = fitRect(p.w, p.h, w, h, mode);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${/^#[0-9a-f]{6}$/i.test(bars) ? bars : '#0b0d12'}"/>` +
    `<image href="data:${p.mime};base64,${p.bytes.toString('base64')}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" preserveAspectRatio="none"/></svg>`;
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'original' } }).render().asPng()); // no text: no fonts to load
}

/** A copy for an AI to look at: as it is when it is small enough, else scaled down to at most `max` px on the longer side. */
export function forViewing(bytes: Buffer, max = 1568): { data: string; mimeType: string; w: number; h: number } {
  const ext = sniffImage(bytes);
  const dim = ext ? imageDimensions(bytes) : null;
  if (!ext || !dim) throw new Error('That is not a PNG, JPEG or WebP picture.');
  if (Math.max(dim.w, dim.h) <= max && bytes.length <= 4_000_000) return { data: bytes.toString('base64'), mimeType: MIME[ext], ...dim };
  const k = max / Math.max(dim.w, dim.h);
  const w = Math.max(1, Math.round(dim.w * Math.min(1, k))), h = Math.max(1, Math.round(dim.h * Math.min(1, k)));
  return { data: scalePicture(bytes, w, h).toString('base64'), mimeType: 'image/png', w, h };
}
