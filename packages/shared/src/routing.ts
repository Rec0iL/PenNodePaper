// Edge routing for the canvas: connections go around cards, their labels slide along the line to stay readable.
// Pure geometry (flow coordinates, no DOM) so it is testable; the canvas feeds it node boxes and edge end points.
//
// An edge keeps exactly the bezier it always had as long as that is clear of every card. Only a blocked one is
// routed: A* over a coarse grid of "free" cells (cards inflated by a margin), simplified to a few waypoints, drawn
// as a polyline with rounded corners. Edges may cross each other, so other edges are no obstacle (only a soft cost
// for running along the same cells, which fans parallel detours out a little).

/** a point; `r` caps the corner rounding at this vertex (a line that must be level again before it meets a label) */
export interface RPt { x: number; y: number; r?: number }
export interface RBox { id: string; x: number; y: number; w: number; h: number }
export interface REdge {
  id: string;
  from: string;
  to: string;
  /** source handle (right side of the source card), target handle (left side of the target card) */
  sx: number; sy: number; tx: number; ty: number;
  /** size of the label's pill, when the edge has a label */
  label?: { w: number; h: number } | null;
}
export interface RouteOpts {
  /** how far a detour keeps away from a card (default 24) */
  margin?: number;
  /** grid cell of the path search (default 36) */
  cell?: number;
  /** a plain bezier closer than this to a card counts as blocked (default 10) */
  clearance?: number;
}
export interface EdgeRoute {
  /** false = the edge keeps its plain bezier (only `label` is of use) */
  routed: boolean;
  /** the points between the two handles (stub ends and waypoints) to draw with `roundedPath` */
  via: RPt[];
  /** the whole line sampled (for the label) */
  pts: RPt[];
  /** where the label's centre goes (the middle of the line for an edge without one) */
  label: RPt | null;
  /** a plain curve with its label in it: the curve runs to `enter`, straight to `leave`, and on (see `inlineBezier`) */
  inline?: { enter: RPt; leave: RPt } | null;
}

const STUB_MAX = 26;
/** distance between the lanes of connections that run between the same two cards */
const LANE = 30;
/** how far the line runs level into a label before it meets it */
const LEAD = 30;
const MAX_CELLS = 36000;
const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
/** where on the line a label may sit (fraction of its length), nearest the middle first */
const LABEL_T = [0.5, ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((k) => [0.5 - k * 0.05, 0.5 + k * 0.05])];

/** Size of a label pill as the canvas draws it (10.5px text, 7px side padding, 1px border). */
export function labelSize(text: string): { w: number; h: number } {
  return { w: Math.max(26, Math.round(text.length * 5.9 + 18)), h: 20 };
}

/** The curve xyflow draws between a right handle and a left handle (getBezierPath with its default curvature), sampled. */
export function bezierPoints(sx: number, sy: number, tx: number, ty: number, n?: number): RPt[] {
  const off = tx - sx >= 0 ? 0.5 * (tx - sx) : 0.25 * 25 * Math.sqrt(sx - tx);
  const x1 = sx + off, x2 = tx - off;
  const steps = n ?? Math.max(24, Math.min(200, Math.ceil(Math.hypot(tx - sx, ty - sy) / 8)));
  const out: RPt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push({
      x: u * u * u * sx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * tx,
      y: u * u * u * sy + 3 * u * u * t * sy + 3 * u * t * t * ty + t * t * t * ty,
    });
  }
  return out;
}

function halfBezier(p: RPt, q: RPt): [number, number] {
  return [p.x + (q.x - p.x >= 0 ? 0.5 * (q.x - p.x) : 0.25 * 25 * Math.sqrt(p.x - q.x)), q.x - (q.x - p.x >= 0 ? 0.5 * (q.x - p.x) : 0.25 * 25 * Math.sqrt(p.x - q.x))];
}

/** The plain curve with a label in it: handle -> label start as a bezier with level ends, straight through the label, bezier on to the other handle. */
export function inlineBezier(src: RPt, enter: RPt, leave: RPt, tgt: RPt): { d: string; pts: RPt[] } {
  const seg = (p: RPt, q: RPt) => {
    const [x1, x2] = halfBezier(p, q);
    return { d: `C ${x1} ${p.y} ${x2} ${q.y} ${q.x} ${q.y}`, x1, x2 };
  };
  const first = seg(src, enter), last = seg(leave, tgt);
  const sample = (p: RPt, q: RPt, x1: number, x2: number): RPt[] => {
    const out: RPt[] = [];
    const n = Math.max(8, Math.min(80, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 8)));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push({ x: u * u * u * p.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * q.x, y: u * u * u * p.y + 3 * u * u * t * p.y + 3 * u * t * t * q.y + t * t * t * q.y });
    }
    return out;
  };
  return {
    d: `M ${src.x} ${src.y} ${first.d} L ${leave.x} ${leave.y} ${last.d}`,
    pts: [src, ...sample(src, enter, first.x1, first.x2), leave, ...sample(leave, tgt, last.x1, last.x2)],
  };
}

