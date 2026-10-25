import {
  DOOR_KINDS, FLOORS, LABEL_PLACES, LABEL_SIZES, PROP_KINDS,
  type DoorKind, type EdgeSide, type FloorChar, type LabelPlace, type LabelSize, type MapDoc, type PropKind,
} from './mapdata.js';
import { estimateWidth, isLabelStyle, LABEL_STYLES, type LabelCtx } from './labelstyles.js';
import { lettersSvg, placeLabels, type Placed } from './letters.js';
import { cleanKind, inStep2, isKnownKind, isLineKind, regionKind, REGION_KINDS, type RegionKind } from './regionkinds.js';

// ---------------------------------------------------------------------------
// Map logic shared by the server (edit_map, renders) and the browser editor:
// ops, wall derivation and SVG rendering — one code path for the AI and the GM.
// ---------------------------------------------------------------------------

export type MapOp =
  | { op: 'fill'; x: number; y: number; w: number; h: number; floor: string }
  | { op: 'clear'; x: number; y: number; w: number; h: number }
  | { op: 'room'; x: number; y: number; w: number; h: number; floor?: string; name?: string }
  | { op: 'corridor'; from: [number, number]; to: [number, number]; width?: number; floor?: string }
  | { op: 'door'; x: number; y: number; side: EdgeSide; kind?: DoorKind }
  | { op: 'remove_door'; x: number; y: number; side: EdgeSide }
  | { op: 'wall'; x: number; y: number; side: EdgeSide }
  | { op: 'open'; x: number; y: number; side: EdgeSide }
  | { op: 'prop'; kind: PropKind; x: number; y: number; w?: number; h?: number; rot?: number; label?: string; id?: string }
  | { op: 'remove_prop'; id: string }
  | { op: 'label'; id?: string; x: number; y: number; text: string; place?: LabelPlace; style?: string; show?: boolean; size?: LabelSize; area?: { x: number; y: number; w: number; h: number } }
  | { op: 'token'; x: number; y: number; kind: 'pc' | 'npc' | 'enemy'; label?: string; node?: string }
  | { op: 'remove_label'; id?: string; x?: number; y?: number }
  | { op: 'remove_token'; x: number; y: number }
  | { op: 'move_area'; x: number; y: number; w: number; h: number; dx: number; dy: number; copy?: boolean }
  | { op: 'edit_prop'; id: string; kind?: PropKind; x?: number; y?: number; w?: number; h?: number; rot?: number | null; label?: string | null }
  | { op: 'edit_token'; x: number; y: number; to?: [number, number]; kind?: 'pc' | 'npc' | 'enemy'; label?: string | null; node?: string | null }
  | { op: 'edit_label'; id?: string; x?: number; y?: number; to?: [number, number]; text?: string; place?: LabelPlace; style?: string | null; show?: boolean; size?: LabelSize | null; area?: { x: number; y: number; w: number; h: number } | null }
  | { op: 'lettering'; style: string }
  | { op: 'resize'; cols: number; rows: number }
  | { op: 'shape'; type: 'polygon' | 'path' | 'ellipse' | 'pin'; kind: string; points: [number, number][]; r?: number; width?: number; label?: string; prompt?: string; id?: string; labelPlace?: LabelPlace; labelStyle?: string | null; labelSize?: LabelSize | null; labelShow?: boolean }
  | { op: 'remove_shape'; id: string }
  | { op: 'edit_shape'; id: string; kind?: string; points?: [number, number][]; move?: [number, number]; r?: number | null; width?: number | null; label?: string | null; prompt?: string | null; labelPlace?: LabelPlace; labelStyle?: string | null; labelSize?: LabelSize | null; labelShow?: boolean }
  | { op: 'define_kind'; kind: Partial<RegionKind> }
  | { op: 'remove_kind'; id: string }
  | { op: 'clear_all' };

const FLOOR_BY_NAME = Object.fromEntries(Object.entries(FLOORS).map(([c, f]) => [f.name, c])) as Record<string, FloorChar>;

export function floorChar(f: string): string {
  const k = f.trim().toLowerCase();
  if (['.', 'rock', 'void', 'none', 'solid'].includes(k)) return '.';
  if (k in FLOORS) return k;
  const c = FLOOR_BY_NAME[k];
  if (!c) throw new Error(`Unknown floor "${f}". Use one of: ${Object.values(FLOORS).map((x) => x.name).join(', ')}, or rock.`);
  return c;
}

export function newMap(id: string, name: string, kind: MapDoc['kind'], cols = 24, rows = 18, unit = 6): MapDoc {
  cols = clampInt(cols, 4, 80);
  rows = clampInt(rows, 4, 80);
  return {
    id, name, kind,
    grid: { type: 'square', cols, rows, unit },
    rows: Array.from({ length: rows }, () => '.'.repeat(cols)),
    doors: [], walls: [], open: [], props: [], labels: [], tokens: [],
    size: { w: 1344, h: 768 }, shapes: [], renders: [], updatedAt: new Date().toISOString(),
    background: 'land',
  };
}

/** The outline of an area as the points of a closed line (a polygon's corners and back to the first; an ellipse as 32 points). */
function outlineOf(type: 'polygon' | 'ellipse' | 'path' | 'pin', points: [number, number][], r?: number): [number, number][] {
  if (type === 'ellipse') {
    const [cx, cy] = points[0] ?? [0, 0];
    const [rx, ry] = points[1] ?? [r ?? 30, r ?? 30];
    return Array.from({ length: 33 }, (_, i) => [Math.round(cx + rx * Math.cos((i / 32) * Math.PI * 2)), Math.round(cy + ry * Math.sin((i / 32) * Math.PI * 2))] as [number, number]);
  }
  return points.length && (points[0][0] !== points[points.length - 1][0] || points[0][1] !== points[points.length - 1][1]) ? [...points, points[0]] : points;
}

const clampInt = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

