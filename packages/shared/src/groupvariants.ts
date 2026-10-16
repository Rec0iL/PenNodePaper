import type { GroupVariant, GroupVariants, MapDoc } from './mapdata.js';
import { cropFor, groupProps, propShapeSvg, type PropGroup } from './mapgroups.js';
import { imageSize } from './maps.js';
import { groupRegion, shapeMarkup, type RegionGroup } from './regiongroups.js';

// ---------------------------------------------------------------------------
// Every painting of a prop / structure group is kept, so a group that is painted again does not lose its earlier looks and the
// GM can bring an older one back. A group is found again by its signature (what it is and where), not by its id: g1, g2…
// change when the plan changes, a moved group is a new group.
// ---------------------------------------------------------------------------

export type AnyGroup = PropGroup | RegionGroup;

/** The groups step 2 paints, of either kind of map. */
export const groupsOfMap = (m: MapDoc): AnyGroup[] => (m.kind === 'region' ? groupRegion(m) : groupProps(m));

/** Kind and place of a group (battle maps in half cells, region maps in 4 px steps). */
export function groupSig(m: Pick<MapDoc, 'kind'>, g: Pick<AnyGroup, 'kind' | 'bbox'>): string {
  const r = (v: number) => (m.kind === 'region' ? Math.round(v / 4) * 4 : Math.round(v * 2) / 2);
  return `${g.kind}@${r(g.bbox.x0)},${r(g.bbox.y0)},${r(g.bbox.x1)},${r(g.bbox.y1)}`;
}

/** The paintings of a group (none until it has been painted since the paintings are recorded). */
export function variantsOf(m: MapDoc, g: AnyGroup): GroupVariants | undefined {
  const v = m.groupVariants?.[groupSig(m, g)];
  return v && v.kind === g.kind ? v : undefined;
}

/** Note a painting of a group: `file` is the finished picture that has it. Returns the new variant. */
export function recordVariant(m: MapDoc, g: AnyGroup, v: Omit<GroupVariant, 'id' | 'at'> & { at?: string }): GroupVariant {
  const sig = groupSig(m, g);
  const all = (m.groupVariants ??= {});
  const cur = all[sig] && all[sig].kind === g.kind ? all[sig] : (all[sig] = { kind: g.kind, variants: [] });
  const variant: GroupVariant = { id: `v${cur.variants.length + 1}-${Math.random().toString(36).slice(2, 6)}`, at: v.at ?? new Date().toISOString(), ...v };
  cur.variants.push(variant);
  cur.pick = variant.id;
  return variant;
}

/** The part of the picture (image px) that shows a group, with some room around it: what the editor shows as its preview. */
export function groupWindow(m: MapDoc, g: AnyGroup): { x: number; y: number; w: number; h: number } {
  const { w: W, h: H, cell } = imageSize(m);
  if (m.kind === 'battle') {
    const c = cropFor(g as PropGroup, cell, W, H, { pad: 1.2 });
    return { x: c.x, y: c.y, w: c.w, h: c.h };
  }
  const bw = g.bbox.x1 - g.bbox.x0, bh = g.bbox.y1 - g.bbox.y0;
  const side = Math.max(160, Math.max(bw, bh) * 1.6);
  const cx = (g.bbox.x0 + g.bbox.x1) / 2, cy = (g.bbox.y0 + g.bbox.y1) / 2;
  const w = Math.min(W, side), h = Math.min(H, side);
  return { x: Math.max(0, Math.min(W - w, cx - w / 2)), y: Math.max(0, Math.min(H - h, cy - h / 2)), w, h };
}

/**
 * Where an older painting of a group is taken from the picture it is in: the group and a little around it (the same shape the
 * blend pass repaints around it), softly faded. `defs` + `body` go into a <mask> (white = take from the older picture).
 */
export function swapMaskParts(m: MapDoc, groupId: string): { w: number; h: number; defs: string; body: string } | null {
  const { w, h, cell } = imageSize(m);
  let halo = '', blur = 0;
  if (m.kind === 'battle') {
    const g = groupProps(m).find((x) => x.id === groupId);
    if (!g) return null;
    halo = g.rects.map((r) => propShapeSvg(r, g.round, cell, 0.32 * cell)).join('');
    blur = 0.1 * cell;
  } else {
    const g = groupRegion(m).find((x) => x.id === groupId);
    if (!g) return null;
    halo = g.shapes.map((s) => shapeMarkup(s, 26, m.kinds)).join('');
    blur = 7;
  }
  return {
    w, h,
    defs: `<filter id="sw" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${blur}"/></filter>`,
    body: `<rect width="${w}" height="${h}" fill="#000"/><g filter="url(#sw)">${halo}</g>`,
  };
}