/** A polyline with rounded corners as an SVG path (the corner is a quadratic curve around the vertex). */
export function roundedPath(p: RPt[], radius = 40): string {
  if (p.length < 2) return '';
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], v = p[i], b = p[i + 1];
    const la = Math.hypot(a.x - v.x, a.y - v.y), lb = Math.hypot(b.x - v.x, b.y - v.y);
    if (la < 1e-6 || lb < 1e-6) continue;
    const r = Math.min(v.r ?? radius, la / 2, lb / 2);
    const ax = v.x + ((a.x - v.x) / la) * r, ay = v.y + ((a.y - v.y) / la) * r;
    const bx = v.x + ((b.x - v.x) / lb) * r, by = v.y + ((b.y - v.y) / lb) * r;
    d += ` L ${ax} ${ay} Q ${v.x} ${v.y} ${bx} ${by}`;
  }
  const e = p[p.length - 1];
  return `${d} L ${e.x} ${e.y}`;
}

/** The same polyline as dense points (corners sampled), to walk along it. */
export function roundedPoints(p: RPt[], radius = 40): RPt[] {
  if (p.length < 3) return p.slice();
  const out: RPt[] = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], v = p[i], b = p[i + 1];
    const la = Math.hypot(a.x - v.x, a.y - v.y), lb = Math.hypot(b.x - v.x, b.y - v.y);
    if (la < 1e-6 || lb < 1e-6) continue;
    const r = Math.min(v.r ?? radius, la / 2, lb / 2);
    const ax = v.x + ((a.x - v.x) / la) * r, ay = v.y + ((a.y - v.y) / la) * r;
    const bx = v.x + ((b.x - v.x) / lb) * r, by = v.y + ((b.y - v.y) / lb) * r;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      out.push({ x: u * u * ax + 2 * u * t * v.x + t * t * bx, y: u * u * ay + 2 * u * t * v.y + t * t * by });
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

const inside = (x: number, y: number, b: RBox, m: number) => x > b.x - m && x < b.x + b.w + m && y > b.y - m && y < b.y + b.h + m;

function lengths(pts: RPt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return cum;
}

/** Does a polyline run into a card (nearer than `m`)? The first and last `skip` of its length (the handle stubs) do not count. */
function blocked(pts: RPt[], boxes: RBox[], m: number, skip: number): boolean {
  const cum = lengths(pts);
  const total = cum[cum.length - 1];
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] < skip || cum[i] > total - skip) continue;
    for (const b of boxes) if (inside(pts[i].x, pts[i].y, b, m)) return true;
  }
  return false;
}

/** Does the segment a-b cross the (inflated) rectangle? Slab test. */
function segHits(a: RPt, b: RPt, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dy, a.y - r.y0], [dy, r.y1 - a.y]] as const) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

/** Binary min-heap on a parallel key array. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    let i = this.ids.length;
    this.ids.push(id);
    this.keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      [this.ids[p], this.ids[i]] = [this.ids[i], this.ids[p]];
      [this.keys[p], this.keys[i]] = [this.keys[i], this.keys[p]];
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!, lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        [this.ids[m], this.ids[i]] = [this.ids[i], this.ids[m]];
        [this.keys[m], this.keys[i]] = [this.keys[i], this.keys[m]];
        i = m;
      }
    }
    return top;
  }
}

function segDist(p: RPt, a: RPt, b: RPt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Put points into a polyline in travel order. The corners of the old line that lie between the first and the last of them
 * (a bend right under the label) are dropped, so the line runs into the first point and on from the last. The stub vertices
 * next to the handles stay; null when the points do not fit in between or would be passed the wrong way round.
 */