type LabelProps = { place?: LabelPlace; style?: string | null; show?: boolean; size?: LabelSize | null; area?: { x: number; y: number; w: number; h: number } | null };
/** Printing options of a label (ops `label` and `edit_label`): null / default values are not stored. */
function applyLabelProps(l: MapDoc['labels'][number], o: LabelProps) {
  if (o.place !== undefined) {
    if (!LABEL_PLACES.includes(o.place)) throw new Error(`place must be one of: ${LABEL_PLACES.join(', ')}`);
    if (o.place === 'middle') delete l.place; else l.place = o.place;
  }
  if (o.style !== undefined) {
    if (o.style === null || o.style === '') delete l.style;
    else if (!isLabelStyle(o.style)) throw new Error(`Unknown lettering style "${o.style}". Use: ${LABEL_STYLES.map((x) => x.id).join(', ')}`);
    else l.style = o.style;
  }
  if (o.show !== undefined) { if (o.show) delete l.show; else l.show = false; }
  if (o.size !== undefined) {
    if (o.size === null || o.size === 'md') delete l.size;
    else if (!LABEL_SIZES.includes(o.size)) throw new Error(`size must be one of: ${LABEL_SIZES.join(', ')}`);
    else l.size = o.size;
  }
  if (o.area !== undefined) {
    if (o.area === null) delete l.area;
    else {
      l.area = { x: o.area.x, y: o.area.y, w: Math.max(0, o.area.w), h: Math.max(0, o.area.h) };
      [l.x, l.y] = [l.area.x + l.area.w / 2, l.area.y + l.area.h / 2]; // x,y is the middle of the area: that is how a label is found and moved
    }
  }
}

// ------------------------------------ lettering ---------------------------------------

const labelIds = (m: MapDoc) => m.labels.map((l) => `${l.id ?? '?'} “${l.text}”`).join(', ') || 'none';
/** the next free label handle: l1, l2… */
function newLabelId(m: MapDoc, from = 1 + m.labels.length): string {
  let n = Math.max(1, from);
  while (m.labels.some((l) => l.id === `l${n}`)) n++;
  return `l${n}`;
}
/** Names made before they had handles get one (l1, l2… in drawing order). Returns true when something changed. */
export function ensureLabelIds(m: MapDoc): boolean {
  let changed = false;
  const seen = new Set<string>();
  for (const l of m.labels ?? []) {
    if (l.id && !seen.has(l.id)) { seen.add(l.id); continue; }
    let n = seen.size + 1;
    while (seen.has(`l${n}`) || (m.labels ?? []).some((q) => q !== l && q.id === `l${n}`)) n++;
    l.id = `l${n}`;
    seen.add(l.id);
    changed = true;
  }
  return changed;
}

let labelCtx: LabelCtx = { measure: estimateWidth };
/** The server and the browser tell the engine how to measure text in the real fonts (and where the generated materials are). */
export function setLabelContext(ctx: LabelCtx) { labelCtx = ctx; }
export function getLabelContext(): LabelCtx { return labelCtx; }

/** Where every name of the map stands, in the pixels of the editor's picture (or of `geo`, e.g. an existing render). */
export function placedLabels(m: MapDoc, ctx: LabelCtx = labelCtx, maxSide = 1344): Placed[] {
  const { w: W, h: H, cell } = imageSize(m, maxSide);
  return placeLabels(m, { W, H, cell }, ctx);
}

// ------------------------------- cells & edges ---------------------------------------

/** Canonical edge: always stored as the n or w side of the south/east cell. */
export function canon(x: number, y: number, side: EdgeSide): { x: number; y: number; side: 'n' | 'w' } {
  if (side === 's') return { x, y: y + 1, side: 'n' };
  if (side === 'e') return { x: x + 1, y, side: 'w' };
  return { x, y, side };
}
const same = (a: { x: number; y: number; side: string }, b: { x: number; y: number; side: string }) => a.x === b.x && a.y === b.y && a.side === b.side;

export const cellAt = (m: MapDoc, x: number, y: number): string => (x < 0 || y < 0 || y >= m.grid.rows || x >= m.grid.cols ? '.' : m.rows[y][x] ?? '.');
export const walkable = (m: MapDoc, x: number, y: number) => cellAt(m, x, y) !== '.';

function setCells(m: MapDoc, x: number, y: number, w: number, h: number, ch: string) {
  const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(m.grid.cols, x + w), y1 = Math.min(m.grid.rows, y + h);
  if (x1 <= x0 || y1 <= y0) throw new Error(`Area ${x},${y} ${w}x${h} is outside the ${m.grid.cols}x${m.grid.rows} grid`);
  for (let yy = y0; yy < y1; yy++) m.rows[yy] = m.rows[yy].slice(0, x0) + ch.repeat(x1 - x0) + m.rows[yy].slice(x1);
}

function inEdgeRange(m: MapDoc, e: { x: number; y: number; side: 'n' | 'w' }) {
  return e.x >= 0 && e.y >= 0 && e.x <= m.grid.cols && e.y <= m.grid.rows;
}

/** The two cells an edge separates. */
const edgeCells = (e: { x: number; y: number; side: 'n' | 'w' }): [[number, number], [number, number]] =>
  e.side === 'n' ? [[e.x, e.y - 1], [e.x, e.y]] : [[e.x - 1, e.y], [e.x, e.y]];

function removeEdgeFeature<T extends { x: number; y: number; side: EdgeSide }>(list: T[], e: { x: number; y: number; side: 'n' | 'w' }) {
  return list.filter((d) => !same(canon(d.x, d.y, d.side), e));
}

// ------------------------------------ ops --------------------------------------------

