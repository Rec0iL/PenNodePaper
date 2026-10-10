import {
  DOOR_KINDS, FLOORS, PROP_KINDS, TERRAINS,
  type DoorKind, type EdgeSide, type FloorChar, type MapDoc, type PropKind, type TerrainKind,
} from './mapdata.js';

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
  | { op: 'label'; x: number; y: number; text: string }
  | { op: 'token'; x: number; y: number; kind: 'pc' | 'npc' | 'enemy'; label?: string; node?: string }
  | { op: 'remove_label'; x: number; y: number }
  | { op: 'remove_token'; x: number; y: number }
  | { op: 'move_area'; x: number; y: number; w: number; h: number; dx: number; dy: number; copy?: boolean }
  | { op: 'edit_prop'; id: string; kind?: PropKind; x?: number; y?: number; w?: number; h?: number; rot?: number | null; label?: string | null }
  | { op: 'edit_token'; x: number; y: number; to?: [number, number]; kind?: 'pc' | 'npc' | 'enemy'; label?: string | null; node?: string | null }
  | { op: 'edit_label'; x: number; y: number; to?: [number, number]; text?: string }
  | { op: 'resize'; cols: number; rows: number }
  | { op: 'shape'; type: 'polygon' | 'path' | 'ellipse' | 'pin'; kind: TerrainKind; points: [number, number][]; r?: number; width?: number; label?: string; id?: string }
  | { op: 'remove_shape'; id: string }
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

const clampInt = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

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
      case 'label':
        m.labels.push({ x: o.x, y: o.y, text: o.text });
        break;
      case 'remove_label':
        m.labels = m.labels.filter((l) => Math.hypot(l.x - o.x, l.y - o.y) > 0.75);
        break;
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
        m.labels.push(...labels.map(shift));
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
        const l = m.labels.find((q) => Math.hypot(q.x - o.x, q.y - o.y) <= 0.75);
        if (!l) throw new Error(`No label near ${o.x},${o.y}`);
        if (o.to) [l.x, l.y] = o.to;
        if (o.text !== undefined && o.text.trim()) l.text = o.text.trim();
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
        if (!(o.kind in TERRAINS)) throw new Error(`Unknown terrain "${o.kind}". Use: ${Object.keys(TERRAINS).join(', ')}`);
        const id = o.id ?? `${o.kind}-${Math.random().toString(36).slice(2, 6)}`;
        m.shapes = m.shapes.filter((s) => s.id !== id);
        m.shapes.push({ id, type: o.type, kind: o.kind, points: o.points, r: o.r, width: o.width, label: o.label });
        break;
      }
      case 'remove_shape':
        m.shapes = m.shapes.filter((s) => s.id !== o.id);
        break;
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
    for (const l of m.labels)
      o.push(`<text x="${l.x * c}" y="${l.y * c}" text-anchor="middle" font-size="${Math.max(11, c * 0.34)}" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" font-weight="600">${esc(l.text)}</text>`);
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

function renderRegion(m: MapDoc, style: MapStyle): string {
  const { w: W, h: H } = m.size;
  const ctrl = style === 'control';
  const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${TERRAINS[m.background ?? 'land']}"/>`];
  const pts = (p: [number, number][]) => p.map(([x, y]) => `${x},${y}`).join(' ');
  for (const s of m.shapes) {
    const col = TERRAINS[s.kind];
    const lineKinds = s.type === 'path';
    if (s.type === 'polygon') o.push(`<polygon points="${pts(s.points)}" fill="${col}" stroke="${ctrl ? col : '#0b0c10'}" stroke-width="${ctrl ? 0 : 1.5}" stroke-linejoin="round"/>`);
    else if (lineKinds) o.push(`<polyline points="${pts(s.points)}" fill="none" stroke="${col}" stroke-width="${s.width ?? (s.kind === 'road' ? 10 : 14)}" stroke-linecap="round" stroke-linejoin="round"${s.kind === 'road' ? ' stroke-dasharray="1 0"' : ''}/>`);
    else if (s.type === 'ellipse') {
      const [cx, cy] = s.points[0] ?? [0, 0];
      const [rx, ry] = s.points[1] ?? [s.r ?? 30, s.r ?? 30];
      o.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${col}"/>`);
    } else if (s.type === 'pin') {
      const [x, y] = s.points[0] ?? [0, 0];
      o.push(`<circle cx="${x}" cy="${y}" r="${s.r ?? 14}" fill="${col}" stroke="#0b0c10" stroke-width="3"/>`);
    }
    if (!ctrl && s.label) {
      const [lx, ly] = labelPoint(s.points);
      o.push(`<text x="${lx}" y="${ly}" text-anchor="middle" font-size="16" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" font-weight="600">${esc(s.label)}</text>`);
    }
  }
  o.push('</svg>');
  return o.join('');
}

function labelPoint(p: [number, number][]): [number, number] {
  if (!p.length) return [0, 0];
  return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
}



const FLOOR_WORDS: Record<string, string> = {
  s: 'grey = stone floor', w: 'brown = wooden floor', d: 'dark brown = packed earth', g: 'green = grass', c: 'red = carpet', a: 'blue = water',
  l: 'orange-red = lava', r: 'dark grey = rubble', m: 'white = marble floor', n: 'tan = sand', i: 'pale blue = ice',
};
/** Legend for the terrain image, naming only the floors this map really uses (a legend for absent materials makes the model invent them). */
export function terrainLegend(m: MapDoc): string {
  const used = new Set(m.rows.join('').replace(/\./g, ''));
  const words = [...used].map((c) => FLOOR_WORDS[c]).filter(Boolean);
  return `The input is a flat colour-coded floor plan of an EMPTY, unfurnished place: near-black = outside, thick black lines = walls, small orange marks = doors${words.length ? `, ${words.join(', ')}` : ''}.`;
}

/** What each colour in the control image means — handed to the image model's prompt. */
export const CONTROL_LEGEND =
  'Input is a flat colour-coded top-down floor plan: near-black = solid rock, thick black lines = walls, orange gaps in walls = wooden doors, grey = stone floor, brown = wooden floor, green = grass, blue = water, red = carpet, small coloured shapes = furniture and props.';

export const REGION_LEGEND =
  'Input is a flat colour-coded map sketch: blue = sea and lakes, light-blue lines = rivers, dark green = forest, grey = mountains, olive/tan = hills and desert, brown lines = roads, coloured dots = towns, villages and castles.';