function spliceThrough(base: RPt[], through: RPt[]): RPt[] | null {
  const cum = lengths(base);
  const along = (p: RPt) => {
    let best = Infinity, s = 0;
    for (let i = 1; i < base.length; i++) {
      const a = base[i - 1], b = base[i];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      if (d < best) { best = d; s = cum[i - 1] + t * Math.sqrt(l2); }
    }
    return s;
  };
  const s1 = along(through[0]), s2 = along(through[through.length - 1]);
  if (s2 < s1 || s1 < cum[1] || s2 > cum[base.length - 2]) return null;
  const out = [base[0]];
  for (let k = 1; k < base.length - 1; k++) if (cum[k] <= s1) out.push(base[k]);
  out.push(...through);
  for (let k = 1; k < base.length - 1; k++) if (cum[k] > s2) out.push(base[k]);
  out.push(base[base.length - 1]);
  return out;
}

const usedKey = (ix: number, iy: number) => (ix + 32768) * 65536 + (iy + 32768);

/** A* between two points over the free cells; the centres of the cells it ran through, or null. */
function search(a: RPt, b: RPt, obstacles: { x0: number; y0: number; x1: number; y1: number }[], cellIn: number, pad: number, used: Map<number, number>): RPt[] | null {
  let cell = cellIn;
  let minX = Math.min(a.x, b.x) - pad, maxX = Math.max(a.x, b.x) + pad, minY = Math.min(a.y, b.y) - pad, maxY = Math.max(a.y, b.y) + pad;
  while (((maxX - minX) / cell) * ((maxY - minY) / cell) > MAX_CELLS) cell *= 1.4;
  const ix0 = Math.floor(minX / cell), iy0 = Math.floor(minY / cell);
  const W = Math.ceil(maxX / cell) - ix0 + 1, H = Math.ceil(maxY / cell) - iy0 + 1;
  const grid = new Uint8Array(W * H);
  // a cell is shut when its centre is inside a card's margin: paths run through cell centres, and a gap between two cards stays passable
  for (const o of obstacles) {
    if (o.x1 < minX || o.x0 > maxX || o.y1 < minY || o.y0 > maxY) continue;
    const cx0 = Math.max(0, Math.floor(o.x0 / cell - 0.5) + 1 - ix0), cx1 = Math.min(W - 1, Math.ceil(o.x1 / cell - 0.5) - 1 - ix0);
    const cy0 = Math.max(0, Math.floor(o.y0 / cell - 0.5) + 1 - iy0), cy1 = Math.min(H - 1, Math.ceil(o.y1 / cell - 0.5) - 1 - iy0);
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) grid[y * W + x] = 1;
  }
  const sx = Math.floor(a.x / cell) - ix0, sy = Math.floor(a.y / cell) - iy0;
  const gx = Math.floor(b.x / cell) - ix0, gy = Math.floor(b.y / cell) - iy0;
  // the stub ends are outside the cards' margins by construction, but the centre of their cell may not be
  grid[sy * W + sx] = 0;
  grid[gy * W + gx] = 0;
  const N = W * H * 8;
  const cost = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const heur = (x: number, y: number) => {
    const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
    // a little over-eager (weighted A*): detours need not be the very shortest, and the search stays small
    return 1.8 * (Math.max(dx, dy) + 0.414 * Math.min(dx, dy));
  };
  const heap = new Heap();
  const start = (sy * W + sx) * 8;
  cost[start] = 0;
  heap.push(start, heur(sx, sy));
  let goal = -1;
  while (heap.size) {
    const s = heap.pop();
    const cellIdx = (s / 8) | 0, dir = s % 8;
    const x = cellIdx % W, y = (cellIdx / W) | 0;
    if (x === gx && y === gy) { goal = s; break; }
    const g = cost[s];
    for (let nd = 0; nd < 8; nd++) {
      const [dx, dy] = DIRS[nd];
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || grid[ny * W + nx]) continue;
      if (dx && dy && (grid[y * W + nx] || grid[ny * W + x])) continue; // no squeezing diagonally between two cards
      const turn = Math.min((nd - dir + 8) % 8, (dir - nd + 8) % 8);
      const shared = used.get(usedKey(Math.floor(((nx + ix0 + 0.5) * cell) / cellIn), Math.floor(((ny + iy0 + 0.5) * cell) / cellIn)));
      let c = g + (dx && dy ? 1.414 : 1) + 0.35 * turn * turn + (shared ? 1.5 : 0);
      if (nx === gx && ny === gy) c += 0.35 * Math.min(nd, 8 - nd) ** 2; // the last run enters the card from the left, moving right
      const ns = (ny * W + nx) * 8 + nd;
      if (c < cost[ns]) {
        cost[ns] = c;
        from[ns] = s;
        heap.push(ns, c + heur(nx, ny));
      }
    }
  }
  if (goal < 0) return null;
  const out: RPt[] = [];
  for (let s = goal; s >= 0; s = from[s]) {
    const ci = (s / 8) | 0;
    out.push({ x: ((ci % W) + ix0 + 0.5) * cell, y: (((ci / W) | 0) + iy0 + 0.5) * cell });
  }
  return out.reverse();
}