export function applyOps(m: MapDoc, ops: MapOp[]): { ok: number; notes: string[] } {
  const notes: string[] = [];
  let ok = 0;
  for (const o of ops) {
    switch (o.op) {
      case 'fill':
        setCells(m, o.x, o.y, o.w, o.h, floorChar(o.floor));
        break;
      case 'clear':
        setCells(m, o.x, o.y, o.w, o.h, '.');
        m.props = m.props.filter((p) => !(p.x >= o.x && p.x < o.x + o.w && p.y >= o.y && p.y < o.y + o.h));
        break;
      case 'room': {
        const ch = floorChar(o.floor ?? 'stone');
        setCells(m, o.x, o.y, o.w, o.h, ch);
        // walls against walkable neighbours (so abutting rooms stay separate; doors cut openings)
        for (let i = 0; i < o.w; i++) {
          addWallIfNeighbour(m, o.x + i, o.y, 'n');
          addWallIfNeighbour(m, o.x + i, o.y + o.h - 1, 's');
        }
        for (let j = 0; j < o.h; j++) {
          addWallIfNeighbour(m, o.x, o.y + j, 'w');
          addWallIfNeighbour(m, o.x + o.w - 1, o.y + j, 'e');
        }
        if (o.name) m.labels.push({ x: o.x + o.w / 2, y: o.y + Math.min(0.7, o.h / 2), text: o.name }); // top edge: stays clear of furniture
        break;
      }
      case 'corridor': {
        const ch = floorChar(o.floor ?? 'stone');
        const wd = clampInt(o.width ?? 1, 1, 6);
        const [x0, y0] = o.from, [x1, y1] = o.to;
        // L-shaped: horizontal first, then vertical
        setCells(m, Math.min(x0, x1), y0, Math.abs(x1 - x0) + 1, wd, ch);
        setCells(m, x1, Math.min(y0, y1), wd, Math.abs(y1 - y0) + wd, ch);
        break;
      }
      case 'door': {
        const e = canon(o.x, o.y, o.side);
        if (!inEdgeRange(m, e)) throw new Error(`Door ${o.x},${o.y} ${o.side} is outside the grid`);
        const [a, b] = edgeCells(e);
        if (!walkable(m, ...a) && !walkable(m, ...b)) notes.push(`door at ${o.x},${o.y}/${o.side} has no floor on either side`);
        m.doors = removeEdgeFeature(m.doors, e);
        m.doors.push({ x: e.x, y: e.y, side: e.side, kind: o.kind && DOOR_KINDS.includes(o.kind) ? o.kind : 'door' });
        break;
      }
      case 'remove_door':
        m.doors = removeEdgeFeature(m.doors, canon(o.x, o.y, o.side));
        break;
      case 'wall': {
        const e = canon(o.x, o.y, o.side);
        m.open = removeEdgeFeature(m.open, e);
        if (!m.walls.some((w) => same(w, e))) m.walls.push(e);
        break;
      }
      case 'open': {
        const e = canon(o.x, o.y, o.side);
        m.walls = removeEdgeFeature(m.walls, e);
        if (!m.open.some((w) => same(w, e))) m.open.push(e);
        break;
      }
      case 'prop': {
        if (!PROP_KINDS.includes(o.kind)) throw new Error(`Unknown prop "${o.kind}". Use: ${PROP_KINDS.join(', ')}`);
        if (o.x < 0 || o.y < 0 || o.x >= m.grid.cols || o.y >= m.grid.rows) throw new Error(`Prop at ${o.x},${o.y} is outside the grid`);
        const id = o.id ?? `${o.kind}-${Math.random().toString(36).slice(2, 6)}`;
        m.props = m.props.filter((p) => p.id !== id);
        m.props.push({ id, kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot, label: o.label });
        break;
      }
      case 'remove_prop':
        m.props = m.props.filter((p) => p.id !== o.id);
        break;
      case 'label': {
        const id = o.id?.trim() || newLabelId(m);
        const l: MapDoc['labels'][number] = { id, x: o.x, y: o.y, text: o.text };
        applyLabelProps(l, o);
        // a label with this id is replaced (the same name again, edited), anything else is added
        const at = m.labels.findIndex((q) => q.id === id);
        if (at >= 0) m.labels[at] = l; else m.labels.push(l);
        notes.push(`label “${o.text}” is ${id}`);
        break;
      }
      case 'remove_label': {
        if (o.id !== undefined) {
          if (!m.labels.some((l) => l.id === o.id)) throw new Error(`No label "${o.id}". Labels: ${labelIds(m)}`);
          m.labels = m.labels.filter((l) => l.id !== o.id);
        } else if (o.x !== undefined && o.y !== undefined) {
          m.labels = m.labels.filter((l) => Math.hypot(l.x - o.x!, l.y - o.y!) > 0.75);
        } else throw new Error('remove_label needs the label id (from get_map) or x and y');
        break;
      }
      case 'remove_token':
        m.tokens = m.tokens.filter((t) => !(t.x === o.x && t.y === o.y));
        break;
      case 'token':
        m.tokens.push({ x: o.x, y: o.y, kind: o.kind, label: o.label, ...(o.node ? { node: o.node } : {}) });
        break;
      case 'move_area': {
        const { x, y, w, h, dx, dy } = o;
        if (w < 1 || h < 1) throw new Error('move_area needs a width and height of at least 1');
        if (x < 0 || y < 0 || x + w > m.grid.cols || y + h > m.grid.rows) throw new Error(`Area ${x},${y} ${w}x${h} is outside the ${m.grid.cols}x${m.grid.rows} grid`);
        if (!dx && !dy) break;
        if (x + dx < 0 || y + dy < 0 || x + w + dx > m.grid.cols || y + h + dy > m.grid.rows) throw new Error(`Moving the area by ${dx},${dy} would leave the ${m.grid.cols}x${m.grid.rows} grid`);
        const inside = (cx: number, cy: number) => cx >= x && cx < x + w && cy >= y && cy < y + h;
        // an edge goes with the area when it touches a floor cell of the area
        const edgeIn = (e: { x: number; y: number; side: EdgeSide }) => edgeCells(canon(e.x, e.y, e.side)).some(([cx, cy]) => inside(cx, cy) && walkable(m, cx, cy));
        const cells: { x: number; y: number; ch: string }[] = [];
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (cellAt(m, xx, yy) !== '.') cells.push({ x: xx, y: yy, ch: cellAt(m, xx, yy) });
        const doors = m.doors.filter(edgeIn), walls = m.walls.filter(edgeIn), opens = m.open.filter(edgeIn);
        const props = m.props.filter((p) => inside(p.x, p.y));
        const tokens = m.tokens.filter((t) => inside(t.x, t.y));
        const labels = m.labels.filter((l) => inside(Math.floor(l.x), Math.floor(l.y)));
        if (!o.copy) {
          setCells(m, x, y, w, h, '.');
          m.doors = m.doors.filter((d) => !doors.includes(d));
          m.walls = m.walls.filter((d) => !walls.includes(d));
          m.open = m.open.filter((d) => !opens.includes(d));
          m.props = m.props.filter((p) => !props.includes(p));
          m.tokens = m.tokens.filter((t) => !tokens.includes(t));
          m.labels = m.labels.filter((l) => !labels.includes(l));
        }
        for (const c of cells) setCells(m, c.x + dx, c.y + dy, 1, 1, c.ch); // rock does not overwrite what is already there
        const shift = <T extends { x: number; y: number }>(e: T): T => ({ ...e, x: e.x + dx, y: e.y + dy });
        m.doors.push(...doors.map(shift));
        m.walls.push(...walls.map(shift));
        m.open.push(...opens.map(shift));
        m.props.push(...props.map((p) => ({ ...shift(p), id: o.copy ? `${p.kind}-${Math.random().toString(36).slice(2, 6)}` : p.id })));
        m.tokens.push(...tokens.map(shift));
        for (const l of labels) {
          const moved = { ...shift(l), ...(l.area ? { area: { ...l.area, x: l.area.x + dx, y: l.area.y + dy } } : {}) };
          if (o.copy) moved.id = newLabelId(m, 1 + m.labels.length);
          m.labels.push(moved);
        }
        notes.push(`${o.copy ? 'copied' : 'moved'} ${cells.length} cells, ${props.length} props, ${tokens.length} tokens, ${doors.length} doors by ${dx},${dy}`);
        break;
      }
      case 'edit_prop': {
        const p = m.props.find((q) => q.id === o.id);
        if (!p) throw new Error(`No prop "${o.id}"`);
        if (o.kind !== undefined) {
          if (!PROP_KINDS.includes(o.kind)) throw new Error(`Unknown prop "${o.kind}". Use: ${PROP_KINDS.join(', ')}`);
          p.kind = o.kind;
        }
        const nx = o.x ?? p.x, ny = o.y ?? p.y;
        if (nx < 0 || ny < 0 || nx >= m.grid.cols || ny >= m.grid.rows) throw new Error(`Prop would be outside the grid at ${nx},${ny}`);
        p.x = nx;
        p.y = ny;
        if (o.w !== undefined) p.w = Math.max(1, Math.min(12, Math.round(o.w)));
        if (o.h !== undefined) p.h = Math.max(1, Math.min(12, Math.round(o.h)));
        if (o.rot !== undefined) { if (o.rot === null) delete p.rot; else p.rot = o.rot; }
        if (o.label !== undefined) { if (o.label === null || !o.label.trim()) delete p.label; else p.label = o.label.trim(); }
        break;
      }
      case 'edit_token': {
        const t = m.tokens.find((q) => q.x === o.x && q.y === o.y);
        if (!t) throw new Error(`No token at ${o.x},${o.y}`);
        if (o.to) {
          if (o.to[0] < 0 || o.to[1] < 0 || o.to[0] >= m.grid.cols || o.to[1] >= m.grid.rows) throw new Error(`Token would be outside the grid at ${o.to}`);
          [t.x, t.y] = o.to;
        }
        if (o.kind) t.kind = o.kind;
        if (o.label !== undefined) { if (o.label === null || !o.label.trim()) delete t.label; else t.label = o.label.trim(); }
        if (o.node !== undefined) { if (o.node === null || !o.node.trim()) delete t.node; else t.node = o.node.trim(); }
        break;
      }
      case 'edit_label': {
        let l: MapDoc['labels'][number] | undefined;
        if (o.id !== undefined) {
          l = m.labels.find((q) => q.id === o.id);
          if (!l) throw new Error(`No label "${o.id}". Labels: ${labelIds(m)}`);
        } else if (o.x !== undefined && o.y !== undefined) {
          const [ox, oy] = [o.x, o.y];
          l = m.labels.find((q) => Math.hypot(q.x - ox, q.y - oy) <= 0.75);
          if (!l) throw new Error(`No label near ${ox},${oy}`);
        } else throw new Error('edit_label needs the label id (from get_map) or x and y');
        if (o.to) {
          const [dx, dy] = [o.to[0] - l.x, o.to[1] - l.y];
          [l.x, l.y] = o.to;
          if (l.area) { l.area.x += dx; l.area.y += dy; }
        }
        if (o.text !== undefined && o.text.trim()) l.text = o.text.trim();
        applyLabelProps(l, o);
        break;
      }
      case 'lettering': {
        if (!isLabelStyle(o.style)) throw new Error(`Unknown lettering style "${o.style}". Use: ${LABEL_STYLES.map((x) => x.id).join(', ')}`);
        m.lettering = { style: o.style };
        break;
      }
      case 'resize': {
        const cols = clampInt(o.cols, 4, 80), rows = clampInt(o.rows, 4, 80);
        const next = Array.from({ length: rows }, (_, y) => (m.rows[y] ?? '').padEnd(cols, '.').slice(0, cols).replace(/ /g, '.'));
        m.rows = next;
        m.grid.cols = cols;
        m.grid.rows = rows;
        break;
      }
      case 'shape': {
        if (!isKnownKind(o.kind, m.kinds)) throw new Error(`Unknown kind "${o.kind}". Use: ${[...REGION_KINDS.map((k) => k.id), ...(m.kinds ?? []).map((k) => k.id)].join(', ')} (define your own with define_kind).`);
        const id = o.id ?? `${o.kind}-${Math.random().toString(36).slice(2, 6)}`;
        const old = m.shapes.find((s) => s.id === id);
        m.shapes = m.shapes.filter((s) => s.id !== id);
        const prompt = o.prompt?.replace(/\s+/g, ' ').trim();
        // no dots: a place is an AREA (a round one is an ellipse). A pin from an old caller becomes a round area.
        const sh = o.type === 'pin' ? pinToEllipse({ id, type: 'pin', kind: o.kind, points: o.points, r: o.r }, m.kinds) : { type: o.type, points: o.points, r: o.r };
        // every shape has to be painted by some pass: lines (rivers, roads, walls) are drawn as lines, places and structures as areas
        const kd = regionKind(o.kind, m.kinds);
        let type = sh.type, points = sh.points, r = sh.r;
        if (isLineKind(kd) && (type === 'polygon' || type === 'ellipse')) {
          // a line kind drawn as an area (a town wall as a polygon) becomes the closed line of its outline
          points = outlineOf(type, points, r);
          type = 'path';
          r = undefined;
          notes.push(`“${kd.name}” is a line: the outline of the area was drawn as a closed line`);
        } else if (inStep2(kd) && type === 'path') {
          throw new Error(`“${kd.name}” is painted into an area or a spot: draw it as a polygon / ellipse (or a pin), not as a line.`);
        }
        const ns: MapDoc['shapes'][number] = { id, type, kind: o.kind, points, ...(r !== undefined ? { r } : {}), width: o.width, label: o.label, ...(prompt ? { prompt } : {}) };
        // how the name is printed stays with the shape when it is redrawn (moved, reshaped) without saying anything about it
        const keep = <K extends 'labelPlace' | 'labelStyle' | 'labelSize' | 'labelShow'>(k: K, v: unknown) => {
          const val = v === undefined ? old?.[k] : v;
          if (val !== undefined && val !== null && val !== '') (ns as Record<string, unknown>)[k] = val;
        };
        if (o.labelPlace !== undefined && !LABEL_PLACES.includes(o.labelPlace)) throw new Error(`labelPlace must be one of: ${LABEL_PLACES.join(', ')}`);
        if (o.labelSize != null && !LABEL_SIZES.includes(o.labelSize)) throw new Error(`labelSize must be one of: ${LABEL_SIZES.join(', ')}`);
        if (o.labelStyle != null && !isLabelStyle(o.labelStyle)) throw new Error(`Unknown lettering style "${o.labelStyle}". Use: ${LABEL_STYLES.map((x) => x.id).join(', ')}`);
        keep('labelPlace', o.labelPlace); keep('labelStyle', o.labelStyle); keep('labelSize', o.labelSize);
        keep('labelShow', o.labelShow === true ? undefined : o.labelShow); // true is the default: nothing to store
        if (o.labelShow === true) delete ns.labelShow;
        m.shapes.push(ns);
        break;
      }
      case 'define_kind': {
        const k = cleanKind(o.kind);
        m.kinds = [...(m.kinds ?? []).filter((x) => x.id !== k.id), k];
        break;
      }
      case 'remove_kind':
        if (m.shapes.some((s) => s.kind === o.id)) throw new Error(`Kind "${o.id}" is still used by shapes; remove or restyle them first.`);
        m.kinds = (m.kinds ?? []).filter((x) => x.id !== o.id);
        break;
      case 'remove_shape':
        m.shapes = m.shapes.filter((s) => s.id !== o.id);
        break;
      case 'edit_shape': {
        const s = m.shapes.find((q) => q.id === o.id);
        if (!s) throw new Error(`No shape "${o.id}". Shapes: ${m.shapes.map((q) => q.id).join(', ') || 'none'}`);
        if (o.kind !== undefined) {
          if (!isKnownKind(o.kind, m.kinds)) throw new Error(`Unknown kind "${o.kind}". Use: ${[...REGION_KINDS.map((k) => k.id), ...(m.kinds ?? []).map((k) => k.id)].join(', ')} (define your own with define_kind).`);
          // the same rules as a new shape: lines are drawn as lines, places and structures as areas
          const kd = regionKind(o.kind, m.kinds);
          if (isLineKind(kd) && s.type !== 'path') {
            s.points = outlineOf(s.type as 'polygon' | 'ellipse', s.points, s.r);
            s.type = 'path';
            delete s.r;
            notes.push(`“${kd.name}” is a line: the outline of the area was drawn as a closed line`);
          } else if (inStep2(kd) && s.type === 'path') throw new Error(`“${kd.name}” is painted into an area or a spot: it cannot be a line. Redraw it as a polygon / ellipse.`);
          s.kind = o.kind;
        }
        if (o.points) {
          if (!o.points.length) throw new Error('A shape needs points');
          s.points = o.points.map(([x, y]) => [x, y] as [number, number]);
        }
        if (o.move) {
          // an ellipse is [centre, radii]: only the centre moves
          const [dx, dy] = o.move;
          s.points = s.type === 'ellipse' ? ([[s.points[0][0] + dx, s.points[0][1] + dy], ...s.points.slice(1)] as [number, number][]) : s.points.map(([x, y]) => [x + dx, y + dy] as [number, number]);
        }
        const setOrDrop = (key: 'r' | 'width' | 'label' | 'prompt', v: number | string | null | undefined) => {
          if (v === undefined) return;
          const t = s as unknown as Record<string, unknown>;
          if (v === null || (typeof v === 'string' && !v.trim())) delete t[key];
          else t[key] = typeof v === 'string' ? (key === 'prompt' ? v.replace(/\s+/g, ' ').trim() : v.trim()) : v;
        };
        setOrDrop('r', o.r); setOrDrop('width', o.width); setOrDrop('label', o.label); setOrDrop('prompt', o.prompt);
        if (o.labelPlace !== undefined) {
          if (!LABEL_PLACES.includes(o.labelPlace)) throw new Error(`labelPlace must be one of: ${LABEL_PLACES.join(', ')}`);
          s.labelPlace = o.labelPlace;
        }
        if (o.labelStyle !== undefined) {
          if (o.labelStyle === null || o.labelStyle === '') delete s.labelStyle;
          else if (!isLabelStyle(o.labelStyle)) throw new Error(`Unknown lettering style "${o.labelStyle}". Use: ${LABEL_STYLES.map((x) => x.id).join(', ')}`);
          else s.labelStyle = o.labelStyle;
        }
        if (o.labelSize !== undefined) {
          if (o.labelSize === null || o.labelSize === 'md') delete s.labelSize;
          else if (!LABEL_SIZES.includes(o.labelSize)) throw new Error(`labelSize must be one of: ${LABEL_SIZES.join(', ')}`);
          else s.labelSize = o.labelSize;
        }
        if (o.labelShow !== undefined) { if (o.labelShow) delete s.labelShow; else s.labelShow = false; }
        break;
      }
      case 'clear_all':
        m.rows = Array.from({ length: m.grid.rows }, () => '.'.repeat(m.grid.cols));
        m.doors = []; m.walls = []; m.open = []; m.props = []; m.labels = []; m.tokens = []; m.shapes = [];
        break;
    }
    ok++;
  }
  // drop edge features that no longer touch any floor
  m.doors = m.doors.filter((d) => edgeCells(d as { x: number; y: number; side: 'n' | 'w' }).some(([x, y]) => walkable(m, x, y)));
  m.updatedAt = new Date().toISOString();
  return { ok, notes };
}

