// How a picture is laid into a map's picture area (and how the map can be made to match the picture instead).
// Pure geometry: the map editor draws it on a canvas, the tests check it.

/** fit = the whole picture, proportions kept, bars at the sides; fill = covers the area, the overflow is cropped; stretch = squeezed to the area. */
export type FitMode = 'fit' | 'fill' | 'stretch';

export const FIT_MODES: { id: FitMode; label: string; hint: string }[] = [
  { id: 'fit', label: 'Fit', hint: 'The whole picture, proportions kept. If it is not the shape of the map there are empty bars at the sides.' },
  { id: 'fill', label: 'Fill', hint: 'Covers the whole map, proportions kept. What sticks out over the edge is cropped.' },
  { id: 'stretch', label: 'Stretch', hint: 'Squeezed to exactly the map. Nothing is lost, but a different shape is distorted.' },
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a picture of srcW×srcH is drawn inside an area of dstW×dstH (the area's top left is 0,0). */
export function fitRect(srcW: number, srcH: number, dstW: number, dstH: number, mode: FitMode): Rect {
  if (mode === 'stretch' || srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  const k = mode === 'fit' ? Math.min(dstW / srcW, dstH / srcH) : Math.max(dstW / srcW, dstH / srcH);
  const w = srcW * k;
  const h = srcH * k;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** A battle map's grid that has the picture's proportions: the given number of columns, rows follow (4–80 each, like the editor). */
export function gridForPicture(srcW: number, srcH: number, cols: number): { cols: number; rows: number } {
  const c = clamp(cols, 4, 80);
  return { cols: c, rows: clamp((c * srcH) / Math.max(1, srcW), 4, 80) };
}

/** A region map's canvas that has the picture's proportions at about the size the image model paints at (multiples of 16). */
export function sizeForPicture(srcW: number, srcH: number, area = 1344 * 768): { w: number; h: number } {
  const aspect = Math.max(0.1, srcW) / Math.max(0.1, srcH);
  const h = Math.sqrt(area / aspect);
  const to16 = (n: number) => clamp(Math.round(n / 16) * 16, 256, 2048);
  return { w: to16(h * aspect), h: to16(h) };
}
