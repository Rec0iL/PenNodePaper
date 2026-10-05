import { FLOORS, type MapDoc } from './mapdata.js';

// ---------------------------------------------------------------------------
// Two-step map painting, the pure part: which props belong together (a row of
// tables is ONE long table), where the model gets to paint (crop windows) and
// the mask shapes that decide where. Shared so the editor can show the groups.
// ---------------------------------------------------------------------------

type Prop = MapDoc['props'][number];

/** Centre-based rectangle in cell units. */
export interface PropRect { cx: number; cy: number; w: number; h: number; rot: number }
export interface Extent { x0: number; y0: number; x1: number; y1: number }

export interface PropGroup {
  id: string;
  kind: string;
  props: Prop[];
  rects: PropRect[];
  bbox: Extent;
  round: boolean;
}

/** Props that read as a round object from above. */
export const ROUND_PROPS: ReadonlySet<string> = new Set(['barrel', 'pillar', 'well', 'tree', 'campfire', 'fountain', 'cauldron', 'statue']);
/** Individual things: when several touch, the mask keeps them apart so the model paints the right COUNT (a row of 5 barrels, not 3 big ones). */
export const DISCRETE_PROPS: ReadonlySet<string> = new Set(['barrel', 'chair', 'pillar', 'statue', 'tree', 'rock', 'cauldron', 'chest', 'crate', 'trap']);

export function rectOf(p: Prop): PropRect {
  const w = p.w ?? 1, h = p.h ?? 1;
  return { cx: p.x + w / 2, cy: p.y + h / 2, w, h, rot: p.rot ?? 0 };
}

/** Axis-aligned extent of a (possibly quarter-turn rotated) rectangle. */
export function extentOf(r: PropRect): Extent {
  const q = Math.round(r.rot / 90) % 2 !== 0;
  const w = q ? r.h : r.w, h = q ? r.w : r.h;
  return { x0: r.cx - w / 2, y0: r.cy - h / 2, x1: r.cx + w / 2, y1: r.cy + h / 2 };
}

const touch = (a: Extent, b: Extent, tol = 0.1) => a.x0 <= b.x1 + tol && b.x0 <= a.x1 + tol && a.y0 <= b.y1 + tol && b.y0 <= a.y1 + tol;
const area = (e: Extent) => (e.x1 - e.x0) * (e.y1 - e.y0);

/** Merge touching props of the same kind into one group; big groups first (tables before the chairs that stand at them). Ids are g1, g2, … */
export function groupProps(m: Pick<MapDoc, 'props'>): PropGroup[] {
  const props = m.props;
  const ext = props.map((p) => extentOf(rectOf(p)));
  const parent = props.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < props.length; i++)
    for (let j = i + 1; j < props.length; j++) if (props[i].kind === props[j].kind && touch(ext[i], ext[j])) parent[find(i)] = find(j);
  const by = new Map<number, number[]>();
  props.forEach((_, i) => {
    const r = find(i);
    by.set(r, [...(by.get(r) ?? []), i]);
  });
  const groups = [...by.values()].map((idx) => {
    const ps = idx.map((i) => props[i]);
    const es = idx.map((i) => ext[i]);
    const bbox = { x0: Math.min(...es.map((e) => e.x0)), y0: Math.min(...es.map((e) => e.y0)), x1: Math.max(...es.map((e) => e.x1)), y1: Math.max(...es.map((e) => e.y1)) };
    return { kind: ps[0].kind as string, props: ps, rects: ps.map(rectOf), bbox, round: ROUND_PROPS.has(ps[0].kind) };
  });
  return groups.sort((a, b) => area(b.bbox) - area(a.bbox)).map((g, i) => ({ ...g, id: `g${i + 1}` }));
}

/** What the AI is told about each group when it writes the painting prompts. */
export interface GroupInfo {
  id: string;
  kind: string;
  count: number;
  extentCells: string;
  extentFeet: string;
  floorUnder: string;
  position: string;
  editorLabel?: string;
}

export function describeGroups(m: MapDoc, groups: PropGroup[] = groupProps(m)): GroupInfo[] {
  const floorAt = (x: number, y: number) => {
    const row = m.rows[Math.max(0, Math.min(m.grid.rows - 1, Math.floor(y)))] ?? '';
    const ch = row[Math.max(0, Math.min(m.grid.cols - 1, Math.floor(x)))] ?? '.';
    return ch === '.' ? 'outside' : (FLOORS as Record<string, { name: string }>)[ch]?.name ?? 'floor';
  };
  return groups.map((g) => {
    const bw = g.bbox.x1 - g.bbox.x0, bh = g.bbox.y1 - g.bbox.y0;
    const cx = (g.bbox.x0 + g.bbox.x1) / 2, cy = (g.bbox.y0 + g.bbox.y1) / 2;
    const edges: string[] = [];
    if (floorAt(g.bbox.x0 + 0.1, g.bbox.y0 - 0.5) === 'outside') edges.push('north');
    if (floorAt(g.bbox.x0 + 0.1, g.bbox.y1 + 0.5) === 'outside') edges.push('south');
    if (floorAt(g.bbox.x0 - 0.5, g.bbox.y0 + 0.1) === 'outside') edges.push('west');
    if (floorAt(g.bbox.x1 + 0.5, g.bbox.y0 + 0.1) === 'outside') edges.push('east');
    return {
      id: g.id, kind: g.kind, count: g.props.length,
      extentCells: `${Math.round(bw)}x${Math.round(bh)}`,
      extentFeet: `${Math.round(bw * m.grid.unit)}x${Math.round(bh * m.grid.unit)} ft`,
      floorUnder: floorAt(cx, cy),
      position: edges.length ? `against the ${edges.join('/')} wall or edge` : 'free-standing',
      ...(g.props.find((p) => p.label)?.label ? { editorLabel: g.props.find((p) => p.label)!.label } : {}),
    };
  });
}