function addWallIfNeighbour(m: MapDoc, x: number, y: number, side: EdgeSide) {
  const e = canon(x, y, side);
  const [a, b] = edgeCells(e);
  if (walkable(m, ...a) && walkable(m, ...b) && !m.walls.some((w) => same(w, e)) && !m.doors.some((d) => same(d, e))) m.walls.push(e);
}

// ------------------------------------ derived walls -----------------------------------

export interface WallSeg { x1: number; y1: number; x2: number; y2: number }

/** Wall segments in cell coordinates (a wall sits on cell borders). */
export function derivedWalls(m: MapDoc): WallSeg[] {
  const segs: WallSeg[] = [];
  const doorAt = (e: { x: number; y: number; side: 'n' | 'w' }) => m.doors.find((d) => same(d, e));
  const push = (e: { x: number; y: number; side: 'n' | 'w' }) => segs.push(e.side === 'n' ? { x1: e.x, y1: e.y, x2: e.x + 1, y2: e.y } : { x1: e.x, y1: e.y, x2: e.x, y2: e.y + 1 });
  // every border where exactly one side is floor, or an explicit inner wall
  for (let y = 0; y <= m.grid.rows; y++)
    for (let x = 0; x <= m.grid.cols; x++)
      for (const side of ['n', 'w'] as const) {
        if ((side === 'n' && x >= m.grid.cols) || (side === 'w' && y >= m.grid.rows)) continue;
        const e = { x, y, side };
        const [a, b] = edgeCells(e);
        const wa = walkable(m, ...a), wb = walkable(m, ...b);
        if (!wa && !wb) continue;
        const d = doorAt(e);
        if (d && d.kind !== 'window') continue; // drawn separately as a door (opening)
        if (m.open.some((o) => same(o, e))) continue;
        if (wa !== wb || m.walls.some((w) => same(w, e))) push(e);
      }
  return segs;
}

