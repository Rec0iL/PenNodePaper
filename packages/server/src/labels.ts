// Names printed on top of map pictures: fonts and materials for the lettering engine of @pnp/shared, and the printing itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { FONT_FAMILY, LABEL_FONTS, imageSize, lettersSvg, placeLabels, setLabelContext, type MapDoc } from '@pnp/shared';
import { imageDimensions } from './vtt.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = path.resolve(HERE, '../assets/fonts');
export const LABEL_ASSET_DIR = path.resolve(HERE, '../assets/labels');

const fontFile = (id: string) => path.join(FONT_DIR, `${path.basename(id)}.ttf`);
/** Every bundled label font (resvg does not scan the system's fonts). */
export const labelFontFiles = (): string[] => LABEL_FONTS.map(fontFile).filter((f) => fs.existsSync(f));

const widths = new Map<string, number>();
/** Width of a text in a label font, measured by resvg at 100 px and scaled (cached). */
function measure(text: string, font: string, size: number): number {
  const key = `${font}\u0000${text}`;
  let w100 = widths.get(key);
  if (w100 === undefined) {
    const file = fontFile(font);
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="300"><text x="0" y="200" font-family="${FONT_FAMILY(font)}" font-size="100" xml:space="preserve">${esc}</text></svg>`;
    try {
      const r = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: fs.existsSync(file) ? [file] : [] } });
      w100 = r.getBBox()?.width ?? text.length * 55;
    } catch {
      w100 = text.length * 55;
    }
    widths.set(key, w100);
  }
  return (w100 * size) / 100;
}

const mimeOf = (buf: Buffer) => (buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : 'image/webp');

const textures = new Map<string, string | undefined>();
/** A generated material as a data URL (so a PNG made by resvg carries it), or nothing when it was not made. */
function texture(id: string): string | undefined {
  if (!textures.has(id)) {
    const f = path.join(LABEL_ASSET_DIR, `${path.basename(id)}.jpg`);
    textures.set(id, fs.existsSync(f) ? `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}` : undefined);
  }
  return textures.get(id);
}

/** Hand the engine the real fonts and materials (call once at start-up; the tests call it too). */
export function installLabelContext() {
  setLabelContext({ measure, texture });
}

/**
 * The picture with the map's names printed on it, as a PNG. The picture itself is not touched.
 * `onlyShown`: names with show:false stay off (that is the printed picture).
 */
export function printNames(m: MapDoc, picture: Buffer): Buffer {
  installLabelContext();
  const dim = imageDimensions(picture) ?? imageSize(m);
  const g = imageSize(m);
  const placed = placeLabels(m, { W: g.w, H: g.h, cell: g.cell }, { measure, texture });
  const k = dim.w / g.w;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dim.w}" height="${dim.h}" viewBox="0 0 ${dim.w} ${dim.h}"><image href="data:${mimeOf(picture)};base64,${picture.toString('base64')}" x="0" y="0" width="${dim.w}" height="${dim.h}"/><g transform="scale(${k} ${dim.h / g.h})">${lettersSvg(placed)}</g></svg>`;
  const r = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: labelFontFiles() } });
  return Buffer.from(r.render().asPng());
}

/** Names that would be printed (shown, with text): none = nothing to do. */
export function printableCount(m: MapDoc): number {
  const own = m.labels.filter((l) => l.text.trim() && l.show !== false).length;
  const shapes = m.kind === 'region' ? m.shapes.filter((s) => s.label?.trim() && s.labelShow !== false).length : 0;
  return own + shapes;
}
