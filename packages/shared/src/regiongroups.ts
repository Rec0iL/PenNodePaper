import type { MapDoc } from './mapdata.js';
import type { Crop } from './mapgroups.js';
import { inStep2, regionKind } from './regionkinds.js';

// ---------------------------------------------------------------------------
// Step 2 of region painting, the pure part: which drawn shapes are painted
// together (touching shapes of one kind = one object), the windows the model
// works in and the masks that decide where. The masks follow the DRAWN geometry
// (a polygon, a blob, a line with its width), not a rectangle.
// ---------------------------------------------------------------------------

type Shape = MapDoc['shapes'][number];

export interface RegionExtent { x0: number; y0: number; x1: number; y1: number }

export interface RegionGroup {
  id: string;
  kind: string;
  shapes: Shape[];
  /** extent in canvas px (a line includes half its width) */
  bbox: RegionExtent;
}

const DEFAULT_PIN = 14;

type Kinds = MapDoc['kinds'];

/** The width a path is stroked with. */
export const strokeWidth = (s: Shape, kinds?: Kinds): number => s.width ?? regionKind(s.kind, kinds).width ?? 14;

/** Axis-aligned extent of a shape in canvas px. */
export function shapeExtent(s: Shape, kinds?: Kinds): RegionExtent {
  const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1]);
  if (s.type === 'ellipse') {
    const [cx, cy] = s.points[0] ?? [0, 0];
    const [rx, ry] = s.points[1] ?? [s.r ?? 30, s.r ?? 30];
    return { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry };
  }
  if (s.type === 'pin') {
    const [x, y] = s.points[0] ?? [0, 0];
    const r = (s.r ?? DEFAULT_PIN) + 1.5;
    return { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
  }
  const pad = s.type === 'path' ? strokeWidth(s, kinds) / 2 : 0;
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** Does the point lie inside the drawn shape (a path counts within half its width)? */
export function pointInShape(s: Shape, x: number, y: number, kinds?: Kinds): boolean {
  const p = s.points;
  if (s.type === 'pin') return Math.hypot(x - p[0][0], y - p[0][1]) <= (s.r ?? DEFAULT_PIN);
  if (s.type === 'ellipse') {
    const [cx, cy] = p[0];
    const [rx, ry] = p[1] ?? [s.r ?? 30, s.r ?? 30];
    return rx > 0 && ry > 0 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  }
  if (s.type === 'polygon') {
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const hw = strokeWidth(s, kinds) / 2;
  for (let i = 0; i + 1 < p.length; i++) if (distToSegment(x, y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) <= hw) return true;
  return false;
}

const touch = (a: RegionExtent, b: RegionExtent, tol: number) => a.x0 <= b.x1 + tol && b.x0 <= a.x1 + tol && a.y0 <= b.y1 + tol && b.y0 <= a.y1 + tol;
const area = (e: RegionExtent) => (e.x1 - e.x0) * (e.y1 - e.y0);

/** The shapes step 2 inpaints: the structures that are areas or spots (lines have their own pass). */
export function step2Shapes(m: Pick<MapDoc, 'shapes' | 'kinds'>): Shape[] {
  return m.shapes.filter((s) => s.type !== 'path' && inStep2(regionKind(s.kind, m.kinds)));
}

/**
 * Merge touching shapes of the same kind into one group (a cluster of huts = one village); big groups first.
 * Ids are g1, g2, … like the prop groups of battle maps.
 */
export function groupRegion(m: Pick<MapDoc, 'shapes' | 'kinds'>, tol = 6): RegionGroup[] {
  const shapes = step2Shapes(m);
  const ext = shapes.map((s) => shapeExtent(s, m.kinds));
  const parent = shapes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++) if (shapes[i].kind === shapes[j].kind && touch(ext[i], ext[j], tol)) parent[find(i)] = find(j);
  const by = new Map<number, number[]>();
  shapes.forEach((_, i) => {
    const r = find(i);
    by.set(r, [...(by.get(r) ?? []), i]);
  });
  const groups = [...by.values()].map((idx) => {
    const es = idx.map((i) => ext[i]);
    return {
      kind: shapes[idx[0]].kind,
      shapes: idx.map((i) => shapes[i]),
      bbox: { x0: Math.min(...es.map((e) => e.x0)), y0: Math.min(...es.map((e) => e.y0)), x1: Math.max(...es.map((e) => e.x1)), y1: Math.max(...es.map((e) => e.y1)) },
    };
  });
  return groups.sort((a, b) => area(b.bbox) - area(a.bbox)).map((g, i) => ({ ...g, id: `g${i + 1}` }));
}

// ------------------------------- what the AI is told -----------------------------------

export interface RegionGroupInfo {
  id: string;
  kind: string;
  kindName: string;
  /** what the kind looks like, from the catalogue / the GM's custom type */
  kindPrompt: string;
  count: number;
  /** names the GM gave the shapes (place names; never painted as text) */
  labels: string[];
  /** the GM's own wording for single shapes */
  shapePrompts: string[];
  sizePx: string;
  /** share of the canvas width, e.g. "4%" */
  share: string;
  /** terrain the group sits on */
  under: string;
  /** other terrain right around it (a harbour has the sea next to it) */
  nearby: string[];
  /** how many windows a long line is painted in */
  windows?: number;
}

/** Terrain at a point (topmost area terrain painted in step 1, else the background; lines are only ever "nearby"). */
export function terrainAt(m: Pick<MapDoc, 'shapes' | 'kinds' | 'background'>, x: number, y: number): string {
  for (let i = m.shapes.length - 1; i >= 0; i--) {
    const s = m.shapes[i];
    const k = regionKind(s.kind, m.kinds);
    if (k.layer === 'structure' || k.geometry === 'line') continue; // a road through a town is not what the town stands on; lines show up as "nearby"
    if (pointInShape(s, x, y, m.kinds)) return k.name.toLowerCase();
  }
  return regionKind(m.background ?? 'land', m.kinds).name.toLowerCase();
}

export function describeRegionGroups(m: MapDoc, groups: RegionGroup[] = groupRegion(m)): RegionGroupInfo[] {
  const { w: W } = m.size;
  return groups.map((g) => {
    const k = regionKind(g.kind, m.kinds);
    const bw = g.bbox.x1 - g.bbox.x0, bh = g.bbox.y1 - g.bbox.y0;
    const cx = (g.bbox.x0 + g.bbox.x1) / 2, cy = (g.bbox.y0 + g.bbox.y1) / 2;
    // for a line the centre of the box may be off the line: sample on the first shape's geometry instead
    const first = g.shapes[0];
    const [sx, sy] = first.type === 'path' || first.type === 'polygon' ? first.points[Math.floor(first.points.length / 2)] : [cx, cy];
    const under = terrainAt(m, g.shapes.length === 1 && first.type !== 'ellipse' ? sx : cx, g.shapes.length === 1 && first.type !== 'ellipse' ? sy : cy);
    const ring = Math.max(bw, bh) / 2 + 28;
    const near = new Set<string>();
    const lines = m.shapes.filter((s) => s.type === 'path' && regionKind(s.kind, m.kinds).geometry === 'line' && !g.shapes.includes(s));
    for (let a = 0; a < 8; a++) {
      const px = cx + Math.cos((a * Math.PI) / 4) * ring, py = cy + Math.sin((a * Math.PI) / 4) * ring;
      if (px < 0 || py < 0 || px > W || py > m.size.h) continue;
      const t = terrainAt(m, px, py);
      if (t !== under) near.add(t);
      for (const l of lines) if (pointInShape({ ...l, width: strokeWidth(l, m.kinds) + 44 }, px, py, m.kinds)) near.add(regionKind(l.kind, m.kinds).name.toLowerCase());
    }
    return {
      id: g.id, kind: g.kind, kindName: k.name.toLowerCase(), kindPrompt: k.prompt, count: g.shapes.length,
      labels: g.shapes.map((s) => s.label?.trim()).filter((x): x is string => !!x),
      shapePrompts: g.shapes.map((s) => s.prompt?.trim()).filter((x): x is string => !!x),
      sizePx: `${Math.round(bw)}x${Math.round(bh)}`,
      share: `${Math.max(1, Math.round((Math.max(bw, bh) / W) * 100))}%`,
      under, nearby: [...near].slice(0, 4),
    };
  });
}

/** The plain painting prompt of a group when the AI is not available (the GM's wording wins, then the kind's). */
export function fallbackRegionPrompt(g: Pick<RegionGroupInfo, 'kindPrompt' | 'shapePrompts' | 'count'>): string {
  const base = g.shapePrompts[0] ?? g.kindPrompt;
  return g.count > 1 && !g.shapePrompts.length ? `${base} (${g.count} of them close together)` : base;
}

// ------------------------------- windows & masks --------------------------------------

/** Px the paint mask reaches past a shape, past it for the blend back, and the feather of that blend. */
export const REGION_MASK = { grow: 5, composeGrow: 3, blur: 3 };

/** Windows longer than this are painted in several overlapping tiles (so a river keeps its resolution). */
const TILE = 576;
const TILE_STEP = 448;

const snap16 = (n: number) => Math.round(n / 16) * 16;
const up16 = (n: number) => Math.ceil(n / 16) * 16;

function windowAround(cx: number, cy: number, w: number, h: number, W: number, H: number, target: number): Crop {
  const cw = Math.min(W, up16(w)), ch = Math.min(H, up16(h));
  const x = Math.max(0, Math.min(W - cw, snap16(cx - cw / 2)));
  const y = Math.max(0, Math.min(H - ch, snap16(cy - ch / 2)));
  const s = target / Math.max(cw, ch);
  return { x, y, w: cw, h: ch, tw: Math.max(256, Math.round((cw * s) / 16) * 16), th: Math.max(256, Math.round((ch * s) / 16) * 16) };
}

/** Points along a path every `step` px (for deciding which tiles a long line really passes through). */
function samplePath(p: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 0; j < n; j++) out.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
  }
  if (p.length) out.push(p[p.length - 1]);
  return out;
}

