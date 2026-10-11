// The lettering engine of @pnp/shared needs real fonts (to measure text and to draw it) and the generated plate materials.
// The server serves both; this loads them once and tells the editor to redraw when they arrived.
import { FONT_FAMILY, LABEL_FONTS, estimateWidth, setLabelContext } from '@pnp/shared';

export const labelState = $state({ version: 0, fonts: false });

let started = false;
let textures = new Set<string>();
let canvas: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();

function measure(text: string, font: string, size: number): number {
  const key = `${font}\u0000${text}`;
  let w100 = widths.get(key);
  if (w100 === undefined) {
    canvas ??= document.createElement('canvas').getContext('2d');
    if (!canvas || !labelState.fonts) return estimateWidth(text, font, size);
    canvas.font = `100px "${FONT_FAMILY(font)}"`;
    w100 = canvas.measureText(text).width;
    widths.set(key, w100);
  }
  return (w100 * size) / 100;
}

/** Start loading fonts and materials (idempotent). The editor's drawing depends on `labelState.version`. */
export function initLabels() {
  if (started) return;
  started = true;
  setLabelContext({ measure, texture: (id) => (textures.has(id) ? `/api/label-textures/${id}.jpg` : undefined) });
  const fonts = LABEL_FONTS.map((id) => new FontFace(FONT_FAMILY(id), `url(/api/label-fonts/${id}.ttf)`));
  Promise.all(fonts.map((f) => f.load().then((ff) => document.fonts.add(ff)).catch(() => undefined))).then(() => {
    labelState.fonts = true;
    widths.clear();
    labelState.version++;
  });
  fetch('/api/label-textures')
    .then((r) => (r.ok ? r.json() : []))
    .then((ids: string[]) => {
      textures = new Set(ids);
      labelState.version++;
    })
    .catch(() => undefined);
}
