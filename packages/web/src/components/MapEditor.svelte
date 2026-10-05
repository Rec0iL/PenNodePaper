<script lang="ts">
  // Map editor: draw battle maps (grid floor plans) and region maps (vector sketches),
  // then paint them with the image model. Edits go through the SAME applyOps the AI's
  // edit_map uses, so the GM and the AI can work on one map at the same time.
  import { onMount, untrack } from 'svelte';
  import {
    DOOR_KINDS, FLOORS, PROP_KINDS, TERRAINS, applyOps, canon, derivedWalls, groupProps, imageSize, renderSvg,
    type DoorKind, type MapDoc, type MapOp, type PropKind, type TerrainKind,
  } from '@pnp/shared';
  import { app, cmd, say, sendChat } from '../lib/app.svelte';

  let { mapId, onclose }: { mapId: string; onclose: () => void } = $props();

  type Tool = 'paint' | 'rect' | 'erase' | 'door' | 'wall' | 'prop' | 'label' | 'token' | 'polygon' | 'path' | 'brush' | 'pin' | 'ellipse' | 'select';
  type Pt = [number, number];

  let doc = $state<MapDoc | null>(null);
  let nodeId = $state<string | null>(null);
  let status = $state('');
  let dirty = false;
  let saveTimer: ReturnType<typeof setTimeout>;

  // tool state
  let tool = $state<Tool>('rect');
  let floor = $state('s');
  let propKind = $state<PropKind>('table');
  let propFlip = $state(false);
  let doorKind = $state<DoorKind>('door');
  let tokenKind = $state<'pc' | 'npc' | 'enemy'>('enemy');
  let terrain = $state<TerrainKind>('forest');
  let brush = $state(50);
  let autoWalls = $state(true);
  let view = $state<'plan' | 'control' | 'terrain' | 'painted'>('plan');
  let shownRender = $state<string | null>(null);
  let panel = $state<'render' | 'map'>('render');

  const battle = $derived(doc?.kind === 'battle');
  // how this computer paints battle maps (Settings → Map painting): quick = one pass, staged = precise, two steps
  interface PaintInfo { mode: 'quick' | 'staged'; groups: number; quickSeconds: number; terrainSeconds: number; propsSeconds: number; measured: boolean }
  let paint = $state<PaintInfo | null>(null);
  const staged = $derived(battle && paint?.mode === 'staged');
  const dim = $derived(doc ? imageSize(doc) : { w: 1, h: 1, cell: 1 });
  const svgStr = $derived(doc && view !== 'painted' && view !== 'terrain' ? renderSvg(doc, view === 'control' ? (staged ? 'terrain' : 'control') : 'preview') : '');
  const node = $derived(nodeId ? app.nodes[nodeId] : undefined);

  // ---- load / save --------------------------------------------------------------------
  onMount(() => {
    void (async () => {
      const r = await fetch(`/api/maps/${encodeURIComponent(mapId)}`);
      if (!r.ok) {
        say('Could not load the map');
        return onclose();
      }
      const j = await r.json();
      doc = j.map;
      nodeId = j.nodeId;
      tool = doc!.kind === 'battle' ? 'rect' : 'polygon';
      queueMicrotask(fit);
      void loadPaint();
    })();
    return () => clearTimeout(saveTimer);
  });

  function touch() {
    dirty = true;
    status = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }

  async function save() {
    if (!doc || !dirty) return;
    dirty = false;
    const r = await fetch(`/api/maps/${encodeURIComponent(mapId)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify($state.snapshot(doc)) });
    status = r.ok ? '✓ Saved automatically' : '⚠ save failed';
    if (!r.ok) say('Could not save the map');
  }

  async function close() {
    clearTimeout(saveTimer);
    await save();
    onclose();
  }

  // ---- undo / redo (editor-local snapshots) ---------------------------------------------
  let undoStack: string[] = [];
  let redoStack: string[] = [];
  let canUndo = $state(false);
  let canRedo = $state(false);
  const snap = () => JSON.stringify($state.snapshot(doc));
  function pushUndo() {
    undoStack.push(snap());
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
    canUndo = true;
    canRedo = false;
  }
  function undo() {
    const s = undoStack.pop();
    if (!s || !doc) return;
    redoStack.push(snap());
    doc = JSON.parse(s);
    canUndo = undoStack.length > 0;
    canRedo = true;
    touch();
  }
  function redo() {
    const s = redoStack.pop();
    if (!s || !doc) return;
    undoStack.push(snap());
    doc = JSON.parse(s);
    canUndo = true;
    canRedo = redoStack.length > 0;
    touch();
  }

  function edit(ops: MapOp[], snapshot = true): boolean {
    if (!doc) return false;
    if (snapshot) pushUndo();
    try {
      applyOps(doc, ops);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
      if (snapshot) undo();
      return false;
    }
    touch();
    return true;
  }

  // ---- live AI edits ---------------------------------------------------------------------
  let fresh = $state<{ cells: Set<string>; rects: { x: number; y: number; w: number; h: number }[] }>({ cells: new Set(), rects: [] });
  let freshTimer: ReturnType<typeof setTimeout>;

  $effect(() => {
    const ev = app.mapEvent;
    if (!ev) return;
    untrack(() => {
      if (!doc || ev.map.id !== doc.id) return;
      if (ev.actor === 'user') {
        // the GM's own edit: keep the local plan, but take what jobs and commands changed on the server (painted results, terrains)
        doc.renders = ev.map.renders;
        doc.terrains = ev.map.terrains;
        doc.terrainPick = ev.map.terrainPick;
        doc.paintPrompt = ev.map.paintPrompt;
        return;
      }
      clearTimeout(saveTimer);
      dirty = false;
      markFresh(doc, ev.map);
      doc = JSON.parse(JSON.stringify(ev.map));
      status = `${ev.actor === 'agy' ? 'agy' : 'Claude'} edited the map`;
      void loadPaint();
    });
  });

  function markFresh(a: MapDoc, b: MapDoc) {
    const cells = new Set<string>();
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    for (let y = 0; y < b.grid.rows; y++)
      for (let x = 0; x < b.grid.cols; x++) if ((a.rows[y]?.[x] ?? '.') !== (b.rows[y]?.[x] ?? '.')) cells.add(`${x},${y}`);
    const had = new Set(a.props.map((p) => p.id));
    for (const p of b.props) if (!had.has(p.id)) rects.push({ x: p.x, y: p.y, w: p.w ?? 1, h: p.h ?? 1 });
    const hadDoor = new Set(a.doors.map((d) => `${d.x},${d.y},${d.side}`));
    for (const d of b.doors) if (!hadDoor.has(`${d.x},${d.y},${d.side}`)) rects.push(d.side === 'n' ? { x: d.x, y: d.y - 0.2, w: 1, h: 0.4 } : { x: d.x - 0.2, y: d.y, w: 0.4, h: 1 });
    const hadShape = new Set(a.shapes.map((s) => s.id));
    for (const s of b.shapes) if (!hadShape.has(s.id) && s.points.length) {
      const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1]);
      rects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) || 20, h: Math.max(...ys) - Math.min(...ys) || 20 });
    }
    fresh = { cells, rects };
    clearTimeout(freshTimer);
    freshTimer = setTimeout(() => (fresh = { cells: new Set(), rects: [] }), 3000);
  }

  // ---- viewport (zoom / pan) -------------------------------------------------------------
  let vp: HTMLDivElement;
  let stage = $state<HTMLDivElement>();
  let k = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  let spaceDown = $state(false);
  let panning = $state<{ x: number; y: number; tx: number; ty: number } | null>(null);

  function fit() {
    if (!vp || !doc) return;
    const r = vp.getBoundingClientRect();
    k = Math.min((r.width - 40) / dim.w, (r.height - 40) / dim.h, 2);
    tx = (r.width - dim.w * k) / 2;
    ty = (r.height - dim.h * k) / 2;
  }

  function onwheel(e: WheelEvent) {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const nk = Math.max(0.15, Math.min(6, k * Math.pow(1.0015, -e.deltaY)));
    tx = mx - ((mx - tx) / k) * nk;
    ty = my - ((my - ty) / k) * nk;
    k = nk;
  }

  // ---- pointer -> map coordinates -----------------------------------------------------------
  function local(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = stage!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * dim.w, y: ((e.clientY - r.top) / r.height) * dim.h };
  }
  const cellOf = (p: { x: number; y: number }) => ({ x: Math.floor(p.x / dim.cell), y: Math.floor(p.y / dim.cell), fx: p.x / dim.cell - Math.floor(p.x / dim.cell), fy: p.y / dim.cell - Math.floor(p.y / dim.cell) });
  const inGrid = (c: { x: number; y: number }) => !!doc && c.x >= 0 && c.y >= 0 && c.x < doc.grid.cols && c.y < doc.grid.rows;

  /** nearest cell border, if the pointer is close to one */
  function edgeOf(p: { x: number; y: number }): { x: number; y: number; side: 'n' | 'w' } | null {
    if (!doc) return null;
    const gx = p.x / dim.cell, gy = p.y / dim.cell;
    const rx = Math.round(gx), ry = Math.round(gy);
    const dx = Math.abs(gx - rx), dy = Math.abs(gy - ry);
    if (Math.min(dx, dy) > 0.28) return null;
    // vertical border (x = rx) -> a 'w' edge of cell (rx, floor(gy)); horizontal border -> 'n' edge of (floor(gx), ry)
    const e = dx < dy ? { x: rx, y: Math.floor(gy), side: 'w' as const } : { x: Math.floor(gx), y: ry, side: 'n' as const };
    return e.x >= 0 && e.y >= 0 && e.x <= doc.grid.cols && e.y <= doc.grid.rows ? e : null;
  }

  // ---- interaction ---------------------------------------------------------------------------
  let hover = $state<{ x: number; y: number; edge: { x: number; y: number; side: 'n' | 'w' } | null } | null>(null);
  let drag = $state<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  let pending = $state<Pt[]>([]);
  let strokePts = $state<Pt[]>([]);
  let painting = $state(false);
  let lastCell = '';
  let selected = $state<string | null>(null);

  // select tool (battle maps): one thing or a rectangle of cells; drag to move (Alt = copy), arrows nudge, Delete removes
  type Sel =
    | { t: 'prop'; id: string }
    | { t: 'token'; x: number; y: number }
    | { t: 'label'; x: number; y: number }
    | { t: 'door'; x: number; y: number; side: 'n' | 'w' }
    | { t: 'area'; x: number; y: number; w: number; h: number };
  let sel = $state<Sel | null>(null);
  let moving = $state<{ from: { x: number; y: number }; dx: number; dy: number; copy: boolean } | null>(null);
  let shapeMove = $state<{ from: { x: number; y: number }; dx: number; dy: number } | null>(null);
  const rid = (kind: string) => `${kind}-${Math.random().toString(36).slice(2, 6)}`;

  const selProp = $derived(sel?.t === 'prop' && doc ? doc.props.find((p) => p.id === (sel as { id: string }).id) : undefined);
  const selToken = $derived(sel?.t === 'token' && doc ? doc.tokens.find((t) => t.x === (sel as { x: number }).x && t.y === (sel as { y: number }).y) : undefined);
  const selLabel = $derived(sel?.t === 'label' && doc ? doc.labels.find((l) => Math.hypot(l.x - (sel as { x: number }).x, l.y - (sel as { y: number }).y) < 0.01) : undefined);
  const selDoor = $derived(sel?.t === 'door' && doc ? doc.doors.find((d) => d.x === (sel as { x: number }).x && d.y === (sel as { y: number }).y && d.side === (sel as { side: string }).side) : undefined);
  const selShape = $derived(selected && doc ? doc.shapes.find((s) => s.id === selected) : undefined);

  function hitItem(p: { x: number; y: number }, c: { x: number; y: number }): Sel | null {
    if (!doc) return null;
    const tok = doc.tokens.find((t) => t.x === c.x && t.y === c.y);
    if (tok) return { t: 'token', x: tok.x, y: tok.y };
    const prop = [...doc.props].reverse().find((q) => c.x >= q.x && c.x < q.x + (q.w ?? 1) && c.y >= q.y && c.y < q.y + (q.h ?? 1));
    if (prop) return { t: 'prop', id: prop.id };
    const gx = p.x / dim.cell, gy = p.y / dim.cell;
    const lab = doc.labels.find((l) => Math.abs(l.x - gx) < Math.max(0.8, l.text.length * 0.17) && Math.abs(l.y - gy) < 0.45);
    if (lab) return { t: 'label', x: lab.x, y: lab.y };
    const ed = edgeOf(p);
    if (ed && doc.doors.some((d) => d.x === ed.x && d.y === ed.y && d.side === ed.side)) return { t: 'door', ...ed };
    return null;
  }

  const inArea = (c: { x: number; y: number }, a: { x: number; y: number; w: number; h: number }) => c.x >= a.x && c.x < a.x + a.w && c.y >= a.y && c.y < a.y + a.h;

  /** The selection's box in cells (for highlighting and moving). */
  function selBox(s: Sel | null): { x: number; y: number; w: number; h: number } | null {
    if (!s || !doc) return null;
    if (s.t === 'area') return s;
    if (s.t === 'prop') return selProp ? { x: selProp.x, y: selProp.y, w: selProp.w ?? 1, h: selProp.h ?? 1 } : null;
    if (s.t === 'token') return { x: s.x, y: s.y, w: 1, h: 1 };
    if (s.t === 'label') return { x: Math.floor(s.x - 0.5), y: Math.floor(s.y - 0.5), w: Math.max(1, Math.ceil((selLabel?.text.length ?? 4) * 0.34)), h: 1 };
    return null;
  }

  /** Shift the selection by dx,dy cells (drag, arrow keys); copy = leave the original behind. */
  function shiftSel(dx: number, dy: number, copy = false): boolean {
    if (!doc || !sel || (!dx && !dy)) return false;
    const s = sel;
    if (s.t === 'area') {
      if (!edit([{ op: 'move_area', x: s.x, y: s.y, w: s.w, h: s.h, dx, dy, copy }])) return false;
      sel = { ...s, x: s.x + dx, y: s.y + dy };
    } else if (s.t === 'prop' && selProp) {
      const p = selProp;
      if (copy) {
        const id = rid(p.kind);
        if (!edit([{ op: 'prop', kind: p.kind, x: p.x + dx, y: p.y + dy, w: p.w, h: p.h, rot: p.rot, label: p.label, id }])) return false;
        sel = { t: 'prop', id };
      } else if (!edit([{ op: 'edit_prop', id: p.id, x: p.x + dx, y: p.y + dy }])) return false;
    } else if (s.t === 'token' && selToken) {
      const { x: tx0, y: ty0, kind, label } = selToken; // plain values: the edit below changes the token in place
      if (copy) {
        if (!edit([{ op: 'token', x: tx0 + dx, y: ty0 + dy, kind, label }])) return false;
      } else if (!edit([{ op: 'edit_token', x: tx0, y: ty0, to: [tx0 + dx, ty0 + dy] }])) return false;
      sel = { t: 'token', x: tx0 + dx, y: ty0 + dy };
    } else if (s.t === 'label' && selLabel) {
      const { x: lx0, y: ly0, text } = selLabel;
      if (copy) {
        if (!edit([{ op: 'label', x: lx0 + dx, y: ly0 + dy, text }])) return false;
      } else if (!edit([{ op: 'edit_label', x: lx0, y: ly0, to: [lx0 + dx, ly0 + dy] }])) return false;
      sel = { t: 'label', x: lx0 + dx, y: ly0 + dy };
    } else return false;
    return true;
  }

  function deleteSel() {
    if (!doc || !sel) return;
    const s = sel;
    const ops: MapOp[] = [];
    if (s.t === 'prop') ops.push({ op: 'remove_prop', id: s.id });
    else if (s.t === 'token') ops.push({ op: 'remove_token', x: s.x, y: s.y });
    else if (s.t === 'label') ops.push({ op: 'remove_label', x: s.x, y: s.y });
    else if (s.t === 'door') ops.push({ op: 'remove_door', x: s.x, y: s.y, side: s.side });
    else {
      ops.push({ op: 'clear', x: s.x, y: s.y, w: s.w, h: s.h });
      for (const t of doc.tokens) if (inArea(t, s)) ops.push({ op: 'remove_token', x: t.x, y: t.y });
      for (const l of doc.labels) if (inArea({ x: Math.floor(l.x), y: Math.floor(l.y) }, s)) ops.push({ op: 'remove_label', x: l.x, y: l.y });
    }
    if (edit(ops)) sel = null;
  }

  function duplicateSel() {
    if (!doc || !sel) return;
    if (sel.t === 'area') {
      const a = sel;
      const fitsRight = a.x + a.w * 2 <= doc.grid.cols, fitsDown = a.y + a.h * 2 <= doc.grid.rows;
      shiftSel(fitsRight ? a.w : 1, fitsRight ? 0 : fitsDown ? a.h : 1, true);
    } else shiftSel(1, 1, true);
  }

  function fillSel(floorName: string) {
    if (sel?.t !== 'area') return;
    const { x, y, w, h } = sel;
    edit([autoWalls ? { op: 'room', x, y, w, h, floor: floorName } : { op: 'fill', x, y, w, h, floor: floorName }]);
  }

  function rotateSel() {
    if (!selProp) return;
    edit([{ op: 'edit_prop', id: selProp.id, w: selProp.h ?? 1, h: selProp.w ?? 1 }]);
  }

  const moveBox = $derived.by(() => {
    const b = selBox(sel);
    return b && moving && (moving.dx || moving.dy) ? { ...b, x: b.x + moving.dx, y: b.y + moving.dy } : null;
  });

  // region maps: move / restyle the selected shape
  function translateShape(s: NonNullable<typeof selShape>, dx: number, dy: number): Pt[] {
    if (s.type === 'ellipse') return [[s.points[0][0] + dx, s.points[0][1] + dy], ...s.points.slice(1)] as Pt[];
    return s.points.map(([x, y]) => [x + dx, y + dy] as Pt);
  }
  function reshape(patch: Partial<{ kind: TerrainKind; label: string }>, copy = false) {
    if (!selShape) return;
    const s = selShape;
    const id = copy ? rid(s.kind) : s.id;
    const pts = copy ? translateShape(s, 24, 24) : s.points;
    if (edit([{ op: 'shape', type: s.type, kind: patch.kind ?? s.kind, points: pts, r: s.r, width: s.width, label: patch.label ?? s.label, id }])) selected = id;
  }
  let pointerPos = $state<{ x: number; y: number } | null>(null);

  const PROP_SIZE: Partial<Record<PropKind, [number, number]>> = { table: [2, 1], bed: [1, 2], stairs_up: [2, 1], stairs_down: [2, 1], bookshelf: [2, 1], fireplace: [2, 1], boat: [1, 3], chest: [1, 1], altar: [1, 1] };

  function paintCell(c: { x: number; y: number }, erase: boolean) {
    const key = `${c.x},${c.y}`;
    if (key === lastCell || !inGrid(c)) return;
    lastCell = key;
    edit([erase ? { op: 'clear', x: c.x, y: c.y, w: 1, h: 1 } : { op: 'fill', x: c.x, y: c.y, w: 1, h: 1, floor }], false);
  }

  function onpointerdown(e: PointerEvent) {
    if (!doc) return;
    if (e.button === 1 || e.button === 2 || spaceDown) {
      panning = { x: e.clientX, y: e.clientY, tx, ty };
      vp.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = local(e);
    pointerPos = p;
    vp.setPointerCapture(e.pointerId);

    if (battle) {
      const c = cellOf(p);
      if (tool === 'paint' || tool === 'erase') {
        pushUndo();
        painting = true;
        lastCell = '';
        paintCell(c, tool === 'erase');
      } else if (tool === 'rect') {
        drag = { a: p, b: p };
      } else if (tool === 'door') {
        const ed = edgeOf(p);
        if (!ed) return say('Click close to a cell border to place a door');
        const had = doc.doors.some((d) => d.x === ed.x && d.y === ed.y && d.side === ed.side);
        edit([had ? { op: 'remove_door', ...ed } : { op: 'door', ...ed, kind: doorKind }]);
      } else if (tool === 'wall') {
        const ed = edgeOf(p);
        if (!ed) return say('Click close to a cell border');
        const seg = ed.side === 'n' ? `${ed.x},${ed.y},${ed.x + 1},${ed.y}` : `${ed.x},${ed.y},${ed.x},${ed.y + 1}`;
        const exists = derivedWalls(doc).some((s) => `${s.x1},${s.y1},${s.x2},${s.y2}` === seg);
        const inner = doc.walls.some((w) => w.x === ed.x && w.y === ed.y && w.side === ed.side);
        if (exists && !inner) return say('Outer walls follow the floor — erase floor to remove them');
        edit([exists ? { op: 'open', ...ed } : { op: 'wall', ...ed }]);
      } else if (tool === 'prop') {
        if (!inGrid(c)) return;
        const hit = doc.props.find((q) => c.x >= q.x && c.x < q.x + (q.w ?? 1) && c.y >= q.y && c.y < q.y + (q.h ?? 1));
        if (hit) return void edit([{ op: 'remove_prop', id: hit.id }]);
        const [w, h] = PROP_SIZE[propKind] ?? [1, 1];
        const [fw, fh] = propFlip ? [h, w] : [w, h];
        edit([{ op: 'prop', kind: propKind, x: Math.min(c.x, doc.grid.cols - fw), y: Math.min(c.y, doc.grid.rows - fh), w: fw, h: fh }]);
      } else if (tool === 'label') {
        if (!inGrid(c)) return;
        const near = doc.labels.find((l) => Math.hypot(l.x - (c.x + 0.5), l.y - (c.y + 0.5)) < 1.2);
        const text = prompt('Label (leave empty to remove)', near?.text ?? '');
        if (text === null) return;
        const ops: MapOp[] = near ? [{ op: 'remove_label', x: near.x, y: near.y }] : [];
        if (text.trim()) ops.push({ op: 'label', x: c.x + 0.5, y: c.y + 0.5, text: text.trim() });
        if (ops.length) edit(ops);
      } else if (tool === 'select') {
        if (!inGrid(c)) { sel = null; return; }
        if (sel?.t === 'area' && inArea(c, sel)) { moving = { from: c, dx: 0, dy: 0, copy: e.altKey }; return; }
        const hit = hitItem(p, c);
        if (hit) {
          sel = hit;
          if (hit.t !== 'door') moving = { from: c, dx: 0, dy: 0, copy: e.altKey };
          return;
        }
        sel = null;
        drag = { a: p, b: p };
      } else if (tool === 'token') {
        if (!inGrid(c)) return;
        if (doc.tokens.some((t) => t.x === c.x && t.y === c.y)) return void edit([{ op: 'remove_token', x: c.x, y: c.y }]);
        const n = doc.tokens.filter((t) => t.kind === tokenKind).length + 1;
        edit([{ op: 'token', x: c.x, y: c.y, kind: tokenKind, label: `${{ pc: 'P', npc: 'N', enemy: 'E' }[tokenKind]}${n}` }]);
      }
      return;
    }

    // region tools
    const pt: Pt = [Math.round(p.x), Math.round(p.y)];
    if (tool === 'polygon' || tool === 'path') pending = [...pending, pt];
    else if (tool === 'brush') {
      pushUndo();
      strokePts = [pt];
      painting = true;
    } else if (tool === 'ellipse') drag = { a: p, b: p };
    else if (tool === 'pin') {
      const label = prompt('Name (optional)', '') ?? null;
      if (label === null) return;
      edit([{ op: 'shape', type: 'pin', kind: pinKind, points: [pt], label: label.trim() || undefined }]);
    } else if (tool === 'select') {
      selected = hitShape(p);
      if (selected) shapeMove = { from: p, dx: 0, dy: 0 };
    }
  }

  let pinKind = $state<TerrainKind>('city');

  function onpointermove(e: PointerEvent) {
    if (panning) {
      tx = panning.tx + (e.clientX - panning.x);
      ty = panning.ty + (e.clientY - panning.y);
      return;
    }
    if (!doc) return;
    const p = local(e);
    pointerPos = p;
    if (battle) {
      const c = cellOf(p);
      hover = { x: c.x, y: c.y, edge: tool === 'door' || tool === 'wall' ? edgeOf(p) : null };
      if (painting && (tool === 'paint' || tool === 'erase')) paintCell(c, tool === 'erase');
    }
    if (moving && battle) {
      const c = cellOf(p);
      moving = { ...moving, dx: c.x - moving.from.x, dy: c.y - moving.from.y, copy: moving.copy || e.altKey };
    }
    if (shapeMove) shapeMove = { ...shapeMove, dx: Math.round(p.x - shapeMove.from.x), dy: Math.round(p.y - shapeMove.from.y) };
    if (drag) drag = { ...drag, b: p };
    if (painting && tool === 'brush') {
      const last = strokePts[strokePts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) >= 6) strokePts = [...strokePts, [Math.round(p.x), Math.round(p.y)]];
    }
  }

  function onpointerup(e: PointerEvent) {
    if (panning) {
      panning = null;
      return;
    }
    if (!doc) return;
    vp.releasePointerCapture?.(e.pointerId);
    if (moving) {
      const mv = moving;
      moving = null;
      if (mv.dx || mv.dy) shiftSel(mv.dx, mv.dy, mv.copy || e.altKey);
    }
    if (shapeMove) {
      const sm = shapeMove;
      shapeMove = null;
      if ((sm.dx || sm.dy) && selShape) {
        const s = selShape;
        edit([{ op: 'shape', type: s.type, kind: s.kind, points: translateShape(s, sm.dx, sm.dy), r: s.r, width: s.width, label: s.label, id: s.id }]);
      }
    }
    if (painting) {
      painting = false;
      if (tool === 'brush' && strokePts.length >= 1) {
        const pts = strokePts.length === 1 ? [strokePts[0], [strokePts[0][0] + 1, strokePts[0][1]] as Pt] : strokePts;
        edit([{ op: 'shape', type: 'path', kind: terrain, points: pts, width: brush }], false);
      }
      strokePts = [];
    }
    if (drag) {
      const d = drag;
      drag = null;
      if (battle && tool === 'rect') {
        const a = cellOf(d.a), b = cellOf(d.b);
        const x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y));
        const x1 = Math.min(doc.grid.cols - 1, Math.max(a.x, b.x)), y1 = Math.min(doc.grid.rows - 1, Math.max(a.y, b.y));
        if (x1 >= x0 && y1 >= y0) edit([autoWalls ? { op: 'room', x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, floor: FLOORS[floor as keyof typeof FLOORS].name } : { op: 'fill', x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, floor: FLOORS[floor as keyof typeof FLOORS].name }]);
      } else if (battle && tool === 'select') {
        const a = cellOf(d.a), b = cellOf(d.b);
        const x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y));
        const x1 = Math.min(doc.grid.cols - 1, Math.max(a.x, b.x)), y1 = Math.min(doc.grid.rows - 1, Math.max(a.y, b.y));
        if (x1 >= x0 && y1 >= y0) sel = { t: 'area', x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      } else if (!battle && tool === 'ellipse') {
        const rx = Math.abs(d.b.x - d.a.x), ry = Math.abs(d.b.y - d.a.y);
        if (rx > 4 && ry > 4) edit([{ op: 'shape', type: 'ellipse', kind: terrain, points: [[Math.round(d.a.x), Math.round(d.a.y)], [Math.round(rx), Math.round(ry)]] }]);
      }
    }
  }

  function finishPending() {
    if (!pending.length) return;
    const need = tool === 'polygon' ? 3 : 2;
    if (pending.length >= need) edit([{ op: 'shape', type: tool === 'polygon' ? 'polygon' : 'path', kind: terrain, points: pending }]);
    pending = [];
  }

  function ondblclick() {
    if (!battle && (tool === 'polygon' || tool === 'path')) {
      pending = pending.slice(0, -1); // the second click of the double-click added a duplicate point
      finishPending();
    }
  }

  function hitShape(p: { x: number; y: number }): string | null {
    if (!doc) return null;
    for (const s of [...doc.shapes].reverse()) {
      if (s.type === 'pin') {
        if (Math.hypot(p.x - s.points[0][0], p.y - s.points[0][1]) < (s.r ?? 14) + 6) return s.id;
      } else if (s.type === 'ellipse') {
        const [cx, cy] = s.points[0], [rx, ry] = s.points[1] ?? [30, 30];
        if (((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1) return s.id;
      } else if (s.type === 'polygon') {
        let inside = false;
        for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
          const [xi, yi] = s.points[i], [xj, yj] = s.points[j];
          if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) return s.id;
      } else {
        const w = Math.max((s.width ?? 12) / 2, 8);
        for (let i = 1; i < s.points.length; i++) {
          const [x1, y1] = s.points[i - 1], [x2, y2] = s.points[i];
          const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
          const t = Math.max(0, Math.min(1, ((p.x - x1) * (x2 - x1) + (p.y - y1) * (y2 - y1)) / l2));
          if (Math.hypot(p.x - (x1 + t * (x2 - x1)), p.y - (y1 + t * (y2 - y1))) <= w) return s.id;
        }
      }
    }
    return null;
  }

  // ---- keyboard ------------------------------------------------------------------------------------
  function onkeydown(e: KeyboardEvent) {
    if (app.settingsOpen) return; // Settings is open on top of the editor
    const el = e.target as HTMLElement;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    if (e.key === ' ' && !typing) {
      spaceDown = true;
      e.preventDefault();
    }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (e.key === 'Escape') {
      if (pending.length || drag || selected || sel || moving) {
        pending = [];
        drag = null;
        selected = null;
        sel = null;
        moving = null;
      } else void close();
    } else if (e.key === 'Enter') finishPending();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && (selected || sel)) {
      if (selected) {
        edit([{ op: 'remove_shape', id: selected }]);
        selected = null;
      } else deleteSel();
    } else if (tool === 'select' && battle && sel && e.key.startsWith('Arrow')) {
      e.preventDefault();
      shiftSel(e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && (sel || selected)) {
      e.preventDefault();
      if (selected) reshape({}, true); else duplicateSel();
    } else if (e.key.toLowerCase() === 'r' && tool === 'select' && selProp) rotateSel();
    else if (e.key.toLowerCase() === 'r' && tool === 'prop') propFlip = !propFlip;
  }
  const onkeyup = (e: KeyboardEvent) => {
    if (e.key === ' ') spaceDown = false;
  };

  // ---- map settings -----------------------------------------------------------------------------------
  function resize(cols: number, rows: number) {
    if (doc && (cols !== doc.grid.cols || rows !== doc.grid.rows)) {
      edit([{ op: 'resize', cols, rows }]);
      queueMicrotask(fit);
    }
  }
  function setSize(w: number, h: number) {
    if (!doc) return;
    pushUndo();
    doc.size = { w, h };
    touch();
    queueMicrotask(fit);
  }
  function setBackground(bg: TerrainKind) {
    if (!doc) return;
    pushUndo();
    doc.background = bg;
    touch();
  }
  function rename(name: string) {
    if (!doc || !name.trim()) return;
    doc.name = name.trim();
    touch();
  }

  // ---- painting ------------------------------------------------------------------------------------------
  // quick: one img2img pass. precise (Settings → Map painting): ① the empty terrain, you pick one, ② every prop group painted into its spot.
  let showGroups = $state(false);
  const groups = $derived(doc && battle ? groupProps(doc) : []);

  async function loadPaint() {
    if (!doc) return;
    await save(); // the estimate counts the props of the saved plan
    const r = await fetch(`/api/maps/${encodeURIComponent(mapId)}/paint`);
    if (r.ok) paint = await r.json();
  }
  const dur = (s: number) => (s < 90 ? `about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : s < 5400 ? `about ${Math.round(s / 60)} min` : `about ${(s / 3600).toFixed(1)} hours`);

  let prompt_ = $state('');
  let promptTouched = $state(false);
  let fidelity = $state<'faithful' | 'balanced' | 'painterly'>('balanced');
  let variants = $state(1);
  $effect(() => {
    if (!promptTouched && node) prompt_ = [node.title, node.summary].filter(Boolean).join('. ');
  });
  const jobs = $derived(app.jobs.filter((j) => j.kind === 'map' && j.nodeId === nodeId && (j.status === 'queued' || j.status === 'running' || j.status === 'error')).slice(-4));
  const busy = $derived(jobs.some((j) => j.status === 'queued' || j.status === 'running'));
  // a finished job changes the estimate (it now knows this computer's speed) and may add a picture
  let doneCount = 0;
  $effect(() => {
    const n = app.jobs.filter((j) => j.kind === 'map' && j.nodeId === nodeId && j.status === 'done').length;
    untrack(() => {
      if (n !== doneCount) {
        doneCount = n;
        void loadPaint();
      }
    });
  });

  // the mode is changed in Settings (which can be opened from here): re-read it when that window closes
  let settingsWasOpen = false;
  $effect(() => {
    const open = app.settingsOpen;
    untrack(() => {
      if (settingsWasOpen && !open) void loadPaint();
      settingsWasOpen = open;
    });
  });

  const aiArgs = () => ({ backend: app.backend, model: app.models[app.backend] || undefined });

  /** quick: the whole picture. precise: step 1, the empty terrain (the server decides by the setting). */
  async function renderNow() {
    await save();
    const r = await cmd('render_map', { mapId, prompt: prompt_, fidelity, variants, ...aiArgs() });
    if (r) promptTouched = true;
  }
  async function pickTerrain(f: string) {
    if (!doc) return;
    doc.terrainPick = f;
    await cmd('set_map_terrain', { mapId, file: f });
    view = 'terrain';
  }
  async function paintProps() {
    await save();
    const r = await cmd('paint_map_props', { mapId, prompt: prompt_, variants: 1, ...aiArgs() });
    if (r) promptTouched = true;
  }
  async function acceptTerrain() {
    const r = await cmd('accept_map_terrain', { mapId });
    if (r) {
      say('Terrain accepted as the finished picture', 'ok');
      view = 'painted';
    }
  }
  function askAi() {
    if (!nodeId) return;
    void sendChat(
      staged
        ? `Write a vivid description of the place for the map "${doc?.name}" (read it with get_map; materials, mood and lighting — not the layout, no furniture), then call render_map with fidelity "${fidelity}" and ${variants} variant${variants > 1 ? 's' : ''}. This only paints the empty terrain: tell me it takes a while, and wait for me to pick one before painting the props.`
        : `Write a vivid render prompt for the map "${doc?.name}" (read it with get_map; describe materials, mood and lighting — not the layout), then call render_map with fidelity "${fidelity}" and ${variants} variant${variants > 1 ? 's' : ''}.`,
      { nodeId },
    );
    say('Asked the AI — see the AI tab for progress');
  }
  const cancel = () => fetch('/api/images/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

  const painted = $derived(shownRender ?? doc?.renders.at(-1) ?? null);
  const FIDELITY_HINT = { faithful: 'keeps the plan exactly, flatter look', balanced: 'good mix of fidelity and painting', painterly: 'richest look, may drift from the plan' };
  const TERRAIN_HINT = { faithful: 'sticks closely to your walls and floors', balanced: 'creative, but keeps the rooms where they are', painterly: 'freest — rooms may shift a little' };

  const regionTools: { id: Tool; label: string; icon: string; tip: string }[] = [
    { id: 'polygon', label: 'Area', icon: '⬠', tip: 'Click points; Enter or double-click to finish' },
    { id: 'path', label: 'Road/River', icon: '〰', tip: 'Click points; Enter or double-click to finish' },
    { id: 'brush', label: 'Scribble', icon: '✎', tip: 'Freehand brush in the chosen terrain' },
    { id: 'ellipse', label: 'Blob', icon: '◯', tip: 'Drag from the centre outwards' },
    { id: 'pin', label: 'Place', icon: '⚑', tip: 'Town, castle, ruins…' },
    { id: 'select', label: 'Select', icon: '⇱', tip: 'Click a shape to select it; drag to move it, Delete removes it' },
  ];
  const battleTools: { id: Tool; label: string; icon: string; tip: string }[] = [
    { id: 'select', label: 'Select', icon: '⇱', tip: 'Click a prop, token, label or door — or drag a box over cells. Drag to move (Alt = copy), arrow keys nudge, Delete removes, R rotates, Ctrl+D duplicates' },
    { id: 'rect', label: 'Room', icon: '▭', tip: 'Drag a rectangle (walls are added automatically)' },
    { id: 'paint', label: 'Paint', icon: '🖌', tip: 'Paint floor cells' },
    { id: 'erase', label: 'Erase', icon: '⌫', tip: 'Remove floor' },
    { id: 'door', label: 'Door', icon: '🚪', tip: 'Click a cell border (click again to remove)' },
    { id: 'wall', label: 'Wall', icon: '▮', tip: 'Add/remove an inner wall on a cell border' },
    { id: 'prop', label: 'Prop', icon: '▣', tip: 'Place furniture (R rotates, click to remove)' },
    { id: 'label', label: 'Label', icon: 'Aa', tip: 'Room names (preview only)' },
    { id: 'token', label: 'Token', icon: '●', tip: 'Start positions (for the VTT)' },
  ];
  const pinKinds: TerrainKind[] = ['city', 'village', 'castle', 'ruins', 'port', 'cave'];
  const areaKinds = (Object.keys(TERRAINS) as TerrainKind[]).filter((t) => !pinKinds.includes(t));
</script>

<svelte:window {onkeydown} {onkeyup} />

<div class="scrim" role="presentation">
  <div class="modal" role="dialog" aria-label="Map editor">
    <header>
      <span class="logo">⌗</span>
      {#if doc}<input class="nm field" value={doc.name} onchange={(e) => rename(e.currentTarget.value)} />{/if}
      <span class="chip">{battle ? `${doc?.grid.cols}×${doc?.grid.rows} · ${doc?.grid.unit} ft/cell` : `${doc?.size.w}×${doc?.size.h}px`}</span>
      <span class="status">{status || 'Autosave on'}</span>
      <span class="grow"></span>
      <div class="seg">
        <button class:on={view === 'plan'} onclick={() => (view = 'plan')} title="Editable plan">Plan</button>
        <button class:on={view === 'control'} onclick={() => (view = 'control')} title={staged ? 'What the model receives in step 1: the empty place' : 'What the image model receives'}>{staged ? 'Terrain input' : 'Model input'}</button>
        {#if staged}<button class:on={view === 'terrain'} disabled={!doc?.terrainPick} onclick={() => (view = 'terrain')} title="The painted terrain you picked (step 1)">Terrain</button>{/if}
        <button class:on={view === 'painted'} disabled={!painted} onclick={() => (view = 'painted')} title={staged ? 'Latest finished painting (step 2)' : 'Latest painted render'}>Painted</button>
      </div>
      <button class="btn ghost" disabled={!canUndo} onclick={undo} title="Undo (Ctrl+Z)">↶</button>
      <button class="btn ghost" disabled={!canRedo} onclick={redo} title="Redo">↷</button>
      <button class="btn ghost" onclick={fit} title="Fit to window">⤢</button>
      <button class="btn" onclick={close} title="Close (Esc) — everything is already saved">Done</button>
    </header>

    <div class="body">
      <nav class="tools">
        {#each battle ? battleTools : regionTools as t}
          <button class:on={tool === t.id} title={t.tip} onclick={() => { tool = t.id; pending = []; selected = null; sel = null; moving = null; }}><i>{t.icon}</i><span>{t.label}</span></button>
        {/each}

        <div class="pal">
          {#if tool === 'select'}
            {#if battle}
              {#if !sel}
                <div class="dim">Click a prop, token, label or door, or drag a box over cells.<br />Drag to move (Alt = copy) · arrows nudge · Delete removes.</div>
              {:else if sel.t === 'prop' && selProp}
                <div class="label">Prop</div>
                <select class="field" value={selProp.kind} onchange={(e) => edit([{ op: 'edit_prop', id: selProp.id, kind: e.currentTarget.value as PropKind }])}>{#each PROP_KINDS as p}<option value={p}>{p.replace('_', ' ')}</option>{/each}</select>
                <div class="two">
                  <div><div class="label">Width</div><input class="field" type="number" min="1" max="12" value={selProp.w ?? 1} onchange={(e) => edit([{ op: 'edit_prop', id: selProp.id, w: Number(e.currentTarget.value) }])} /></div>
                  <div><div class="label">Height</div><input class="field" type="number" min="1" max="12" value={selProp.h ?? 1} onchange={(e) => edit([{ op: 'edit_prop', id: selProp.id, h: Number(e.currentTarget.value) }])} /></div>
                </div>
                <div class="label">Note</div>
                <input class="field" value={selProp.label ?? ''} placeholder="optional" onchange={(e) => edit([{ op: 'edit_prop', id: selProp.id, label: e.currentTarget.value }])} />
                <div class="acts"><button class="btn sm" onclick={rotateSel} title="R">⟳ Rotate</button><button class="btn sm" onclick={duplicateSel} title="Ctrl+D">⧉ Duplicate</button><button class="btn sm danger" onclick={deleteSel}>Delete</button></div>
              {:else if sel.t === 'token' && selToken}
                <div class="label">Token</div>
                <select class="field" value={selToken.kind} onchange={(e) => edit([{ op: 'edit_token', x: selToken.x, y: selToken.y, kind: e.currentTarget.value as 'pc' | 'npc' | 'enemy' }])}><option value="enemy">enemy</option><option value="npc">NPC</option><option value="pc">player start (test)</option></select>
                <div class="label">Name</div>
                <input class="field" value={selToken.label ?? ''} onchange={(e) => edit([{ op: 'edit_token', x: selToken.x, y: selToken.y, label: e.currentTarget.value }])} />
                <div class="acts"><button class="btn sm" onclick={duplicateSel}>⧉ Duplicate</button><button class="btn sm danger" onclick={deleteSel}>Delete</button></div>
              {:else if sel.t === 'label' && selLabel}
                <div class="label">Label</div>
                <input class="field" value={selLabel.text} onchange={(e) => edit([{ op: 'edit_label', x: selLabel.x, y: selLabel.y, text: e.currentTarget.value }])} />
                <div class="acts"><button class="btn sm danger" onclick={deleteSel}>Delete</button></div>
              {:else if sel.t === 'door' && selDoor}
                <div class="label">Door</div>
                <select class="field" value={selDoor.kind} onchange={(e) => edit([{ op: 'door', x: selDoor.x, y: selDoor.y, side: selDoor.side, kind: e.currentTarget.value as DoorKind }])}>{#each DOOR_KINDS as d}<option>{d}</option>{/each}</select>
                <div class="acts"><button class="btn sm danger" onclick={deleteSel}>Remove</button></div>
              {:else if sel.t === 'area'}
                <div class="label">{sel.w}×{sel.h} cells</div>
                <div class="dim">Drag inside the box to move it with everything on it (Alt = copy).</div>
                <div class="label">Fill with floor</div>
                <div class="sw">
                  {#each Object.entries(FLOORS) as [c, f]}
                    <button style="--c:{f.color}" title={f.name} onclick={() => fillSel(f.name)}></button>
                  {/each}
                </div>
                <label class="chk"><input type="checkbox" bind:checked={autoWalls} /> walls around it</label>
                <div class="acts"><button class="btn sm" onclick={duplicateSel} title="Ctrl+D">⧉ Duplicate</button><button class="btn sm danger" onclick={deleteSel}>Delete</button></div>
              {/if}
            {:else if !selShape}
              <div class="dim">Click a shape to select it, then drag to move it. Delete removes, Ctrl+D duplicates.</div>
            {:else}
              <div class="label">{selShape.type === 'pin' ? 'Place' : selShape.type === 'path' ? 'Road / river' : 'Area'}</div>
              <div class="sw">{#each (selShape.type === 'pin' ? pinKinds : areaKinds) as t}<button class:on={selShape.kind === t} style="--c:{TERRAINS[t]}" title={t} onclick={() => reshape({ kind: t })}></button>{/each}</div>
              <div class="dim">{selShape.kind}</div>
              <div class="label">Name</div>
              <input class="field" value={selShape.label ?? ''} placeholder="optional" onchange={(e) => reshape({ label: e.currentTarget.value })} />
              <div class="acts"><button class="btn sm" onclick={() => reshape({}, true)} title="Ctrl+D">⧉ Duplicate</button><button class="btn sm danger" onclick={() => { edit([{ op: 'remove_shape', id: selShape!.id }]); selected = null; }}>Delete</button></div>
            {/if}
          {:else if battle}
            {#if tool === 'paint' || tool === 'rect'}
              <div class="label">Floor</div>
              <div class="sw">
                {#each Object.entries(FLOORS) as [c, f]}
                  <button class:on={floor === c} style="--c:{f.color}" title={f.name} onclick={() => (floor = c)}></button>
                {/each}
              </div>
              {#if tool === 'rect'}<label class="chk"><input type="checkbox" bind:checked={autoWalls} /> walls</label>{/if}
            {:else if tool === 'door'}
              <div class="label">Door kind</div>
              <select class="field" bind:value={doorKind}>{#each DOOR_KINDS as d}<option>{d}</option>{/each}</select>
            {:else if tool === 'prop'}
              <div class="label">Prop <span class="dim">(R = rotate)</span></div>
              <select class="field" bind:value={propKind}>{#each PROP_KINDS as p}<option value={p}>{p.replace('_', ' ')}</option>{/each}</select>
            {:else if tool === 'token'}
              <div class="label">Token</div>
              <select class="field" bind:value={tokenKind}><option value="enemy">enemy</option><option value="npc">NPC</option><option value="pc">player start (test)</option></select>
              <div class="dim">Players are added in the VTT itself, so player starts are not sent unless asked for.</div>
            {/if}
          {:else if tool === 'pin'}
            <div class="label">Place</div>
            <div class="sw">{#each pinKinds as t}<button class:on={pinKind === t} style="--c:{TERRAINS[t]}" title={t} onclick={() => (pinKind = t)}></button>{/each}</div>
          {:else}
            <div class="label">Terrain</div>
            <div class="sw">{#each areaKinds as t}<button class:on={terrain === t} style="--c:{TERRAINS[t]}" title={t} onclick={() => (terrain = t)}></button>{/each}</div>
            <div class="dim">{terrain}</div>
            {#if tool === 'brush'}
              <div class="label">Brush {brush}px</div>
              <input type="range" min="8" max="140" bind:value={brush} />
            {/if}
          {/if}
        </div>
      </nav>

      <div class="vp" bind:this={vp} role="application" {onwheel} {onpointerdown} {onpointermove} {onpointerup} {ondblclick} oncontextmenu={(e) => e.preventDefault()} style="cursor:{spaceDown || panning ? 'grab' : tool === 'select' ? 'default' : 'crosshair'}">
        {#if doc}
          <div class="stage" bind:this={stage} style="width:{dim.w}px;height:{dim.h}px;transform:translate({tx}px,{ty}px) scale({k})">
            {#if view === 'painted' && painted}
              <img src={`/api/images/${painted}`} alt="painted map" draggable="false" style="width:{dim.w}px;height:{dim.h}px" />
            {:else if view === 'terrain' && doc.terrainPick}
              <img src={`/api/images/${doc.terrainPick}`} alt="painted terrain" draggable="false" style="width:{dim.w}px;height:{dim.h}px" />
            {:else}
              {@html svgStr}
            {/if}
            <svg class="ov" width={dim.w} height={dim.h} viewBox="0 0 {dim.w} {dim.h}">
              {#if battle && showGroups && (view === 'plan' || view === 'control')}
                {#each groups as g (g.id)}
                  <rect class="grp" x={g.bbox.x0 * dim.cell} y={g.bbox.y0 * dim.cell} width={(g.bbox.x1 - g.bbox.x0) * dim.cell} height={(g.bbox.y1 - g.bbox.y0) * dim.cell} rx="4" />
                  <text class="grpid" x={g.bbox.x0 * dim.cell + 3} y={g.bbox.y0 * dim.cell + 13}>{g.id.slice(1)}</text>
                {/each}
              {/if}
              {#if battle && view === 'plan'}
                {#each [...fresh.cells] as c}
                  {@const [cx, cy] = c.split(',').map(Number)}
                  <rect class="fresh" x={cx * dim.cell} y={cy * dim.cell} width={dim.cell} height={dim.cell} />
                {/each}
                {#each fresh.rects as r}<rect class="fresh" x={r.x * dim.cell} y={r.y * dim.cell} width={r.w * dim.cell} height={r.h * dim.cell} />{/each}
                {#if hover && !painting && (tool === 'paint' || tool === 'erase' || tool === 'prop' || tool === 'label' || tool === 'token')}
                  <rect class="hov" x={hover.x * dim.cell} y={hover.y * dim.cell} width={dim.cell} height={dim.cell} />
                {/if}
                {#if hover?.edge}
                  {@const e = hover.edge}
                  <line class="edge" x1={e.x * dim.cell} y1={e.y * dim.cell} x2={(e.side === 'n' ? e.x + 1 : e.x) * dim.cell} y2={(e.side === 'n' ? e.y : e.y + 1) * dim.cell} />
                {/if}
                {#if sel}
                  {#if sel.t === 'door'}
                    <line class="selline" x1={sel.x * dim.cell} y1={sel.y * dim.cell} x2={(sel.side === 'n' ? sel.x + 1 : sel.x) * dim.cell} y2={(sel.side === 'n' ? sel.y : sel.y + 1) * dim.cell} />
                  {:else}
                    {@const b = selBox(sel)}
                    {#if b}<rect class="sel" x={b.x * dim.cell} y={b.y * dim.cell} width={b.w * dim.cell} height={b.h * dim.cell} />{/if}
                  {/if}
                {/if}
                {#if moveBox}<rect class="ghost" x={moveBox.x * dim.cell} y={moveBox.y * dim.cell} width={moveBox.w * dim.cell} height={moveBox.h * dim.cell} />{/if}
                {#if drag && (tool === 'rect' || tool === 'select')}
                  {@const a = cellOf(drag.a)}{@const b = cellOf(drag.b)}
                  <rect class="sel" x={Math.min(a.x, b.x) * dim.cell} y={Math.min(a.y, b.y) * dim.cell} width={(Math.abs(a.x - b.x) + 1) * dim.cell} height={(Math.abs(a.y - b.y) + 1) * dim.cell} />
                {/if}
              {:else if !battle && view === 'plan'}
                {#each fresh.rects as r}<rect class="fresh" x={r.x} y={r.y} width={r.w} height={r.h} />{/each}
                {#if pending.length}
                  <polyline class="pend" points={[...pending, ...(pointerPos ? [[pointerPos.x, pointerPos.y]] : [])].map((q) => q.join(',')).join(' ')} />
                  {#each pending as q}<circle cx={q[0]} cy={q[1]} r="4" class="dot" />{/each}
                {/if}
                {#if strokePts.length}<polyline class="pend" style="stroke:{TERRAINS[terrain]};stroke-width:{brush};opacity:.7" points={strokePts.map((q) => q.join(',')).join(' ')} />{/if}
                {#if drag && tool === 'ellipse'}<ellipse class="sel" cx={drag.a.x} cy={drag.a.y} rx={Math.abs(drag.b.x - drag.a.x)} ry={Math.abs(drag.b.y - drag.a.y)} />{/if}
                {#if selected}
                  {@const s = doc.shapes.find((x) => x.id === selected)}
                  {#if s}
                    <g transform={shapeMove ? `translate(${shapeMove.dx} ${shapeMove.dy})` : ''}>
                    {#if s.type === 'polygon'}<polygon class="sel" points={s.points.map((q) => q.join(',')).join(' ')} />
                    {:else if s.type === 'path'}<polyline class="sel" style="fill:none" points={s.points.map((q) => q.join(',')).join(' ')} />
                    {:else if s.type === 'ellipse'}<ellipse class="sel" cx={s.points[0][0]} cy={s.points[0][1]} rx={s.points[1]?.[0] ?? 30} ry={s.points[1]?.[1] ?? 30} />
                    {:else}<circle class="sel" cx={s.points[0][0]} cy={s.points[0][1]} r={(s.r ?? 14) + 6} />{/if}
                    </g>
                  {/if}
                {/if}
              {/if}
            </svg>
          </div>
        {:else}
          <div class="loading">loading…</div>
        {/if}
        {#if view === 'control'}<div class="hint">This is exactly what the image model receives: flat colours, no text.</div>{/if}
      </div>

      <aside class="side">
        <div class="tabs">
          <button class:on={panel === 'render'} onclick={() => (panel = 'render')}>Paint</button>
          <button class:on={panel === 'map'} onclick={() => (panel = 'map')}>Map</button>
        </div>

        {#if panel === 'render'}
          {#snippet jobsView()}
            {#each jobs as j (j.id)}
              <div class="job" class:err={j.status === 'error'}>
                {#if j.status === 'error'}⚠ {j.error}{:else}{j.status === 'queued' ? 'queued…' : (j.phase ?? 'painting…')}<div class="bar"><i style="width:{Math.round(j.progress * 100)}%"></i></div>{/if}
              </div>
            {/each}
          {/snippet}
          {#snippet rendersView()}
            {#if doc?.renders.length}
              <div class="label">Painted versions <span class="dim">({doc.renders.length})</span></div>
              <div class="grid">
                {#each [...doc.renders].reverse() as f (f)}
                  <button class="th" class:on={painted === f && view === 'painted'} onclick={() => { shownRender = f; view = 'painted'; }} ondblclick={() => nodeId && (app.lightbox = { nodeId, file: f })} title="Click to overlay · double-click to enlarge">
                    <img src={`/api/images/${f}?w=320`} alt="" loading="lazy" decoding="async" />
                  </button>
                {/each}
              </div>
            {/if}
          {/snippet}

          {#if staged}
            <div class="mode">Precise painting · 2 steps <button class="lnk" onclick={() => (app.settingsOpen = true)} title="Change in Settings → Map painting">change</button></div>
            <p class="warn">⏱ This takes a while — {dur(paint?.terrainSeconds ?? 0)} for the terrain, then {dur(paint?.propsSeconds ?? 0)} for {paint?.groups ?? 0} prop group{paint?.groups === 1 ? '' : 's'}, on this computer{paint?.measured ? '' : ' (a rough guess until ComfyUI has made an image here)'}. You decide after each step, and you can stop at any time.</p>

            <div class="step"><b>①</b> Terrain <span class="dim">— the empty place, no props</span></div>
            <textarea class="field" rows="3" placeholder="Materials, mood, lighting, setting… (the AI turns this into a description of the empty place)" bind:value={prompt_} oninput={() => (promptTouched = true)}></textarea>
            <div class="seg w">
              {#each ['faithful', 'balanced', 'painterly'] as f}<button class:on={fidelity === f} onclick={() => (fidelity = f as typeof fidelity)}>{f}</button>{/each}
            </div>
            <div class="dim">{TERRAIN_HINT[fidelity]}</div>
            <div class="row">
              <select class="field" bind:value={variants} title="How many terrains to paint to choose from">{#each [1, 2, 3, 4] as n}<option value={n}>{n}×</option>{/each}</select>
              <button class="btn primary grow" onclick={renderNow} disabled={prompt_.trim().length < 8 || !nodeId || busy}>{doc?.terrains?.length ? 'Paint another terrain' : 'Paint the terrain'}</button>
            </div>
            <div class="row">
              <button class="btn grow" onclick={askAi} disabled={!nodeId}>✦ AI writes the description</button>
              {#if busy}<button class="btn ghost" onclick={cancel}>stop</button>{/if}
            </div>
            {#if !nodeId}<p class="warn">This map has no map node — create it from the canvas or ask the AI.</p>{/if}
            {#if doc?.terrains?.length}
              <div class="label">Terrains <span class="dim">— click the one you like</span></div>
              <div class="grid">
                {#each [...doc.terrains].reverse() as f (f)}
                  <button class="th" class:on={doc.terrainPick === f} onclick={() => pickTerrain(f)} title={doc.terrainPick === f ? 'Chosen for step 2' : 'Click to choose this terrain'}>
                    <img src={`/api/images/${f}?w=320`} alt="" loading="lazy" decoding="async" />
                    {#if doc.terrainPick === f}<i class="tick">✓</i>{/if}
                  </button>
                {/each}
              </div>
            {/if}

            <div class="step"><b>②</b> Props <span class="dim">— painted into their spots</span></div>
            <p class="dim">Touching props of the same kind are painted as one object (a row of tables is one long table). <label class="chk"><input type="checkbox" bind:checked={showGroups} /> show the groups on the plan</label></p>
            {#if !groups.length}
              <p class="warn">This map has no props. Accept a terrain as the finished picture, or place some props first.</p>
              <button class="btn primary" onclick={acceptTerrain} disabled={!doc?.terrainPick || busy}>Use the chosen terrain as the finished picture</button>
            {:else}
              <button class="btn primary" onclick={paintProps} disabled={!doc?.terrainPick || prompt_.trim().length < 8 || !nodeId || busy}>
                {doc?.renders.length ? 'Paint the props again' : 'Paint the props on the chosen terrain'}
              </button>
              {#if !doc?.terrainPick}<div class="dim">Choose a terrain above first.</div>{/if}
            {/if}
            {@render jobsView()}
            {@render rendersView()}
            {#if doc?.renders.length}<div class="dim">Not happy? Paint the props again for a new variation, or choose another terrain.</div>{/if}
          {:else}
            <div class="label">What does the place look like?</div>
            <textarea class="field" rows="4" placeholder="Materials, mood, lighting, setting… (not the layout — that comes from your plan)" bind:value={prompt_} oninput={() => (promptTouched = true)}></textarea>
            <div class="label">Fidelity ↔ creativity</div>
            <div class="seg w">
              {#each ['faithful', 'balanced', 'painterly'] as f}<button class:on={fidelity === f} onclick={() => (fidelity = f as typeof fidelity)}>{f}</button>{/each}
            </div>
            <div class="dim">{FIDELITY_HINT[fidelity]}</div>
            <div class="row">
              <select class="field" bind:value={variants} title="Variants">{#each [1, 2, 3, 4] as n}<option value={n}>{n}×</option>{/each}</select>
              <button class="btn primary grow" onclick={renderNow} disabled={prompt_.trim().length < 8 || !nodeId}>Paint it</button>
            </div>
            <div class="row">
              <button class="btn grow" onclick={askAi} disabled={!nodeId}>✦ AI writes the prompt</button>
              {#if busy}<button class="btn ghost" onclick={cancel}>stop</button>{/if}
            </div>
            {#if !nodeId}<p class="warn">This map has no map node — create it from the canvas or ask the AI.</p>{/if}
            {#if battle}<p class="dim">Quick painting (1 step). For props that land exactly where you put them, switch to <button class="lnk" onclick={() => (app.settingsOpen = true)}>Precise painting (2 steps)</button> in Settings.</p>{/if}
            {@render jobsView()}
            {@render rendersView()}
          {/if}
        {:else if doc}
          {#if battle}
            <div class="label">Grid</div>
            <div class="row">
              <label class="num">cols <input class="field" type="number" min="4" max="80" value={doc.grid.cols} onchange={(e) => resize(+e.currentTarget.value, doc!.grid.rows)} /></label>
              <label class="num">rows <input class="field" type="number" min="4" max="80" value={doc.grid.rows} onchange={(e) => resize(doc!.grid.cols, +e.currentTarget.value)} /></label>
            </div>
            <label class="num">feet per cell <input class="field" type="number" min="1" step="0.5" value={doc.grid.unit} onchange={(e) => { pushUndo(); doc!.grid.unit = +e.currentTarget.value || 6; touch(); }} /></label>
            <p class="dim">Walls follow the floor automatically. Cell borders: 1 cell = {doc.grid.unit} ft.</p>
            <div class="label">Tokens <span class="dim">({doc.tokens.length})</span></div>
            <p class="dim">Enemies and NPCs are sent to the VTT with the map. Player starts are only sent if the VTT asks for them.</p>
          {:else}
            <div class="label">Canvas size</div>
            <div class="seg w">
              {#each [[1344, 768, 'wide'], [1024, 1024, 'square'], [768, 1344, 'tall']] as [w, h, n]}
                <button class:on={doc.size.w === w} onclick={() => setSize(w as number, h as number)}>{n}</button>
              {/each}
            </div>
            <div class="label">Background</div>
            <div class="sw">{#each ['land', 'sea', 'desert', 'snow', 'swamp'] as t}<button class:on={doc.background === t} style="--c:{TERRAINS[t as TerrainKind]}" title={t} onclick={() => setBackground(t as TerrainKind)}></button>{/each}</div>
            <p class="dim">Draw areas, roads and places; the image model turns the colour-coded sketch into a painted map. “Scribble” is a freehand brush.</p>
          {/if}
        {/if}
      </aside>
    </div>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 1500; background: rgba(5, 6, 9, 0.78); backdrop-filter: blur(4px); display: grid; place-items: center; animation: pnp-pop 0.18s ease-out; }
  .modal { width: min(1500px, 98vw); height: min(940px, 95vh); display: flex; flex-direction: column; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 14px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6); overflow: hidden; }
  header { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--line); }
  .logo { color: #7fe0a0; font-size: 18px; text-shadow: 0 0 12px #7fe0a0; }
  .nm { width: 220px; font-weight: 600; }
  .status { font-size: 11.5px; color: var(--text-faint); }
  .grow { flex: 1; }
  .body { flex: 1; display: grid; grid-template-columns: 112px minmax(0, 1fr) 290px; min-height: 0; }
  .tools { border-right: 1px solid var(--line); padding: 8px 6px; overflow: auto; display: flex; flex-direction: column; gap: 3px; }
  .tools > button { display: flex; align-items: center; gap: 7px; background: transparent; border: 1px solid transparent; color: var(--text-dim); padding: 5px 7px; border-radius: 8px; text-align: left; font-size: 12px; }
  .tools > button i { font-style: normal; width: 18px; text-align: center; }
  .tools > button:hover { background: var(--bg-3); color: var(--text); }
  .tools > button.on { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
  .pal { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); }
  .pal .field { padding: 3px 6px; font-size: 12px; }
  .sw { display: flex; flex-wrap: wrap; gap: 4px; }
  .sw button { width: 22px; height: 22px; border-radius: 6px; border: 2px solid transparent; background: var(--c); padding: 0; }
  .sw button.on { border-color: #fff; box-shadow: 0 0 0 1px #000; }
  .chk { display: flex; gap: 5px; align-items: center; font-size: 12px; color: var(--text-dim); margin-top: 6px; }
  .dim { color: var(--text-faint); font-size: 11.5px; line-height: 1.45; text-transform: none; letter-spacing: 0; }
  .vp { position: relative; overflow: hidden; background: #07080c; background-image: radial-gradient(#1a1f2c 1px, transparent 1px); background-size: 22px 22px; touch-action: none; user-select: none; }
  .stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; box-shadow: 0 0 0 1px var(--line-2), 0 20px 60px rgba(0, 0, 0, 0.6); }
  .stage :global(svg) { display: block; }
  .ov { position: absolute; left: 0; top: 0; pointer-events: none; }
  .ov :global(.hov) { fill: rgba(122, 162, 255, 0.28); stroke: var(--accent); stroke-width: 2; }
  .ov :global(.edge) { stroke: #ffd24a; stroke-width: 6; stroke-linecap: round; }
  .ov :global(.ghost) { fill: rgba(122, 162, 255, 0.10); stroke: var(--accent); stroke-width: 3; stroke-dasharray: 3 5; }
  .ov :global(.selline) { stroke: var(--accent); stroke-width: 6; stroke-linecap: round; opacity: .85; }
  .pal .two { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .pal .acts { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .pal .sm { padding: 1px 8px; font-size: 11.5px; }
  .ov :global(.sel) { fill: rgba(122, 162, 255, 0.18); stroke: var(--accent); stroke-width: 3; stroke-dasharray: 8 5; }
  .ov :global(.pend) { fill: rgba(122, 162, 255, 0.12); stroke: var(--accent); stroke-width: 3; stroke-dasharray: 8 5; stroke-linejoin: round; stroke-linecap: round; }
  .ov :global(.dot) { fill: #fff; stroke: var(--accent); stroke-width: 2; }
  .ov :global(.fresh) { fill: rgba(232, 149, 106, 0.4); stroke: var(--claude); stroke-width: 2; animation: pnp-fade 3s ease-out forwards; }
  .loading { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-faint); }
  .hint { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); background: var(--bg-3); border: 1px solid var(--line-2); padding: 4px 12px; border-radius: 99px; font-size: 12px; color: var(--text-dim); pointer-events: none; }
  .side { border-left: 1px solid var(--line); padding: 8px 14px 20px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
  .tabs { display: flex; margin: 0 -14px 4px; border-bottom: 1px solid var(--line); }
  .tabs button { flex: 1; background: transparent; border: 0; padding: 8px; color: var(--text-dim); border-bottom: 2px solid transparent; }
  .tabs button.on { color: var(--text); border-bottom-color: var(--accent); }
  .seg { display: flex; background: var(--bg); border: 1px solid var(--line-2); border-radius: 99px; padding: 2px; }
  .seg button { flex: 1; background: transparent; border: 0; border-radius: 99px; padding: 3px 11px; color: var(--text-dim); font-size: 12px; text-transform: capitalize; white-space: nowrap; }
  .seg button.on { background: var(--accent); color: #0a0c11; font-weight: 600; }
  .seg button:disabled { opacity: 0.35; }
  .seg.w { width: 100%; }
  .row { display: flex; gap: 6px; align-items: center; }
  .row .field { width: auto; }
  .num { display: grid; gap: 3px; font-size: 11.5px; color: var(--text-dim); flex: 1; }
  .warn { color: #e0c36a; font-size: 12px; margin: 4px 0; }
  .job { font-size: 12px; color: var(--text-dim); }
  .job.err { color: var(--danger); background: #2a1518; border: 1px solid #5a2a30; padding: 6px 8px; border-radius: 6px; }
  .bar { height: 4px; background: var(--bg-4); border-radius: 99px; overflow: hidden; margin-top: 3px; }
  .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), #7fe0a0); transition: width 0.4s; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .mode { font-size: 11.5px; color: var(--text-faint); display: flex; justify-content: space-between; align-items: center; }
  .step { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); font-weight: 600; font-size: 12.5px; }
  .step b { color: var(--accent); margin-right: 4px; }
  .lnk { all: unset; cursor: pointer; color: var(--accent); text-decoration: underline; font-size: inherit; }
  .chk { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; color: var(--text-dim); }
  .th { position: relative; }
  .tick { position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; border-radius: 50%; background: var(--accent); color: #0a0c11; display: grid; place-items: center; font-style: normal; font-size: 12px; font-weight: 700; }
  :global(.ov .grp) { fill: rgba(255, 220, 90, 0.12); stroke: #ffd84a; stroke-width: 2; stroke-dasharray: 6 4; pointer-events: none; }
  :global(.ov .grpid) { fill: #fff; stroke: #000; stroke-width: 3; paint-order: stroke; font: 700 13px sans-serif; pointer-events: none; }
  .th { all: unset; cursor: pointer; border: 2px solid var(--line-2); border-radius: 8px; overflow: hidden; aspect-ratio: 3 / 2; }
  .th.on { border-color: var(--accent); }
  .th img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