// ------------------------------------ rendering ---------------------------------------

/** preview = the editor view; control = what one-pass painting receives; terrain = the bare place (floors, walls, doors; no props) for the first of the two painting steps */
export type MapStyle = 'preview' | 'control' | 'terrain';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PROP_COLOR: Record<string, string> = {
  table: '#c8782d', chair: '#a85d20', bed: '#e8e8f0', chest: '#e0b020', barrel: '#8a4a1a', crate: '#a07040', pillar: '#d0d0d8',
  statue: '#e8e0f0', altar: '#f0e8a0', fireplace: '#ff5a1a', stairs_up: '#f0f0a0', stairs_down: '#5a5a30', well: '#40a0ff',
  tree: '#1f7a2a', rock: '#8a8a8a', bookshelf: '#6a3a1a', throne: '#ffd700', cauldron: '#30c070', trap: '#ff2a2a', fountain: '#60c0ff',
  campfire: '#ff7a00', boat: '#a0622a',
};

/** Pixels per cell for a map that should fit into maxSide, snapped so the image is a multiple of 16. */
export function cellPx(m: MapDoc, maxSide = 1344): number {
  const px = Math.floor(maxSide / Math.max(m.grid.cols, m.grid.rows));
  return Math.max(16, px);
}

export function imageSize(m: MapDoc, maxSide = 1344): { w: number; h: number; cell: number } {
  if (m.kind === 'region') return { w: m.size.w, h: m.size.h, cell: 0 };
  const cell = cellPx(m, maxSide);
  const up = (n: number) => Math.ceil(n / 16) * 16;
  return { w: up(m.grid.cols * cell), h: up(m.grid.rows * cell), cell };
}

