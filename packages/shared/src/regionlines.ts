import type { MapDoc } from './mapdata.js';
import { isLineKind, lineGroupOf, regionKind, type RegionKind } from './regionkinds.js';
import { strokeWidth } from './regiongroups.js';

// ---------------------------------------------------------------------------
// Rivers, roads, railways, bridges: lines are never inpainted in windows (they
// came out as patchwork). They are painted in their own passes AFTER the
// terrain: the stroke is pre-rendered into the picture, the whole picture is
// sampled at a low denoise, and only a feathered corridor around the lines is
// kept — everything else stays pixel-identical. Water first, then land lines,
// so the model never has to decide between a river and a road.
// ---------------------------------------------------------------------------

type Shape = MapDoc['shapes'][number];

/** Denoise of a line pass (rated best at 0.30; 0.25 a little weaker, 0.35 equal). */
export const LINE_DENOISE = 0.3;

const poly = (s: Shape, stroke: string, w: number, extra = '') =>
  `<polyline points="${s.points.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  const t = f < 0 ? 0 : 255, a = Math.abs(f);
  return '#' + [r, g, b].map((c) => clamp(c + (t - c) * a).toString(16).padStart(2, '0')).join('');
}

/** The pre-rendered stroke of one line shape: a bank/edge, the body and a highlight, in the way that kind usually looks from above. */
export function strokeSvg(s: Shape, k: RegionKind, width: number): string {
  switch (s.kind) {
    case 'river': return poly(s, '#6f6240', width + 7) + poly(s, '#3d7db8', width) + poly(s, '#86bde0', Math.max(2, width * 0.3), 'opacity="0.75"');
    case 'road': return poly(s, '#4a3a28', width + 3) + poly(s, '#b49a72', width) + poly(s, '#cdb68c', Math.max(1.5, width * 0.35), 'opacity="0.8"');
    case 'road_paved': return poly(s, '#222228', width + 3) + poly(s, '#4a4a54', width) + poly(s, '#dcdcc4', Math.max(1.2, width * 0.12), 'stroke-dasharray="9 9"');
    case 'path': return poly(s, '#7a6848', width + 2) + poly(s, '#c9b284', width);
    case 'railway': return poly(s, '#6e665a', width + 5) + poly(s, '#2e2820', width + 1, 'stroke-dasharray="2 5"') + poly(s, '#9a9aa4', 1.4);
    case 'bridge': return poly(s, '#3a2c1c', width + 4) + poly(s, '#a4825a', width);
    case 'wall': return poly(s, '#18181c', width + 3) + poly(s, k.color, width) + poly(s, shade(k.color, 0.35), Math.max(1.5, width * 0.3), 'opacity="0.7"');
    default: return poly(s, shade(k.color, -0.45), width + 3) + poly(s, k.color, width) + poly(s, shade(k.color, 0.35), Math.max(1.5, width * 0.3), 'opacity="0.7"');
  }
}

export interface LineStage {
  group: 'water' | 'land';
  /** kind ids drawn in this pass */
  kinds: string[];
  shapes: Shape[];
  /** readable names, for the prompt ("Gravel road, Asphalt road, Railway") */
  names: string[];
  /** the kinds' own wording, for custom kinds */
  prompts: string[];
}

/** The line passes a map needs, water before land; empty groups are skipped. */
export function lineStages(m: Pick<MapDoc, 'shapes' | 'kinds'>): LineStage[] {
  const out: LineStage[] = [];
  for (const group of ['water', 'land'] as const) {
    const shapes = m.shapes.filter((s) => s.type === 'path' && s.points.length >= 2).filter((s) => {
      const k = regionKind(s.kind, m.kinds);
      return isLineKind(k) && lineGroupOf(k) === group;
    });
    if (!shapes.length) continue;
    const kinds = [...new Set(shapes.map((s) => s.kind))];
    const ks = kinds.map((id) => regionKind(id, m.kinds));
    out.push({ group, kinds, shapes, names: ks.map((k) => k.name.toLowerCase()), prompts: ks.filter((k) => k.custom).map((k) => k.prompt) });
  }
  return out;
}

/** The picture (as base64 PNG) with the stage's lines drawn in as pre-rendered strokes. */
export function linesDrawnSvg(m: Pick<MapDoc, 'size' | 'kinds'>, b64png: string, stage: Pick<LineStage, 'shapes'>): string {
  const { w: W, h: H } = m.size;
  const strokes = stage.shapes.map((s) => strokeSvg(s, regionKind(s.kind, m.kinds), strokeWidth(s, m.kinds))).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><image href="data:image/png;base64,${b64png}" width="${W}" height="${H}"/>${strokes}</svg>`;
}

/** The feathered corridor around the stage's lines (white = kept from the sample). */
export function corridorSvg(m: Pick<MapDoc, 'size' | 'kinds'>, stage: Pick<LineStage, 'shapes'>, extra = 30, blur = 7): string {
  const { w: W, h: H } = m.size;
  const g = stage.shapes.map((s) => poly(s, '#fff', strokeWidth(s, m.kinds) * 2 + extra)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="b" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${blur}"/></filter></defs><rect width="${W}" height="${H}" fill="#000"/><g filter="url(#b)">${g}</g></svg>`;
}

/** What the pass tells the model it is painting (the kinds' names, plus the GM's own wording for custom kinds). */
export function lineStageWhat(st: Pick<LineStage, 'group' | 'names' | 'prompts'>): { what: string; not: string } {
  const list = st.names.join(', ');
  const extra = st.prompts.length ? ` ${st.prompts.join('. ')}.` : '';
  return st.group === 'water'
    ? { what: `${list.charAt(0).toUpperCase()}${list.slice(1)} winds through the land, with natural banks.${extra}`, not: 'roads, paths, railway, bridge' }
    : { what: `${list.charAt(0).toUpperCase()}${list.slice(1)} cross the land, with a bridge where they cross water. No new rivers or streams anywhere.${extra}`, not: 'river, stream, new water channel' };
}
