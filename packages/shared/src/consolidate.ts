import type { MapDoc } from './mapdata.js';
import { groupProps, propShapeSvg } from './mapgroups.js';
import { groupRegion, shapeMarkup } from './regiongroups.js';
import { imageSize } from './maps.js';

// ---------------------------------------------------------------------------
// The last, optional painting step ("consolidate"): everything painted into the
// map in step 2 is surrounded by a ring; only the ring is repainted (low-ish
// noise, same model, whole picture), so shadows appear and objects blend into
// the ground while the objects themselves and the rest stay pixel-identical.
// Rated best on 11 pictures: narrow ring, denoise 0.70 (battle) / 0.80 (region).
// ---------------------------------------------------------------------------

/** Denoise of the ring pass per map kind (user ratings: region 0.80 = 5 stars everywhere, battle tavern degrades above 0.75). */
export const CONSOLIDATE_DENOISE = { battle: 0.7, region: 0.8 } as const;

/** The ring mask of a map as SVG at the size of its picture (white = repaint). Null when nothing was painted in step 2. */
export function ringMaskSvg(m: MapDoc): { svg: string; w: number; h: number } | null {
  const { w, h, cell } = imageSize(m);
  let halo = '', core = '', haloBlur = 0;
  if (m.kind === 'battle') {
    const groups = groupProps(m);
    if (!groups.length) return null;
    const grow = 0.32 * cell, hair = 0.02 * cell;
    halo = groups.flatMap((g) => g.rects.map((r) => propShapeSvg(r, g.round, cell, grow))).join('');
    core = groups.flatMap((g) => g.rects.map((r) => propShapeSvg(r, g.round, cell, hair, '#000'))).join('');
    haloBlur = 0.1 * cell;
  } else {
    const groups = groupRegion(m);
    if (!groups.length) return null;
    const shapes = groups.flatMap((g) => g.shapes);
    halo = shapes.map((s) => shapeMarkup(s, 26, m.kinds)).join('');
    core = shapes.map((s) => shapeMarkup(s, 1, m.kinds, '#000')).join('');
    haloBlur = 7;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><filter id="h" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${haloBlur}"/></filter><filter id="c"><feGaussianBlur stdDeviation="1.5"/></filter></defs><rect width="${w}" height="${h}" fill="#000"/><g filter="url(#h)">${halo}</g><g filter="url(#c)">${core}</g></svg>`;
  return { svg, w, h };
}

/** How the ring pass describes the picture to the model. */
export function consolidatePrompt(place: string, look: string): string {
  return `${place.trim().replace(/[.\s]+$/, '')}. ${look.replace(/[.\s]+$/, '')}. One coherent painting: the same lighting, colour palette and brush style everywhere, every object sits naturally on the ground with soft contact shadows, edges blend into their surroundings, no pasted-on look.`;
}