/** A legacy pin (a dot) as the round area it stands for: radius r, else the kind's usual size. */
export function pinToEllipse(s: MapDoc['shapes'][number], kinds?: MapDoc['kinds']): { type: 'ellipse'; points: [number, number][]; r?: number } {
  const [x, y] = s.points[0] ?? [0, 0];
  const r = s.r ?? regionKind(s.kind, kinds).size ?? 14;
  return { type: 'ellipse', points: [[x, y], [r, r]] };
}

/** Maps from before places were areas: every pin becomes a round area. Returns true when something changed. */
export function migratePins(m: MapDoc): boolean {
  let changed = false;
  m.shapes = (m.shapes ?? []).map((s) => {
    if (s.type !== 'pin') return s;
    changed = true;
    const { r: _r, ...rest } = s;
    return { ...rest, ...pinToEllipse(s, m.kinds) };
  });
  return changed;
}

/**
 * Make a map document that came from outside (an imported campaign, a save from the browser) safe to draw: every number a number,
 * custom kinds run through cleanKind, entries of the wrong shape dropped. The SVG of a map is put into the page as markup, so
 * nothing but numbers and known colours may reach it. Mutates and returns `m`.
 */
export function sanitizeMap(m: MapDoc): MapDoc {
  const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const opt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const arr = <T>(v: unknown, keep: (x: any) => boolean): T[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object' && keep(x)) as T[]) : []);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  m.kind = m.kind === 'region' ? 'region' : 'battle';
  const g = (m.grid ?? {}) as Partial<MapDoc['grid']>;
  m.grid = { type: g.type === 'hex' ? 'hex' : 'square', cols: Math.max(1, Math.min(200, Math.round(n(g.cols, 20)))), rows: Math.max(1, Math.min(200, Math.round(n(g.rows, 20)))), unit: n(g.unit, 5) };
  const sz = (m.size ?? {}) as Partial<MapDoc['size']>;
  m.size = { w: Math.max(64, Math.min(8192, n(sz.w, 1000))), h: Math.max(64, Math.min(8192, n(sz.h, 700))) };
  m.rows = Array.isArray(m.rows) ? m.rows.map(str) : [];
  const edge = (d: any) => ({ x: n(d.x), y: n(d.y), side: d.side === 'w' ? ('w' as const) : ('n' as const) });
  m.doors = arr<MapDoc['doors'][number]>(m.doors, () => true).map((d) => ({ ...edge(d), kind: (DOOR_KINDS as readonly string[]).includes(d.kind) ? d.kind : 'door' }));
  m.walls = arr<MapDoc['walls'][number]>(m.walls, () => true).map(edge);
  m.open = arr<MapDoc['open'][number]>(m.open, () => true).map(edge);
  m.props = arr<MapDoc['props'][number]>(m.props, (p) => typeof p.id === 'string').map((p) => ({
    id: p.id, kind: (PROP_KINDS as readonly string[]).includes(p.kind) ? p.kind : 'crate', x: n(p.x), y: n(p.y), w: opt(p.w), h: opt(p.h), rot: opt(p.rot), ...(typeof p.label === 'string' ? { label: p.label } : {}),
  }));
  for (const p of m.props) for (const k of ['w', 'h', 'rot'] as const) if (p[k] === undefined) delete p[k];
  m.tokens = arr<MapDoc['tokens'][number]>(m.tokens, () => true).map((t) => ({
    x: n(t.x), y: n(t.y), kind: t.kind === 'pc' || t.kind === 'npc' ? t.kind : 'enemy', ...(typeof t.label === 'string' ? { label: t.label } : {}), ...(typeof t.node === 'string' ? { node: t.node } : {}),
  }));
  m.labels = arr<MapDoc['labels'][number]>(m.labels, (l) => typeof l.text === 'string').map((l) => {
    const a = l.area as any;
    return { ...l, x: n(l.x), y: n(l.y), ...(a && typeof a === 'object' ? { area: { x: n(a.x), y: n(a.y), w: n(a.w), h: n(a.h) } } : { area: undefined }) };
  });
  for (const l of m.labels) if (l.area === undefined) delete l.area;
  m.kinds = arr<RegionKind>(m.kinds, () => true).flatMap((k) => {
    try {
      return [cleanKind(k)];
    } catch {
      return [];
    }
  });
  if (!m.kinds.length) delete m.kinds;
  m.shapes = arr<MapDoc['shapes'][number]>(m.shapes, (s) => typeof s.id === 'string' && Array.isArray(s.points)).map((s) => ({
    ...s,
    type: s.type === 'path' || s.type === 'ellipse' || s.type === 'pin' ? s.type : 'polygon',
    kind: str(s.kind),
    points: (s.points as unknown[]).filter((q): q is [number, number] => Array.isArray(q) && q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]) && typeof q[0] === 'number' && typeof q[1] === 'number').map((q) => [q[0], q[1]] as [number, number]),
    r: opt(s.r), width: opt(s.width),
  }));
  for (const s of m.shapes) for (const k of ['r', 'width'] as const) if (s[k] === undefined) delete s[k];
  if (typeof m.background !== 'string') delete m.background;
  return m;
}

