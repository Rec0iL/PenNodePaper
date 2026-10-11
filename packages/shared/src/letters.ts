// Where the names of a map stand, and the SVG that prints them. Used by the editor (live) and the server (printing on pictures).
import type { LabelPlace, LabelSize, MapDoc } from './mapdata.js';
import { DEFAULT_LABEL_STYLE, layoutLabel, type LabelCtx } from './labelstyles.js';
import { regionKind } from './regionkinds.js';

/** Size of the picture the map is drawn on (px) and, for battle maps, one cell. */
export interface LetterGeo { W: number; H: number; cell: number }

export interface Placed {
  /** what the name belongs to: an entry of map.labels or a shape of a region map */
  src: { t: 'label'; i: number } | { t: 'shape'; id: string };
  text: string;
  style: string;
  place: LabelPlace;
  /** printed on the finished picture (label.show !== false) */
  shown: boolean;
  /** the area it stands next to (px) */
  area: { x: number; y: number; w: number; h: number };
  /** the box it occupies (px) */
  x: number; y: number; w: number; h: number;
  svg: string;
}

const SIZE_K: Record<LabelSize, number> = { sm: 0.8, md: 1, lg: 1.4 };

/** The base lettering size (px) for a map on a picture of this size. */
export function letterBase(m: MapDoc, geo: LetterGeo): number {
  return m.kind === 'battle' ? Math.max(12, geo.cell * 0.36) : Math.min(34, Math.max(13, geo.W / 68));
}

const bbox = (pts: [number, number][]) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/** The middle of a line along its length. */
function lineMid(pts: [number, number][]): [number, number] {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let at = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (at <= d && d > 0) return [pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * at) / d, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * at) / d];
    at -= d;
  }
  return pts[0] ?? [0, 0];
}

/** Every name of the map with the box it takes on the picture. Names never overlap: a later one moves away from an earlier one. */
export function placeLabels(m: MapDoc, geo: LetterGeo, ctx: LabelCtx): Placed[] {
  const base = letterBase(m, geo);
  const gap = base * 0.3;
  const unit = m.kind === 'battle' ? geo.cell : 1;
  const mapStyle = m.lettering?.style ?? DEFAULT_LABEL_STYLE;
  type Src = { src: Placed['src']; text: string; style?: string; place: LabelPlace; show: boolean; size?: LabelSize; area: Placed['area'] };
  const srcs: Src[] = [];

  if (m.kind === 'region') {
    (m.shapes ?? []).forEach((s) => {
      const text = s.label?.trim();
      if (!text || !s.points.length) return;
      const k = regionKind(s.kind, m.kinds);
      let area: Placed['area'];
      if (s.type === 'ellipse') {
        const [cx, cy] = s.points[0], [rx, ry] = s.points[1] ?? [s.r ?? 30, s.r ?? 30];
        area = { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
      } else if (s.type === 'pin') {
        const [cx, cy] = s.points[0], r = s.r ?? 14;
        area = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
      } else if (s.type === 'path') {
        const [cx, cy] = lineMid(s.points), hw = (s.width ?? k.width ?? 14) / 2;
        area = { x: cx - hw, y: cy - hw, w: hw * 2, h: hw * 2 };
      } else area = bbox(s.points);
      // names of places stand under them, names of land and water in the middle of it
      const place = s.labelPlace ?? (k.layer === 'structure' ? 'below' : 'middle');
      srcs.push({ src: { t: 'shape', id: s.id }, text, style: s.labelStyle, place, show: s.labelShow !== false, size: s.labelSize, area });
    });
  }
  m.labels.forEach((l, i) => {
    const text = l.text?.trim();
    if (!text) return;
    const area = l.area ? { x: l.area.x * unit, y: l.area.y * unit, w: l.area.w * unit, h: l.area.h * unit } : { x: l.x * unit, y: l.y * unit, w: 0, h: 0 };
    srcs.push({ src: { t: 'label', i }, text, style: l.style, place: l.place ?? 'middle', show: l.show !== false, size: l.size, area });
  });

  const out: Placed[] = [];
  const margin = base * 0.3;
  for (const s of srcs) {
    const box = layoutLabel(s.text, s.style ?? mapStyle, base * SIZE_K[s.size ?? 'md'], ctx, geo.W * 0.32);
    const cx = s.area.x + s.area.w / 2;
    let x = cx - box.w / 2;
    let y = s.place === 'above' ? s.area.y - gap - box.h : s.place === 'below' ? s.area.y + s.area.h + gap : s.area.y + s.area.h / 2 - box.h / 2;
    const clamp = () => {
      x = Math.max(margin, Math.min(geo.W - box.w - margin, x));
      y = Math.max(margin, Math.min(geo.H - box.h - margin, y));
    };
    clamp();
    for (let tries = 0; tries < 8; tries++) {
      const hit = out.find((p) => x < p.x + p.w + 2 && x + box.w + 2 > p.x && y < p.y + p.h + 2 && y + box.h + 2 > p.y);
      if (!hit) break;
      y = s.place === 'above' ? hit.y - box.h - 2 : hit.y + hit.h + 2;
      clamp();
    }
    out.push({ src: s.src, text: s.text, style: s.style ?? mapStyle, place: s.place, shown: s.show, area: s.area, x, y, w: box.w, h: box.h, svg: box.draw(x, y) });
  }
  return out;
}

/** The names as one SVG group in picture px. `all` also draws the ones that are not printed (dimmed) — for the editor. */
export function lettersSvg(placed: Placed[], opts: { all?: boolean } = {}): string {
  const shown = placed.filter((p) => p.shown);
  const hidden = opts.all ? placed.filter((p) => !p.shown) : [];
  return `<g class="letters">${shown.map((p) => p.svg).join('')}${hidden.length ? `<g opacity="0.35">${hidden.map((p) => p.svg).join('')}</g>` : ''}</g>`;
}