/** Route every edge around the cards and place the labels. Deterministic for the same input. */
export function routeEdges(boxes: RBox[], edges: REdge[], opts: RouteOpts = {}): Map<string, EdgeRoute> {
  const margin = opts.margin ?? 24;
  const cell = opts.cell ?? 36;
  const clearance = opts.clearance ?? 10;
  // a tight spot is tried again with a thinner margin on a finer grid before the edge gives up and stays a plain curve
  const levels = [{ margin, cell }, { margin: margin / 2, cell: cell / 2 }].map((l) => ({
    ...l,
    infl: boxes.map((b) => ({ x0: b.x - l.margin, y0: b.y - l.margin, x1: b.x + b.w + l.margin, y1: b.y + b.h + l.margin })),
  }));
  const used = new Map<number, number>();
  const out = new Map<string, EdgeRoute>();
  const order = [...edges].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));

  // connections between the same two cards would be drawn on top of each other (and nobody could tell which label is whose):
  // they fan out into parallel lanes, the middle one keeps the plain curve
  const lane = new Map<string, number>();
  const bundles = new Map<string, REdge[]>();
  for (const e of order) {
    const k = `${e.from}\u0000${e.to}`;
    const list = bundles.get(k);
    if (list) list.push(e);
    else bundles.set(k, [e]);
  }
  for (const list of bundles.values()) if (list.length > 1) list.forEach((e, i) => lane.set(e.id, (i - (list.length - 1) / 2) * LANE));
  const ends = new Map<string, { a: RPt; b: RPt }>();

  for (const e of order) {
    const plain = bezierPoints(e.sx, e.sy, e.tx, e.ty);
    let route: EdgeRoute = { routed: false, via: [], pts: plain, label: null };
    const fwd = e.tx - e.sx;
    const stub = fwd > 0 ? Math.min(STUB_MAX, Math.max(4, fwd / 2)) : STUB_MAX;
    const a = { x: e.sx + stub, y: e.sy }, b = { x: e.tx - stub, y: e.ty };
    ends.set(e.id, { a, b });
    const off = lane.get(e.id) ?? 0;
    let fanned = false;
    if (off !== 0 && e.from !== e.to) {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const m = { x: (a.x + b.x) / 2 - (dy / len) * off, y: (a.y + b.y) / 2 + (dx / len) * off };
      const pts = roundedPoints([{ x: e.sx, y: e.sy }, a, m, b, { x: e.tx, y: e.ty }]);
      if (!blocked(pts, boxes, clearance, 30)) {
        route = { routed: true, via: [a, m, b], pts, label: null };
        fanned = true;
      }
    }
    if (!fanned && e.from !== e.to && blocked(plain, boxes, clearance, 30)) {
      let pts: RPt[] | null = null;
      let infl = levels[0].infl;
      for (const l of levels) {
        for (const pad of [160, 520]) {
          pts = search(a, b, l.infl, l.cell, pad, used);
          if (pts) break;
        }
        if (pts) { infl = l.infl; break; }
      }
      if (pts) {
        pts[0] = a;
        pts[pts.length - 1] = b;
        // string pulling: keep only the points the line of sight needs
        const via: RPt[] = [pts[0]];
        let i = 0;
        while (i < pts.length - 1) {
          let j = pts.length - 1;
          while (j > i + 1 && infl.some((r) => segHits(pts[i], pts[j], { x0: r.x0 + 1, y0: r.y0 + 1, x1: r.x1 - 1, y1: r.y1 - 1 }))) j--;
          via.push(pts[j]);
          i = j;
        }
        for (const c of pts) used.set(usedKey(Math.floor(c.x / cell), Math.floor(c.y / cell)), 1);
        const full = [{ x: e.sx, y: e.sy }, ...via, { x: e.tx, y: e.ty }];
        route = { routed: true, via, pts: roundedPoints(full), label: null };
      }
    }
    out.set(e.id, route);
  }

  // labels: nearest the middle of the line that touches no card and no other label; else the least bad
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const pad = 3;
  const overlap = (r: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
    const w = Math.min(r.x + r.w, b.x + b.w + pad) - Math.max(r.x, b.x - pad);
    const h = Math.min(r.y + r.h, b.y + b.h + pad) - Math.max(r.y, b.y - pad);
    return w > 0 && h > 0 ? w * h : 0;
  };
  for (const e of order) {
    const route = out.get(e.id)!;
    const cum = lengths(route.pts);
    const total = cum[cum.length - 1];
    if (total < 1) continue;
    const at = (t: number): { p: RPt; n: RPt } => {
      const d = t * total;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const seg = cum[i] - cum[i - 1] || 1;
      const k = Math.min(1, Math.max(0, (d - cum[i - 1]) / seg));
      const a = route.pts[i - 1], b = route.pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, n: { x: -(b.y - a.y) / len, y: (b.x - a.x) / len } };
    };
    if (!e.label) {
      // no label: the middle of the line is where a "+ label" chip, the editor or an AI marker goes
      route.label = at(0.5).p;
      continue;
    }
    const { w, h } = e.label;
    const rectAt = (p: RPt) => ({ x: p.x - w / 2, y: p.y - h / 2, w, h });
    const cost = (p: RPt) => {
      const r = rectAt(p);
      let c = 0;
      for (const b of boxes) c += overlap(r, b) * 4;
      for (const l of placed) c += overlap(r, l) * 2;
      return c;
    };
    const best = { p: null as RPt | null, c: Infinity };
    const consider = (p: RPt): boolean => {
      const c = cost(p);
      if (c < best.c) { best.p = p; best.c = c; }
      return c === 0;
    };
    let done = false;
    for (const t of LABEL_T) if (consider(at(t).p)) { done = true; break; }
    if (!done) {
      // no free spot on the line: beside it, one row or two away
      outer: for (const row of [h / 2 + 8, h * 1.5 + 10]) {
        for (const t of LABEL_T) {
          const { p, n } = at(t);
          for (const s of [1, -1]) if (consider({ x: p.x + n.x * row * s, y: p.y + n.y * row * s })) break outer;
        }
      }
    }
    const pick = best.p ?? at(0.5).p;
    // the label sits IN the line: the connection runs into its near end and carries on from its far end (a label that
    // had to leave the line takes the line with it). On a steep stretch a label that is on the line already covers it.
    let near = Infinity, seg = 1;
    for (let i = 1; i < route.pts.length; i++) {
      const d = segDist(pick, route.pts[i - 1], route.pts[i]);
      if (d < near) { near = d; seg = i; }
    }
    const tx = route.pts[seg].x - route.pts[seg - 1].x, ty = route.pts[seg].y - route.pts[seg - 1].y;
    const horiz = Math.abs(tx) >= Math.abs(ty);
    if (horiz || near > 2) {
      const sign = (horiz ? tx : ty) >= 0 ? 1 : -1;
      const reach = (horiz ? w : h) / 2 + LEAD;
      const p1: RPt = horiz ? { x: pick.x - sign * reach, y: pick.y, r: LEAD } : { x: pick.x, y: pick.y - sign * reach, r: LEAD };
      const p2: RPt = horiz ? { x: pick.x + sign * reach, y: pick.y, r: LEAD } : { x: pick.x, y: pick.y + sign * reach, r: LEAD };
      const src = { x: e.sx, y: e.sy }, tgt = { x: e.tx, y: e.ty };
      const oldLen = total;
      const fits = (pts: RPt[]) => {
        const c = lengths(pts);
        return c[c.length - 1] <= oldLen * 1.15 + 60 && !blocked(pts, boxes, 4, 30);
      };
      let done = false;
      if (!route.routed && horiz && sign > 0) {
        // a plain curve stays a curve: two halves with level ends, the label between them
        const inl = inlineBezier(src, p1, p2, tgt);
        if (fits(inl.pts)) {
          route.inline = { enter: p1, leave: p2 };
          route.pts = inl.pts;
          done = true;
        }
      }
      if (!done) {
        const { a, b } = ends.get(e.id)!;
        const base = [src, ...(route.routed ? route.via : [a, b]), tgt];
        // into the near end and out of the far end; a label too wide for its stretch (or a steep one that is off the line) is only passed through
        for (const through of [[p1, p2], [pick]]) {
          if (through.length === 1 && near <= 2) break;
          const full = spliceThrough(base, through);
          if (!full) continue;
          const pts = roundedPoints(full);
          if (fits(pts)) {
            route.routed = true;
            route.inline = null;
            route.via = full.slice(1, -1);
            route.pts = pts;
            break;
          }
        }
      }
    }
    route.label = pick;
    placed.push(rectAt(pick));
  }
  return out;
}