/**
 * The windows (image px) the model paints a group in, each also given the size it works at (tw x th).
 * A compact group gets one window around it with context and a minimum size, scaled so small things get resolution;
 * a long one (a river across the map) is cut into overlapping tiles that only cover where its shapes really run.
 */
export function regionCrops(g: RegionGroup, W: number, H: number, opts: { target?: number; kinds?: Kinds } = {}): Crop[] {
  const target = opts.target ?? 768;
  const bw = g.bbox.x1 - g.bbox.x0, bh = g.bbox.y1 - g.bbox.y0;
  const cx = (g.bbox.x0 + g.bbox.x1) / 2, cy = (g.bbox.y0 + g.bbox.y1) / 2;
  if (Math.max(bw, bh) <= TILE - 96) {
    const pad = Math.max(48, Math.min(160, 0.6 * Math.max(bw, bh)));
    // keeps the aspect of the object, but never narrower than 256 px
    const w = Math.max(256, bw + pad * 2), h = Math.max(256, bh + pad * 2);
    return [windowAround(cx, cy, w, h, W, H, target)];
  }
  const x0 = Math.max(0, g.bbox.x0 - 24), y0 = Math.max(0, g.bbox.y0 - 24), x1 = Math.min(W, g.bbox.x1 + 24), y1 = Math.min(H, g.bbox.y1 + 24);
  const pts: [number, number][] = [];
  const reach: number[] = [];
  for (const s of g.shapes) {
    if (s.type === 'path') {
      const hw = strokeWidth(s, opts.kinds) / 2;
      for (const q of samplePath(s.points, 24)) { pts.push(q); reach.push(hw); }
    } else {
      const e = shapeExtent(s, opts.kinds);
      const nx = Math.max(1, Math.ceil((e.x1 - e.x0) / 48)), ny = Math.max(1, Math.ceil((e.y1 - e.y0) / 48));
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) { pts.push([e.x0 + ((e.x1 - e.x0) * i) / nx, e.y0 + ((e.y1 - e.y0) * j) / ny]); reach.push(0); }
    }
  }
  const out: Crop[] = [];
  const cols = Math.max(1, Math.ceil((x1 - x0 - (TILE - TILE_STEP)) / TILE_STEP));
  const rows = Math.max(1, Math.ceil((y1 - y0 - (TILE - TILE_STEP)) / TILE_STEP));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const tx0 = x0 + c * TILE_STEP, ty0 = y0 + r * TILE_STEP;
      const tx1 = Math.min(x1, tx0 + TILE), ty1 = Math.min(y1, ty0 + TILE);
      if (!pts.some(([px, py], i) => px >= tx0 - reach[i] && px <= tx1 + reach[i] && py >= ty0 - reach[i] && py <= ty1 + reach[i])) continue;
      out.push(windowAround((tx0 + tx1) / 2, (ty0 + ty1) / 2, Math.max(256, tx1 - tx0), Math.max(256, ty1 - ty0), W, H, target));
    }
  return out.length ? out : [windowAround(cx, cy, Math.min(W, TILE), Math.min(H, TILE), W, H, target)];
}