// ------------------------------- crop windows & masks --------------------------------------

/** A window of the map (image px) and the size the model works at (tw x th, multiples of 16). */
export interface Crop { x: number; y: number; w: number; h: number; tw: number; th: number }

/** Context window around a group: padded, snapped to the latent grid, scaled so small objects get a decent resolution. */
export function cropFor(g: Pick<PropGroup, 'bbox'>, cell: number, W: number, H: number, opts: { pad?: number; target?: number } = {}): Crop {
  const pad = opts.pad ?? 2.2; // cells of context around the group
  const target = opts.target ?? 768;
  let x0 = (g.bbox.x0 - pad) * cell, y0 = (g.bbox.y0 - pad) * cell, x1 = (g.bbox.x1 + pad) * cell, y1 = (g.bbox.y1 + pad) * cell;
  const minSide = 6 * cell;
  if (x1 - x0 < minSide) { const c = (x0 + x1) / 2; x0 = c - minSide / 2; x1 = c + minSide / 2; }
  if (y1 - y0 < minSide) { const c = (y0 + y1) / 2; y0 = c - minSide / 2; y1 = c + minSide / 2; }
  const w = Math.min(W, Math.ceil((x1 - x0) / 16) * 16), h = Math.min(H, Math.ceil((y1 - y0) / 16) * 16);
  let x = Math.round(((x0 + x1) / 2 - w / 2) / 16) * 16, y = Math.round(((y0 + y1) / 2 - h / 2) / 16) * 16;
  x = Math.max(0, Math.min(W - w, x));
  y = Math.max(0, Math.min(H - h, y));
  const s = target / Math.max(w, h);
  const tw = Math.max(256, Math.round((w * s) / 16) * 16), th = Math.max(256, Math.round((h * s) / 16) * 16);
  return { x, y, w, h, tw, th };
}

/** How far the paint mask reaches around a prop (in cells), and how items in a row are kept apart. */
export const MASK = { grow: 0.16, composeGrow: 0.1, blur: 0.06, gap: 0.03 };

const shapeSvg = (r: PropRect, round: boolean, cell: number, grow: number) => {
  const w = r.w * cell + grow * 2, h = r.h * cell + grow * 2;
  const inner = round
    ? `<ellipse cx="0" cy="0" rx="${w / 2}" ry="${h / 2}" fill="#fff"/>`
    : `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${Math.min(w, h) * 0.12}" fill="#fff"/>`;
  return `<g transform="translate(${r.cx * cell} ${r.cy * cell}) rotate(${r.rot})">${inner}</g>`;
};

/**
 * A group's mask as SVG (white = paint here), cropped by viewBox to `c` and sized (outW x outH).
 * `grow` / `blur` are in cells; a negative grow shrinks each item so touching items stay separate blobs.
 */
export function maskSvg(g: Pick<PropGroup, 'rects' | 'round'>, c: Crop, cell: number, grow: number, blur: number, out: { w: number; h: number }): string {
  const shapes = g.rects.map((r) => shapeSvg(r, g.round, cell, grow * cell)).join('');
  const filter = blur > 0 ? `<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur * cell}"/></filter>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${out.w}" height="${out.h}" viewBox="${c.x} ${c.y} ${c.w} ${c.h}"><defs>${filter}</defs><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="#000"/><g ${blur > 0 ? 'filter="url(#b)"' : ''}>${shapes}</g></svg>`;
}

/** The two masks a group needs: what the model repaints (sampling) and what is blended back into the picture (compose). */
export function groupMasks(g: PropGroup, c: Crop, cell: number): { sample: string; compose: string } {
  const separate = DISCRETE_PROPS.has(g.kind) && g.props.length > 1;
  return {
    sample: maskSvg(g, c, cell, separate ? -MASK.gap : MASK.grow, 0, { w: c.tw, h: c.th }),
    compose: maskSvg(g, c, cell, separate ? 0.02 : MASK.composeGrow, MASK.blur, { w: c.w, h: c.h }),
  };
}