export function renderSvg(m: MapDoc, style: MapStyle = 'preview', maxSide = 1344): string {
  return m.kind === 'region' ? renderRegion(m, style) : renderBattle(m, style, maxSide);
}

function renderBattle(m: MapDoc, style: MapStyle, maxSide: number): string {
  const { w: W, h: H, cell: c } = imageSize(m, maxSide);
  const ctrl = style !== 'preview';
  const bare = style === 'terrain';
  const o: string[] = [];
  const bg = ctrl ? '#16110d' : '#10131a';
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${bg}"/>`);

  // floors (merged per row run for fewer elements)
  for (let y = 0; y < m.grid.rows; y++) {
    let x = 0;
    while (x < m.grid.cols) {
      const ch = cellAt(m, x, y);
      if (ch === '.') { x++; continue; }
      let x2 = x;
      while (x2 + 1 < m.grid.cols && cellAt(m, x2 + 1, y) === ch) x2++;
      const color = FLOORS[ch as FloorChar]?.color ?? '#999';
      o.push(`<rect x="${x * c}" y="${y * c}" width="${(x2 - x + 1) * c}" height="${c}" fill="${color}"/>`);
      x = x2 + 1;
    }
  }
  // grid lines (preview only)
  if (!ctrl) {
    o.push('<g stroke="#000" stroke-opacity="0.28" stroke-width="1">');
    for (let y = 0; y < m.grid.rows; y++)
      for (let x = 0; x < m.grid.cols; x++) if (walkable(m, x, y)) o.push(`<rect x="${x * c}" y="${y * c}" width="${c}" height="${c}" fill="none"/>`);
    o.push('</g>');
  }
  // walls
  const wallW = Math.max(4, Math.round(c * (ctrl ? 0.34 : 0.16)));
  const wallColor = ctrl ? '#050403' : '#0b0c10';
  o.push(`<g stroke="${wallColor}" stroke-width="${wallW}" stroke-linecap="square">`);
  for (const s of derivedWalls(m)) o.push(`<line x1="${s.x1 * c}" y1="${s.y1 * c}" x2="${s.x2 * c}" y2="${s.y2 * c}"/>`);
  o.push('</g>');
  if (!ctrl) {
    o.push(`<g stroke="#6b7388" stroke-width="1" stroke-opacity="0.6" stroke-linecap="square">`);
    for (const s of derivedWalls(m)) o.push(`<line x1="${s.x1 * c}" y1="${s.y1 * c}" x2="${s.x2 * c}" y2="${s.y2 * c}" transform="translate(0 0)" stroke-width="${wallW + 2}" stroke-opacity="0.12"/>`);
    o.push('</g>');
  }
  // doors
  for (const d of m.doors) {
    const horiz = d.side === 'n';
    const cx = (horiz ? d.x + 0.5 : d.x) * c;
    const cy = (horiz ? d.y : d.y + 0.5) * c;
    const len = c * 0.78, th = Math.max(wallW + 2, c * 0.26);
    const [bw, bh] = horiz ? [len, th] : [th, len];
    const fill = { door: '#d9822b', secret: ctrl ? '#050403' : '#4a4a58', window: '#7fd0ff', arch: ctrl ? '#c9a46a' : '#b9a27a', portcullis: '#8a8f9a' }[d.kind];
    o.push(`<rect x="${cx - bw / 2}" y="${cy - bh / 2}" width="${bw}" height="${bh}" fill="${fill}" stroke="${ctrl ? '#050403' : '#0b0c10'}" stroke-width="${ctrl ? 2 : 1.5}" rx="${d.kind === 'arch' ? th / 2 : 2}"/>`);
    if (!ctrl && d.kind === 'secret') o.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="${c * 0.4}" fill="#aab" font-family="sans-serif">S</text>`);
  }
  // props (the terrain step leaves them out: they are painted in later, one group at a time)
  for (const p of bare ? [] : m.props) {
    const col = PROP_COLOR[p.kind] ?? '#ccc';
    const pw = (p.w ?? 1) * c * 0.84, ph = (p.h ?? 1) * c * 0.84;
    const cx = (p.x + (p.w ?? 1) / 2) * c, cy = (p.y + (p.h ?? 1) / 2) * c;
    const round = ['barrel', 'pillar', 'well', 'tree', 'campfire', 'fountain', 'cauldron', 'statue'].includes(p.kind);
    const stroke = ctrl ? '#050403' : '#0b0c10';
    const shape = round
      ? `<ellipse cx="0" cy="0" rx="${pw / 2}" ry="${ph / 2}" fill="${col}" stroke="${stroke}" stroke-width="2"/>`
      : `<rect x="${-pw / 2}" y="${-ph / 2}" width="${pw}" height="${ph}" rx="3" fill="${col}" stroke="${stroke}" stroke-width="2"/>`;
    o.push(`<g transform="translate(${cx} ${cy}) rotate(${p.rot ?? 0})">${shape}${!ctrl ? `<text y="${c * 0.14}" text-anchor="middle" font-size="${Math.min(pw, ph) * 0.5}" font-family="sans-serif" fill="#10131a" font-weight="700">${esc(p.kind.slice(0, 1).toUpperCase())}</text>` : ''}</g>`);
  }
  if (!ctrl) {
    o.push(lettersSvg(placedLabels(m, labelCtx, maxSide), { all: true }));
    const tc = { pc: '#4fd1ff', npc: '#7fe08a', enemy: '#ff6a6a' };
    for (const t of m.tokens) {
      o.push(`<circle cx="${(t.x + 0.5) * c}" cy="${(t.y + 0.5) * c}" r="${c * 0.4}" fill="${tc[t.kind]}" stroke="#0b0c10" stroke-width="2"/>`);
      // a token that stands for a character of the campaign (its sheet goes along to the VTT) wears a white ring
      if (t.node) o.push(`<circle cx="${(t.x + 0.5) * c}" cy="${(t.y + 0.5) * c}" r="${c * 0.46}" fill="none" stroke="#ffffff" stroke-width="2.5"/>`);
      if (t.label) o.push(`<text x="${(t.x + 0.5) * c}" y="${(t.y + 0.5) * c + c * 0.12}" text-anchor="middle" font-size="${c * 0.34}" font-family="sans-serif" fill="#0b0c10" font-weight="700">${esc(t.label.slice(0, 2))}</text>`);
    }
  }
  o.push('</svg>');
  return o.join('');
}

/**
 * preview = the editor; control = the whole sketch for one-pass painting; terrain = only what step 1 paints (the
 * land: structures are left out (inpainted later) and so are rivers, roads and other lines (painted in their own passes)).
 */
function renderRegion(m: MapDoc, style: MapStyle): string {
  const { w: W, h: H } = m.size;
  const ctrl = style !== 'preview';
  const bare = style === 'terrain';
  const bg = regionKind(m.background ?? 'land', m.kinds).color;
  const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${bg}"/>`];
  const pts = (p: [number, number][]) => p.map(([x, y]) => `${x},${y}`).join(' ');
  for (const s of m.shapes) {
    const k = regionKind(s.kind, m.kinds);
    if (bare && (k.layer === 'structure' || isLineKind(k))) continue;
    const col = k.color;
    if (s.type === 'polygon') o.push(`<polygon points="${pts(s.points)}" fill="${col}" stroke="${ctrl ? col : '#0b0c10'}" stroke-width="${ctrl ? 0 : 1.5}" stroke-linejoin="round"/>`);
    else if (s.type === 'path') o.push(`<polyline points="${pts(s.points)}" fill="none" stroke="${col}" stroke-width="${s.width ?? k.width ?? 14}" stroke-linecap="round" stroke-linejoin="round"${s.kind === 'road' ? ' stroke-dasharray="1 0"' : ''}/>`);
    else if (s.type === 'ellipse') {
      const [cx, cy] = s.points[0] ?? [0, 0];
      const [rx, ry] = s.points[1] ?? [s.r ?? 30, s.r ?? 30];
      o.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${col}"${!ctrl && k.layer === 'structure' ? ' stroke="#0b0c10" stroke-width="1.5"' : ''}/>`);
    } else if (s.type === 'pin') {
      const [x, y] = s.points[0] ?? [0, 0];
      o.push(`<circle cx="${x}" cy="${y}" r="${s.r ?? 14}" fill="${col}" stroke="#0b0c10" stroke-width="3"/>`);
    }
  }
  if (!ctrl) o.push(lettersSvg(placedLabels(m), { all: true }));
  o.push('</svg>');
  return o.join('');
}