/** One shape as SVG markup in a flat colour, grown by `grow` px (white = paint here in a mask). */
export const shapeMarkup = (s: Shape, grow: number, kinds?: Kinds, color = '#fff'): string => {
  const p = s.points;
  const f = `fill="${color}" stroke="${color}" stroke-width="${grow * 2}" stroke-linejoin="round"`;
  if (s.type === 'polygon') return `<polygon points="${p.map(([x, y]) => `${x},${y}`).join(' ')}" ${f}/>`;
  if (s.type === 'ellipse') {
    const [cx, cy] = p[0] ?? [0, 0];
    const [rx, ry] = p[1] ?? [s.r ?? 30, s.r ?? 30];
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${f}/>`;
  }
  if (s.type === 'pin') return `<circle cx="${p[0][0]}" cy="${p[0][1]}" r="${s.r ?? DEFAULT_PIN}" ${f}/>`;
  return `<polyline points="${p.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${strokeWidth(s, kinds) + grow * 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
};

/**
 * A group's mask as SVG (white = paint here), cropped by viewBox to `c` and sized `out`.
 * `grow` / `blur` are px; the mask is the drawn shape itself, widened a little.
 */
export function regionMaskSvg(g: Pick<RegionGroup, 'shapes'>, c: Crop, grow: number, blur: number, out: { w: number; h: number }, kinds?: Kinds): string {
  const shapes = g.shapes.map((s) => shapeMarkup(s, grow, kinds)).join('');
  const filter = blur > 0 ? `<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/></filter>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${out.w}" height="${out.h}" viewBox="${c.x} ${c.y} ${c.w} ${c.h}"><defs>${filter}</defs><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="#000"/><g ${blur > 0 ? 'filter="url(#b)"' : ''}>${shapes}</g></svg>`;
}

/** The two masks one window needs: what the model repaints (sampling) and what is blended back (compose). */
export function regionMasks(g: Pick<RegionGroup, 'shapes'>, c: Crop, kinds?: Kinds): { sample: string; compose: string } {
  return {
    sample: regionMaskSvg(g, c, REGION_MASK.grow, 0, { w: c.tw, h: c.th }, kinds),
    compose: regionMaskSvg(g, c, REGION_MASK.composeGrow, REGION_MASK.blur, { w: c.w, h: c.h }, kinds),
  };
}