const FLOOR_WORDS: Record<string, string> = {
  s: 'grey = stone floor', w: 'brown = wooden floor', d: 'dark brown = packed earth', g: 'green = grass', c: 'red = carpet', a: 'blue = water',
  l: 'orange-red = lava', r: 'dark grey = rubble', m: 'white = marble floor', n: 'tan = sand', i: 'pale blue = ice',
};
/** Legend for the terrain image, naming only the floors this map really uses (a legend for absent materials makes the model invent them). */
export function terrainLegend(m: MapDoc): string {
  const used = new Set(m.rows.join('').replace(/\./g, ''));
  const words = [...used].map((c) => FLOOR_WORDS[c]).filter(Boolean);
  return `The input is a flat colour-coded floor plan of an EMPTY, unfurnished place: near-black = outside, thick black lines = walls, small orange marks = doors${doorWords(m).map((w) => `, ${w}`).join('')}${words.length ? `, ${words.join(', ')}` : ''}.`;
}

/** The marks of the other kinds of door the plan really has (they are drawn in their own colours: a window is light blue, like water). */
const DOOR_WORDS: Partial<Record<string, string>> = {
  window: 'light-blue marks in walls = windows', arch: 'tan arched marks = open archways', portcullis: 'grey bars = portcullis gates',
};
function doorWords(m: Pick<MapDoc, 'doors'>): string[] {
  return [...new Set(m.doors.map((d) => d.kind))].map((k) => DOOR_WORDS[k]).filter((w): w is string => !!w);
}

/** The legend of the one-pass control image for this map: CONTROL_LEGEND plus the kinds of door it really uses. */
export function controlLegend(m: MapDoc): string {
  const extra = doorWords(m);
  return extra.length ? CONTROL_LEGEND.replace('orange gaps in walls = wooden doors', `orange gaps in walls = wooden doors, ${extra.join(', ')}`) : CONTROL_LEGEND;
}

/** What each colour in the control image means — handed to the image model's prompt. */
export const CONTROL_LEGEND =
  'Input is a flat colour-coded top-down floor plan: near-black = solid rock, thick black lines = walls, orange gaps in walls = wooden doors, grey = stone floor, brown = wooden floor, green = grass, blue = water, red = carpet, small coloured shapes = furniture and props.';

