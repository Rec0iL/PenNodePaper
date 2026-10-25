<script lang="ts">
  // Map editor: draw battle maps (grid floor plans) and region maps (vector sketches),
  // then paint them with the image model. Edits go through the SAME applyOps the AI's
  // edit_map uses, so the GM and the AI can work on one map at the same time.
  import { onMount, untrack } from 'svelte';
  import {
    DEFAULT_LABEL_STYLE, DOOR_KINDS, FIT_MODES, actorName, gridForPicture, groupWindow, groupsOfMap, lineGroupOf, paintPlan, sizeForPicture, variantsOf, FLOORS, LABEL_PLACES, LABEL_STYLES, NODE_TYPE_INFO, PROP_KINDS, REGION_KINDS, applyOps, canon, charactersOfPlace, cleanKind, derivedWalls, fallbackGroupPrompt, fallbackRegionPrompt, getLabelContext, groupProps, groupRegion, imageSize, inStep2, isLineKind, lettersSvg, placedLabels, pointInShape, regionKind, renderSvg, strokeWidth, tokenKindOf,
    type DoorKind, type FitMode, type LabelPlace, type LineGroup, type LabelSize, type MapDoc, type MapOp, type Placed, type PropKind, type RegionKind,
  } from '@pnp/shared';
  import { app, cmd, say, selectNode, sendChat } from '../lib/app.svelte';
  import { initLabels, labelState } from '../lib/labels.svelte';
  import { PICTURE_ACCEPT, importMapPicture, loadPicture, scaleOnto, toPngBlob, type Picture } from '../lib/imageImport';
  import CameraIcon from './CameraIcon.svelte';

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
  /** region maps: the kind the next shape is drawn as, and the optional width / stamp radius that overrides the kind's own */
  let kind = $state('forest');
  let lineWidth = $state<number | null>(null);
  let stampR = $state<number | null>(null);
  let brush = $state(50);
  let autoWalls = $state(true);
  let view = $state<'plan' | 'control' | 'terrain' | 'painted'>('plan');
  let shownRender = $state<string | null>(null);
  let panel = $state<'render' | 'map' | 'cast' | 'draw'>('render');
  /** the character (NPC / enemy node of this place) the Token tool puts on the plan; null = a plain marker */
  let tokenNode = $state<string | null>(null);

  const battle = $derived(doc?.kind === 'battle');
  // how this computer paints maps (Settings → Map painting): quick = one pass, staged = precise, several steps
  interface PaintInfo { mode: 'quick' | 'staged'; groups: number; quickSeconds: number; terrainSeconds: number; propsSeconds: number; measured: boolean }
  let paint = $state<PaintInfo | null>(null);
  const staged = $derived(paint?.mode === 'staged');
  const dim = $derived(doc ? imageSize(doc) : { w: 1, h: 1, cell: 1 });
  // region maps: the kinds you can draw — built-ins, the campaign's library, and the map's own copies (which win)
  const allKinds = $derived.by((): RegionKind[] => {
    const m = new Map<string, RegionKind>(REGION_KINDS.map((k) => [k.id, k]));
    for (const k of (app.meta.regionKinds ?? []) as RegionKind[]) m.set(k.id, { ...k, custom: true });
    for (const k of doc?.kinds ?? []) m.set(k.id, { ...k, custom: true });
    return [...m.values()];
  });
  const kindOf = (id: string): RegionKind => allKinds.find((k) => k.id === id) ?? regionKind(id, doc?.kinds);
  const palette = $derived({
    terrain: allKinds.filter((k) => k.layer === 'terrain' && k.geometry !== 'line'),
    lines: allKinds.filter((k) => k.geometry === 'line'),
    structures: allKinds.filter((k) => k.layer === 'structure' && k.geometry !== 'line'),
  });
  const svgStr = $derived.by(() => {
    void labelState.version; // the names are lettering: redraw when the fonts / materials arrive
    return doc && view !== 'painted' && view !== 'terrain' ? renderSvg(doc, view === 'control' ? (staged ? 'terrain' : 'control') : 'preview') : '';
  });
  // names: where they stand (for picking them on the map) and, over a painted picture, their lettering
  const placed = $derived.by((): Placed[] => {
    void labelState.version;
    return doc ? placedLabels(doc, getLabelContext()) : [];
  });
  let showNames = $state(true);
  const selNameBox = $derived.by(() => {
    if (!doc || sel?.t !== 'label') return null;
    const l = doc.labels.find((x) => Math.hypot(x.x - (sel as { x: number }).x, x.y - (sel as { y: number }).y) < 0.01);
    const q = l ? placed.find((x) => x.src.t === 'label' && x.src.i === doc!.labels.indexOf(l)) : undefined;
    return q ? { x: q.x - 3, y: q.y - 3, w: q.w + 6, h: q.h + 6 } : null;
  });
  const printable = $derived(placed.filter((q) => q.shown).length);
  const styleInfo = (id?: string) => LABEL_STYLES.find((x) => x.id === (id ?? DEFAULT_LABEL_STYLE)) ?? LABEL_STYLES[0];
  let printing = $state(false);
  const node = $derived(nodeId ? app.nodes[nodeId] : undefined);
  // the NPCs and enemies that belong to this place, and the tokens that stand for them
  const cast = $derived(doc && battle ? charactersOfPlace({ nodes: app.nodes, graph: app.graph }, doc.id) : []);
  const placedOf = (id: string) => doc?.tokens.filter((t) => t.node === id).length ?? 0;
  const placedTotal = $derived(cast.filter((c) => placedOf(c.id) > 0).length);
  const hasSheet = (n: (typeof cast)[number]) => !!(n.fields.sheet && typeof n.fields.sheet === 'object') || ['tier', 'level', 'hp', 'rolle'].some((k) => k in n.fields);
  function startPlacing(id: string | null) {
    tokenNode = id;
    tool = 'token';
    panel = 'cast';
    sel = null;
    selected = null;
    pending = [];
  }
  let newName = $state('');
  let newType = $state<'enemy' | 'npc'>('enemy');
  /** a new NPC / enemy that belongs to this place, ready to be put on the plan */
  async function createCharacter() {
    const title = newName.trim();
    if (!title || !node) return;
    const r = await cmd<{ id: string }>('create_node', { type: newType, title, linkTo: node.id, linkKind: 'belongs-to', place: 'pool' });
    if (r) {
      newName = '';
      startPlacing(r.id);
    }
  }

  // ---- load / save --------------------------------------------------------------------
  onMount(() => {
    initLabels();
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
      if (doc!.kind !== 'battle') panel = 'draw';
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
        doc.lettered = ev.map.lettered;
        doc.terrains = ev.map.terrains;
        doc.terrainPick = ev.map.terrainPick;
        doc.groupVariants = ev.map.groupVariants;
        doc.paintPrompt = ev.map.paintPrompt;
        // prompts the AI wrote for the prop groups arrive where the GM has no wording of their own
        for (const [id, e] of Object.entries(ev.map.propPrompts ?? {})) {
          const mine = doc.propPrompts?.[id];
          if (e.ai && (!mine || mine.ai || !mine.text.trim())) doc.propPrompts = { ...(doc.propPrompts ?? {}), [id]: e };
        }
        return;
      }
      clearTimeout(saveTimer);
      dirty = false;
      markFresh(doc, ev.map);
      doc = JSON.parse(JSON.stringify(ev.map));
      status = `${actorName(ev.actor)} edited the map`;
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
  let panning = $state<{ x: number; y: number; tx: number; ty: number; moved: boolean; right: boolean } | null>(null);

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
  function local(e: { clientX: number; clientY: number }): { x: number; y: number } {
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
    const hitName = hitLabel(p);
    if (hitName) return { t: 'label', x: hitName.x, y: hitName.y };
    const ed = edgeOf(p);
    if (ed && doc.doors.some((d) => d.x === ed.x && d.y === ed.y && d.side === ed.side)) return { t: 'door', ...ed };
    return null;
  }

  /** a free name (map.labels entry) under the point p (px of the picture) */
  function hitLabel(p: { x: number; y: number }) {
    if (!doc) return null;
    for (const q of [...placed].reverse()) {
      if (q.src.t !== 'label' || p.x < q.x - 3 || p.x > q.x + q.w + 3 || p.y < q.y - 3 || p.y > q.y + q.h + 3) continue;
      const l = doc.labels[q.src.i];
      if (l) return l;
    }
    return null;
  }

  const inArea = (c: { x: number; y: number }, a: { x: number; y: number; w: number; h: number }) => c.x >= a.x && c.x < a.x + a.w && c.y >= a.y && c.y < a.y + a.h;

  /** The selection's box in cells (for highlighting and moving). */
  function selBox(s: Sel | null): { x: number; y: number; w: number; h: number } | null {
    if (!s || !doc) return null;
    if (s.t === 'area') return s;
    if (s.t === 'prop') return selProp ? { x: selProp.x, y: selProp.y, w: selProp.w ?? 1, h: selProp.h ?? 1 } : null;
    if (s.t === 'token') return { x: s.x, y: s.y, w: 1, h: 1 };
    if (s.t === 'label') {
      const i = selLabel ? doc.labels.indexOf(selLabel) : -1;
      const q = placed.find((x) => x.src.t === 'label' && x.src.i === i);
      return q ? { x: q.x / dim.cell, y: q.y / dim.cell, w: q.w / dim.cell, h: q.h / dim.cell } : { x: s.x - 0.5, y: s.y - 0.5, w: 1, h: 1 };
    }
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
      const { x: tx0, y: ty0, kind, label, node: tnode } = selToken; // plain values: the edit below changes the token in place
      if (copy) {
        if (!edit([{ op: 'token', x: tx0 + dx, y: ty0 + dy, kind, label, node: tnode }])) return false;
      } else if (!edit([{ op: 'edit_token', x: tx0, y: ty0, to: [tx0 + dx, ty0 + dy] }])) return false;
      sel = { t: 'token', x: tx0 + dx, y: ty0 + dy };
    } else if (s.t === 'label' && selLabel) {
      const { x: lx0, y: ly0, text, place, style, size, show, area } = selLabel;
      if (copy) {
        // the copy keeps how the name is printed, and the area it stands above / in / below (moved along; areas are in cells on battle maps)
        const gone = area ? { ...area, x: area.x + dx, y: area.y + dy } : undefined;
        if (!edit([{ op: 'label', x: lx0 + dx, y: ly0 + dy, text, place, style, size, show, ...(gone ? { area: gone } : {}) }])) return false;
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

  // region maps: move / restyle / reshape the selected shape (in place, so its place in the drawing order is kept)
  type Shape = MapDoc['shapes'][number];
  function translateShape(s: NonNullable<typeof selShape>, dx: number, dy: number): Pt[] {
    if (s.type === 'ellipse') return [[s.points[0][0] + dx, s.points[0][1] + dy], ...s.points.slice(1)] as Pt[];
    return s.points.map(([x, y]) => [x + dx, y + dy] as Pt);
  }
  /** a custom kind the map does not carry yet is copied into it (renders, exports and the AI see the map on its own) */
  function ensureKind(id: string) {
    if (!doc) return;
    const k = allKinds.find((x) => x.id === id);
    if (k?.custom && !doc.kinds?.some((x) => x.id === id)) doc.kinds = [...(doc.kinds ?? []), { ...k }];
  }
  function updateShape(s: Shape, patch: Partial<Shape>, snapshot = true) {
    if (!doc) return;
    if (snapshot) pushUndo();
    if (patch.kind) ensureKind(patch.kind);
    const t = s as unknown as Record<string, unknown>;
    for (const [key, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === null) delete t[key];
      else t[key] = v;
    }
    touch();
  }
  const withKind = (id: string, op: Extract<MapOp, { op: 'shape' }>): MapOp[] => {
    const k = allKinds.find((x) => x.id === id);
    return k?.custom && !doc?.kinds?.some((x) => x.id === id) ? [{ op: 'define_kind', kind: k }, op] : [op];
  };
  function duplicateShape() {
    if (!selShape || !doc) return;
    const s = selShape;
    const id = rid(s.kind);
    if (edit(withKind(s.kind, { op: 'shape', type: s.type, kind: s.kind, points: translateShape(s, 24, 24), r: s.r, width: s.width, label: s.label, prompt: s.prompt, labelPlace: s.labelPlace, labelStyle: s.labelStyle, labelSize: s.labelSize, labelShow: s.labelShow, id }))) selected = id;
  }
  function reorderShape(toFront: boolean) {
    if (!selShape || !doc) return;
    pushUndo();
    const s = doc.shapes.find((x) => x.id === selected)!;
    doc.shapes = toFront ? [...doc.shapes.filter((x) => x !== s), s] : [s, ...doc.shapes.filter((x) => x !== s)];
    touch();
  }
  function removeVertex(i: number) {
    if (!selShape || !doc) return;
    const min = selShape.type === 'polygon' ? 3 : 2;
    if (selShape.points.length <= min) return say('A shape needs at least ' + min + ' points');
    pushUndo();
    selShape.points = selShape.points.filter((_, n) => n !== i);
    touch();
  }
  /** a click on the palette: draw the next shape as this kind, with the tool that suits it */
  function pickKind(id: string) {
    kind = id;
    lineWidth = null;
    stampR = null;
    const k = kindOf(id);
    pending = [];
    // the tool that suits the kind: lines are drawn as lines, places are stamped (pick Area or Blob afterwards to draw one by hand), land as areas
    if (isLineKind(k)) tool = 'path';
    else if (k.layer === 'structure' && tool !== 'ellipse') tool = 'pin';
    else if (k.layer === 'terrain' && (tool === 'path' || tool === 'pin' || tool === 'select')) tool = 'polygon';
    selected = null;
  }
  // ---- custom types (the campaign's library) ----
  let customOpen = $state(false);
  let cf = $state({ id: '', name: '', cls: 'terrain' as 'terrain' | 'line' | 'structure', color: '#7cff3a', prompt: '', width: 10, size: 20, group: 'land' as LineGroup });
  function newCustom() {
    cf = { id: '', name: '', cls: 'terrain', color: '#7cff3a', prompt: '', width: 10, size: 20, group: 'land' };
    customOpen = true;
  }
  function editCustom(k: RegionKind) {
    cf = { id: k.id, name: k.name, cls: k.geometry === 'line' ? 'line' : k.layer === 'structure' ? 'structure' : 'terrain', color: k.color, prompt: k.prompt, width: k.width ?? 10, size: k.size ?? 20, group: lineGroupOf(k) };
    customOpen = true;
  }
  async function saveCustom() {
    const payload = {
      name: cf.name, ...(cf.id ? { id: cf.id } : {}), layer: cf.cls === 'structure' ? ('structure' as const) : ('terrain' as const),
      geometry: cf.cls === 'line' ? ('line' as const) : cf.cls === 'structure' ? ('spot' as const) : ('area' as const),
      color: cf.color, prompt: cf.prompt, ...(cf.cls === 'line' ? { width: cf.width, lineGroup: cf.group } : {}), ...(cf.cls === 'structure' ? { size: cf.size } : {}),
    };
    let id: string;
    try {
      id = cleanKind(payload).id;
    } catch (e) {
      return say(e instanceof Error ? e.message : String(e));
    }
    const r = await cmd('set_region_kind', payload);
    if (!r) return;
    customOpen = false;
    // maps that already use this kind keep their copy in sync with the edit
    if (doc?.kinds?.some((x) => x.id === id)) doc.kinds = doc.kinds.map((x) => (x.id === id ? { ...cleanKind(payload) } : x));
    pickKind(id);
  }
  async function removeCustom(id: string) {
    if (!confirm('Remove this type from the campaign library? Maps that use it keep their copy.')) return;
    await cmd('remove_region_kind', { id });
    if (kind === id) kind = 'forest';
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
      closeCtx();
      panning = { x: e.clientX, y: e.clientY, tx, ty, moved: false, right: e.button === 2 };
      vp.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    closeCtx();
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
        drag = { a: p, b: p }; // a click names the point, dragging a rectangle names that area (see pointer up)
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
        const who = tokenNode ? app.nodes[tokenNode] : undefined;
        if (who && !who.trashed) {
          // the token IS this character: named after it, kind from its node
          const n = placedOf(who.id);
          edit([{ op: 'token', x: c.x, y: c.y, kind: tokenKindOf(who), label: n ? `${who.title} ${n + 1}` : who.title, node: who.id }]);
        } else {
          const n = doc.tokens.filter((t) => t.kind === tokenKind).length + 1;
          edit([{ op: 'token', x: c.x, y: c.y, kind: tokenKind, label: `${{ pc: 'P', npc: 'N', enemy: 'E' }[tokenKind]}${n}` }]);
        }
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
    } else if (tool === 'ellipse' || tool === 'pin' || tool === 'label') drag = { a: p, b: p };
    else if (tool === 'select') {
      const nm = hitLabel(p);
      if (nm) {
        selected = null;
        sel = { t: 'label', x: nm.x, y: nm.y };
        return;
      }
      sel = null;
      // a handle of the selected shape: drag it (Alt-click removes the point)
      if (selShape && (selShape.type === 'polygon' || selShape.type === 'path')) {
        const reach = 10 / k;
        const i = selShape.points.findIndex(([x, y]) => Math.hypot(x - p.x, y - p.y) <= reach);
        if (i >= 0) {
          if (e.altKey) removeVertex(i);
          else {
            pushUndo();
            vertex = i;
          }
          return;
        }
      }
      selected = hitShape(p);
      if (selected) shapeMove = { from: p, dx: 0, dy: 0 };
    }
  }
  /** region maps: index of the corner of the selected shape being dragged */
  let vertex = $state<number | null>(null);

  function onpointermove(e: PointerEvent) {
    if (panning) {
      if (Math.hypot(e.clientX - panning.x, e.clientY - panning.y) > 4) panning.moved = true;
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
    if (vertex !== null && selShape) {
      const pts = [...selShape.points];
      pts[vertex] = [Math.round(p.x), Math.round(p.y)];
      selShape.points = pts;
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
      const click = panning.right && !panning.moved;
      panning = null;
      if (click) openCtx(e); // a right click that did not pan: the context menu
      return;
    }
    if (!doc) return;
    vp.releasePointerCapture?.(e.pointerId);
    if (moving) {
      const mv = moving;
      moving = null;
      if (mv.dx || mv.dy) shiftSel(mv.dx, mv.dy, mv.copy || e.altKey);
    }
    if (vertex !== null) {
      vertex = null;
      touch();
    }
    if (shapeMove) {
      const sm = shapeMove;
      shapeMove = null;
      if ((sm.dx || sm.dy) && selShape) updateShape(selShape, { points: translateShape(selShape, sm.dx, sm.dy) });
    }
    if (painting) {
      painting = false;
      if (tool === 'brush' && strokePts.length >= 1) {
        const pts = strokePts.length === 1 ? [strokePts[0], [strokePts[0][0] + 1, strokePts[0][1]] as Pt] : strokePts;
        const id = rid(kind);
        if (edit(withKind(kind, { op: 'shape', type: 'path', kind, points: pts, width: brush, id }), false)) selected = id;
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
      } else if (tool === 'label') {
        nameAt(d);
      } else if (battle && tool === 'select') {
        const a = cellOf(d.a), b = cellOf(d.b);
        const x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y));
        const x1 = Math.min(doc.grid.cols - 1, Math.max(a.x, b.x)), y1 = Math.min(doc.grid.rows - 1, Math.max(a.y, b.y));
        if (x1 >= x0 && y1 >= y0) sel = { t: 'area', x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      } else if (!battle && tool === 'ellipse') {
        const rx = Math.abs(d.b.x - d.a.x), ry = Math.abs(d.b.y - d.a.y);
        const id = rid(kind);
        if (rx > 4 && ry > 4 && edit(withKind(kind, { op: 'shape', type: 'ellipse', kind, points: [[Math.round(d.a.x), Math.round(d.a.y)], [Math.round(rx), Math.round(ry)]], id }))) selected = id;
      } else if (!battle && tool === 'pin') {
        // Stamp: a click puts a round area of the kind's usual size, dragging outwards sizes it by hand. A place is an area, never a dot.
        const dist = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
        const r = dist > 8 ? Math.round(dist) : (stampR ?? kindOf(kind).size ?? 20);
        const id = rid(kind);
        if (edit(withKind(kind, { op: 'shape', type: 'ellipse', kind, points: [[Math.round(d.a.x), Math.round(d.a.y)], [r, r]], id }))) selected = id;
      }
    }
  }

  /** the Name tool: a click names a point, a drag names the rectangle (an area the name stands above / in / below) */
  function nameAt(d: { a: { x: number; y: number }; b: { x: number; y: number } }) {
    if (!doc) return;
    const dist = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
    let at: { x: number; y: number }, area: { x: number; y: number; w: number; h: number } | undefined;
    if (battle) {
      const a = cellOf(d.a), b = cellOf(d.b);
      if (a.x !== b.x || a.y !== b.y) {
        const x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y));
        const x1 = Math.min(doc.grid.cols - 1, Math.max(a.x, b.x)), y1 = Math.min(doc.grid.rows - 1, Math.max(a.y, b.y));
        area = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
        at = { x: x0 + area.w / 2, y: y0 + area.h / 2 };
      } else at = { x: a.x + 0.5, y: a.y + 0.5 };
    } else if (dist > 12) {
      const x0 = Math.min(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y);
      area = { x: Math.round(x0), y: Math.round(y0), w: Math.round(Math.abs(d.b.x - d.a.x)), h: Math.round(Math.abs(d.b.y - d.a.y)) };
      at = { x: area.x + area.w / 2, y: area.y + area.h / 2 };
    } else at = { x: Math.round(d.a.x), y: Math.round(d.a.y) };
    const near = area ? undefined : hitLabel(d.a);
    const text = prompt('Name (leave empty to remove)', near?.text ?? '');
    if (text === null) return;
    const ops: MapOp[] = near ? [{ op: 'remove_label', x: near.x, y: near.y }] : [];
    if (text.trim()) ops.push({ op: 'label', x: at.x, y: at.y, text: text.trim(), ...(area ? { area, place: 'above' as const } : {}) });
    if (ops.length && edit(ops)) sel = text.trim() ? { t: 'label', x: at.x, y: at.y } : null;
  }

  const setLettering = (style: string) => void edit([{ op: 'lettering', style }]);
  /** print the names onto the finished picture (a new picture; the painted one stays as it is) */
  async function printOnPicture() {
    if (!doc || printing) return;
    printing = true;
    try {
      clearTimeout(saveTimer);
      if (dirty) await save();
      const r = await cmd<{ file: string }>('print_map_names', { mapId: doc.id, ...(painted ? { render: painted } : {}) });
      if (r) {
        const j = await (await fetch(`/api/maps/${encodeURIComponent(doc.id)}`)).json();
        doc.renders = j.map.renders;
        doc.lettered = j.map.lettered;
        shownRender = r.file;
        view = 'painted';
        say('Names printed on a new picture');
      }
    } finally {
      printing = false;
    }
  }
  /** a name's printing options: where it stands, its lettering style and size, and whether it is printed at all */
  type NameSet = { place?: LabelPlace; style?: string | null; size?: LabelSize | null; show?: boolean };

  function finishPending() {
    if (!pending.length) return;
    const need = tool === 'polygon' ? 3 : 2;
    if (pending.length >= need) {
      const id = rid(kind);
      const line = tool === 'path';
      if (edit(withKind(kind, { op: 'shape', type: line ? 'path' : 'polygon', kind, points: pending, id, ...(line && lineWidth ? { width: lineWidth } : {}) }))) selected = id;
    }
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
      // thin lines are given a minimum reach so they can be grabbed
      const probe = s.type === 'path' ? { ...s, width: Math.max(strokeWidth(s, doc.kinds), 16) } : s;
      if (pointInShape(probe, p.x, p.y, doc.kinds)) return s.id;
    }
    return null;
  }

  // ---- context menu (right click) ---------------------------------------------------------------------
  // Right-drag still pans; a right click opens the menu for what is under the pointer (or for the empty spot).
  let ctx = $state<{ x: number; y: number; p: { x: number; y: number }; c: { x: number; y: number } } | null>(null);
  let ctxSub = $state<'prop' | 'floor' | 'kind' | 'token' | null>(null);
  /** where the menu was opened: kept after it closes, because act() closes the menu before the action runs */
  let spot = { p: { x: 0, y: 0 }, c: { x: 0, y: 0 } };
  function closeCtx() {
    ctx = null;
    ctxSub = null;
  }
  function openCtx(e: { clientX: number; clientY: number }) {
    if (!doc) return;
    const p = local(e);
    const c = cellOf(p);
    if (battle) {
      if (!(sel?.t === 'area' && inArea(c, sel))) sel = hitItem(p, c);
      selected = null;
    } else {
      const nm = hitLabel(p);
      sel = nm ? { t: 'label', x: nm.x, y: nm.y } : null;
      selected = nm ? null : hitShape(p);
    }
    ctxSub = null;
    spot = { p, c };
    ctx = { x: e.clientX, y: e.clientY, p, c };
  }
  /** a right click outside the open menu closes it — and, over the plan, opens the menu for that spot straight away */
  function reopenCtx(e: PointerEvent) {
    closeCtx();
    const r = vp?.getBoundingClientRect();
    if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) openCtx(e);
  }
  /** run a menu action and close the menu */
  const act = (fn: () => void) => () => {
    closeCtx();
    fn();
  };
  function renameSel() {
    if (!doc) return;
    if (selToken) {
      const t = prompt('Token name', selToken.label ?? '');
      if (t !== null) edit([{ op: 'edit_token', x: selToken.x, y: selToken.y, label: t.trim() || null }]);
    } else if (selProp) {
      const t = prompt('Prop name', selProp.label ?? '');
      if (t !== null) edit([{ op: 'edit_prop', id: selProp.id, label: t.trim() || null }]);
    } else if (selLabel) {
      const { x, y, text } = selLabel;
      const t = prompt('Name (leave empty to remove)', text);
      if (t === null) return;
      if (t.trim()) edit([{ op: 'edit_label', x, y, text: t.trim() }]);
      else if (edit([{ op: 'remove_label', x, y }])) sel = null;
    } else if (selShape) {
      const t = prompt('Name of this shape', selShape.label ?? '');
      if (t !== null) updateShape(selShape, { label: t.trim() });
    }
  }
  /** a new free name at the spot that was right-clicked */
  function nameHere() {
    const { p, c } = spot;
    const at = battle ? { x: c.x + 0.5, y: c.y + 0.5 } : { x: Math.round(p.x), y: Math.round(p.y) };
    if (!doc || (battle && !inGrid(c))) return;
    const t = prompt('Name');
    if (t?.trim() && edit([{ op: 'label', ...at, text: t.trim() }])) sel = { t: 'label', ...at };
  }
  function propHere(k: PropKind) {
    const { c } = spot;
    if (!doc || !inGrid(c)) return;
    const [w, h] = PROP_SIZE[k] ?? [1, 1];
    const id = rid(k);
    if (edit([{ op: 'prop', kind: k, x: Math.min(c.x, doc.grid.cols - w), y: Math.min(c.y, doc.grid.rows - h), w, h, id }])) sel = { t: 'prop', id };
  }
  function tokenHere(kd: 'pc' | 'npc' | 'enemy') {
    const { c } = spot;
    if (!doc || !inGrid(c)) return;
    if (doc.tokens.some((t) => t.x === c.x && t.y === c.y)) return say('There is a token on that cell already');
    const n = doc.tokens.filter((t) => t.kind === kd).length + 1;
    if (edit([{ op: 'token', x: c.x, y: c.y, kind: kd, label: `${{ pc: 'P', npc: 'N', enemy: 'E' }[kd]}${n}` }])) sel = { t: 'token', x: c.x, y: c.y };
  }
  const placeHere = (id: string) => placeCharacter(id, spot.c);
  /** put a character of this place on the plan (menu, or dragged from the Characters tab) */
  function placeCharacter(id: string, c: { x: number; y: number }) {
    const who = app.nodes[id];
    if (!doc || !who || who.trashed || !inGrid(c)) return;
    if (doc.tokens.some((t) => t.x === c.x && t.y === c.y)) return say('There is a token on that cell already');
    const n = placedOf(id);
    if (edit([{ op: 'token', x: c.x, y: c.y, kind: tokenKindOf(who), label: n ? `${who.title} ${n + 1}` : who.title, node: id }])) sel = { t: 'token', x: c.x, y: c.y };
  }
  /** a new kind for the selected shape, by the map's own rules (a line stays a line, a place never becomes one) */
  function changeKind(id: string) {
    if (!selShape) return;
    const k = allKinds.find((x) => x.id === id);
    const had = doc?.kinds?.some((x) => x.id === id);
    edit([...(k?.custom && !had ? [{ op: 'define_kind' as const, kind: k }] : []), { op: 'edit_shape', id: selShape.id, kind: id }]);
  }
  const ctxKinds = $derived(selShape ? (selShape.type === 'path' ? allKinds.filter((x) => !inStep2(x)) : allKinds) : []);
  const ctxPos = $derived(ctx ? { left: Math.max(8, Math.min(ctx.x, window.innerWidth - 316)), top: Math.max(8, Math.min(ctx.y, window.innerHeight - 440)) } : { left: 0, top: 0 });

  // ---- drag & drop ---------------------------------------------------------------------------------------------
  // a picture file dropped on the plan opens the import; a character dragged from the Characters tab becomes a token
  let dropping = $state(false);
  function ondragover(e: DragEvent) {
    const t = e.dataTransfer?.types ?? [];
    if (t.includes('Files') || t.includes('application/x-pnp-token')) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      dropping = t.includes('Files') && !t.includes('application/x-pnp-token'); // a dragged portrait can carry a file too
    }
  }
  function ondrop(e: DragEvent) {
    dropping = false;
    const dt = e.dataTransfer;
    if (!dt || !doc) return;
    if (impBusy) {
      e.preventDefault();
      return say('A picture is being imported — wait until it is done');
    }
    const who = dt.getData('application/x-pnp-token');
    if (who) {
      e.preventDefault();
      if (battle) placeCharacter(who, cellOf(local(e)));
      return;
    }
    const f = [...dt.files].find((x) => x.type.startsWith('image/'));
    if (dt.files.length) e.preventDefault();
    if (f) void startImport(f);
    else if (dt.files.length) say('That is not a picture');
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
    if (e.key === 'Escape' && ctx) return closeCtx();
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
      if (selected) duplicateShape(); else duplicateSel();
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
  function setBackground(bg: string) {
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
  /** what step 2 paints, the same shape for both kinds: battle = touching props of one kind, region = touching structures of one kind */
  interface UiGroup { id: string; kind: string; count: number; rect: { x: number; y: number; w: number; h: number }; fallback: string }
  const groups = $derived.by((): UiGroup[] => {
    if (!doc) return [];
    if (battle) {
      const cell = imageSize(doc).cell;
      return groupProps(doc).map((g) => ({ id: g.id, kind: g.kind, count: g.props.length, rect: { x: g.bbox.x0 * cell, y: g.bbox.y0 * cell, w: (g.bbox.x1 - g.bbox.x0) * cell, h: (g.bbox.y1 - g.bbox.y0) * cell }, fallback: fallbackGroupPrompt({ kind: g.kind, count: g.props.length }) }));
    }
    return groupRegion(doc).map((g) => ({
      id: g.id, kind: g.kind, count: g.shapes.length,
      rect: { x: g.bbox.x0, y: g.bbox.y0, w: g.bbox.x1 - g.bbox.x0, h: g.bbox.y1 - g.bbox.y0 },
      fallback: fallbackRegionPrompt({ kindPrompt: regionKind(g.kind, doc!.kinds).prompt, shapePrompts: g.shapes.map((x) => x.prompt ?? '').filter(Boolean), count: g.shapes.length }),
    }));
  });
  /** the prop / structure group whose prompt is being edited: outlined on the plan */
  let hotGroup = $state('');
  type Group = UiGroup;
  const promptOf = (g: Group) => {
    const e = doc?.propPrompts?.[g.id];
    return e && e.kind === g.kind ? e : null;
  };
  /** every group's earlier paintings and the part of the picture that shows it (for the preview strip) */
  const variantInfo = $derived.by(() => {
    if (!doc) return {} as Record<string, { v: ReturnType<typeof variantsOf>; win: ReturnType<typeof groupWindow> }>;
    return Object.fromEntries(groupsOfMap(doc).map((g) => [g.id, { v: variantsOf(doc!, g), win: groupWindow(doc!, g) }]));
  });
  const PREVIEW = 76;
  /** one painting of a group as a small picture: the window around the group cut out of the finished picture */
  function thumbStyle(file: string, win: { x: number; y: number; w: number; h: number }) {
    const k = PREVIEW / Math.max(win.w, win.h);
    return `width:${Math.round(win.w * k)}px;height:${Math.round(win.h * k)}px;background-image:url(/api/images/${file}?w=720);background-size:${Math.round(dim.w * k)}px ${Math.round(dim.h * k)}px;background-position:${-Math.round(win.x * k)}px ${-Math.round(win.y * k)}px`;
  }
  const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  async function pickVariant(g: { id: string; kind: string }, id: string) {
    const r = await cmd<{ file?: string; note?: string }>('pick_group_variant', { mapId, group: g.id, variant: id });
    if (!r) return;
    if (r.file) { shownRender = r.file; view = 'painted'; }
    say(r.note ?? `An earlier ${g.kind.replace(/_/g, ' ')} is back in the picture`, 'ok');
  }
  /** what each pass paints, and the shapes that no pass would ever paint */
  const plan = $derived(doc ? paintPlan(doc) : null);
  const ownPrompts = $derived(groups.filter((g) => { const e = promptOf(g); return e && !e.ai && e.text.trim(); }).length);
  const defaultPrompt = (g: Group) => g.fallback;
  /** the GM's own wording (an empty text = "no wording of mine", the AI writes it) */
  function setPrompt(g: Group, text: string) {
    if (!doc) return;
    doc.propPrompts = { ...(doc.propPrompts ?? {}), [g.id]: { kind: g.kind, text } };
    touch();
  }

  async function loadPaint() {
    if (!doc) return;
    await save(); // the estimate counts the props of the saved plan
    const r = await fetch(`/api/maps/${encodeURIComponent(mapId)}/paint`);
    if (r.ok) paint = await r.json();
  }
  const dur = (s: number) => (s < 90 ? `about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : s < 5400 ? `about ${Math.round(s / 60)} min` : `about ${(s / 3600).toFixed(1)} hours`);

  let prompt_ = $state('');
  let promptTouched = $state(false);
  /** typing in the description: it is part of the map (saved with the autosave) */
  function promptInput() {
    promptTouched = true;
    if (doc) {
      doc.paintPrompt = prompt_;
      touch();
    }
  }
  let fidelity = $state<'faithful' | 'balanced' | 'painterly'>('balanced');
  let variants = $state(1);
  /** the camera of the map (a property of the map, not of the campaign style); both kinds: blend the objects in at the end */
  type Cam = 'default' | 'strict' | 'plan' | 'custom';
  let viewMode = $state<Cam>('default');
  let viewText = $state('');
  let consolidate = $state(true);
  /**
   * The cameras to choose from. Region maps (precise painting) have three standard ones; top-down and survey map look from the same
   * angle (straight down), the survey map is the satellite. Everything else has the standard camera (straight from above, stored as
   * "default") and the GM's own.
   */
  interface CamChoice { id: Cam; icon: Cam; name: string; hint: string }
  const CAM_CUSTOM: CamChoice = { id: 'custom', icon: 'custom', name: 'your own', hint: 'describe the camera yourself, e.g. a vertical cross-section seen from the side' };
  const cameras = $derived<CamChoice[]>(staged && !battle
    ? [
        { id: 'default', icon: 'default', name: 'natural', hint: 'looks at the land at an angle, like a painted game map (mountains as icons) — best for most maps' },
        { id: 'strict', icon: 'strict', name: 'top-down', hint: 'looks straight down, like a photo from above — best for snow, mountains and plans' },
        { id: 'plan', icon: 'plan', name: 'survey map', hint: 'a satellite survey: straight down like top-down, drawn as a hillshaded map with heavy relief, very flat' },
        CAM_CUSTOM,
      ]
    : [{ id: 'default', icon: 'strict', name: 'top-down', hint: `looks straight down from above — the standard for ${battle ? 'floor plans' : 'maps'}` }, CAM_CUSTOM]);
  const camSelected = $derived<Cam>(cameras.some((c) => c.id === viewMode) ? viewMode : 'default');
  /** "your own" without any words cannot be painted yet */
  const camMissing = $derived(camSelected === 'custom' && !viewText.trim());
  function pickCamera(id: Cam) {
    viewMode = id;
    if (!doc) return;
    if (id === 'default') delete doc.view;
    else doc.view = id;
    touch();
  }
  function cameraTextInput() {
    if (!doc) return;
    doc.viewText = viewText;
    touch();
  }
  $effect(() => {
    if (doc && !untrack(() => promptTouched)) {
      viewMode = doc.view ?? 'default';
      viewText = doc.viewText ?? '';
      consolidate = doc.consolidate !== false;
    }
  });
  $effect(() => {
    if (!promptTouched && node) prompt_ = doc?.paintPrompt?.trim() || [node.title, node.summary].filter(Boolean).join('. ');
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

  // the welcome tour types a description into the Paint tab
  $effect(() => {
    const f = app.fill;
    if (f && f.target === 'map') { prompt_ = f.text; promptTouched = true; }
  });

  const aiArgs = () => ({ backend: app.backend, model: app.models[app.backend] || undefined });

  /** quick: the whole picture. precise: step 1, the empty terrain (the server decides by the setting). */
  async function renderNow() {
    await save();
    const r = await cmd('render_map', { mapId, prompt: prompt_, fidelity, variants, view: camSelected, ...(camSelected === 'custom' ? { cameraText: viewText } : {}), consolidate, ...aiArgs() });
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
    const r = await cmd('paint_map_props', { mapId, prompt: prompt_, variants: 1, consolidate, ...aiArgs() });
    if (r) promptTouched = true;
  }
  /** one object came out wrong: paint just this group again on the finished picture (a new roll; the rest is untouched) */
  async function repaintGroup(g: Group) {
    await save();
    const r = await cmd('repaint_map_group', { mapId, group: g.id, ...aiArgs() });
    if (r) {
      view = 'painted';
      say(`Painting “${g.kind.replace(/_/g, ' ')}” (group ${g.id.slice(1)}) again…`);
    }
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
  // ---- import: a picture the GM already has becomes the map's picture --------------------------------
  let imp = $state<Picture | null>(null);
  let impMode = $state<FitMode>('fit');
  let impBars = $state('#0b0d12');
  let impMatch = $state(false);
  let impCols = $state(24);
  let impAs = $state<'render' | 'terrain'>('render');
  let impBusy = $state(false);
  let impCanvas = $state<HTMLCanvasElement | null>(null);

  /** the size of the picture the map needs — and, when the map is made to match, the grid / canvas it gets */
  const impTarget = $derived.by(() => {
    if (!doc || !imp) return null;
    if (!impMatch) return { w: dim.w, h: dim.h, cell: dim.cell, cols: doc.grid.cols, rows: doc.grid.rows, grid: null as { cols: number; rows: number } | null, size: null as { w: number; h: number } | null };
    if (doc.kind === 'battle') {
      const g = gridForPicture(imp.w, imp.h, impCols);
      const s = imageSize({ ...$state.snapshot(doc), grid: { ...doc.grid, ...g } } as MapDoc);
      return { w: s.w, h: s.h, cell: s.cell, cols: g.cols, rows: g.rows, grid: g, size: null };
    }
    const sz = sizeForPicture(imp.w, imp.h);
    return { w: sz.w, h: sz.h, cell: 0, cols: 0, rows: 0, grid: null, size: sz };
  });
  const impSameShape = $derived(!!imp && !!impTarget && Math.abs(imp.w / imp.h - impTarget.w / impTarget.h) < 0.03);

  // the preview is the picture as it will be stored, with the grid over it
  $effect(() => {
    const c = impCanvas;
    const t = impTarget;
    const p = imp;
    const mode = impMode;
    const bars = impBars;
    if (!c || !t || !p) return;
    const k = Math.min(1, 560 / Math.max(t.w, t.h));
    scaleOnto(c, p, Math.round(t.w * k), Math.round(t.h * k), mode, bars);
    if (battle && t.cell) {
      const g = c.getContext('2d')!;
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= t.cols; x++) { g.moveTo(x * t.cell * k + 0.5, 0); g.lineTo(x * t.cell * k + 0.5, t.rows * t.cell * k); }
      for (let y = 0; y <= t.rows; y++) { g.moveTo(0, y * t.cell * k + 0.5); g.lineTo(t.cols * t.cell * k, y * t.cell * k + 0.5); }
      g.stroke();
    }
  });

  function pickImport(e: Event & { currentTarget: HTMLInputElement }) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (f) void startImport(f);
  }
  async function startImport(f: File) {
    try {
      const pic = await loadPicture(f);
      imp?.bitmap.close();
      imp = pic;
      impCols = doc?.grid.cols ?? 24;
      impMatch = false;
      impAs = 'render';
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    }
  }
  function dropImport() {
    imp?.bitmap.close();
    imp = null;
  }
  async function runImport() {
    const t = impTarget;
    if (!doc || !imp || !t || !nodeId) return;
    impBusy = true;
    try {
      // the map first (the server counts on the saved grid / canvas to know the size of the picture), then the picture
      if (impMatch) {
        if (t.grid) resize(t.grid.cols, t.grid.rows);
        else if (t.size) setSize(t.size.w, t.size.h);
      }
      dirty = true;
      await save();
      const c = document.createElement('canvas');
      scaleOnto(c, imp, t.w, t.h, impMode, impBars);
      const as = staged ? impAs : 'render';
      const r = await importMapPicture(mapId, await toPngBlob(c), as);
      if (!r.ok) {
        say(r.error);
        return;
      }
      const file = String(r.json.file);
      if (as === 'terrain') view = 'terrain';
      else {
        shownRender = file;
        view = 'painted';
      }
      say(as === 'terrain' ? 'Picture imported as the terrain — paint the props onto it in step 2' : 'Picture imported', 'ok');
      dropImport();
      void loadPaint();
    } finally {
      impBusy = false;
    }
  }

  const cancel = () => fetch('/api/images/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

  const painted = $derived(shownRender ?? doc?.renders.at(-1) ?? null);
  const lettersStr = $derived(doc && (view === 'painted' || view === 'terrain') && showNames && !(view === 'painted' && painted && doc.lettered?.[painted]) ? lettersSvg(placed, { all: true }) : '');
  const FIDELITY_HINT = { faithful: 'keeps the plan exactly, flatter look', balanced: 'good mix of fidelity and painting', painterly: 'richest look, may drift from the plan' };
  const TERRAIN_HINT = { faithful: 'sticks closely to your walls and floors', balanced: 'creative, but keeps the rooms where they are', painterly: 'freest — rooms may shift a little' };

  const regionTools: { id: Tool; label: string; icon: string; tip: string }[] = [
    { id: 'select', label: 'Select', icon: '⇱', tip: 'Click a shape to select it; drag to move it, drag a white corner to reshape, Alt-click a corner removes it, Delete removes the shape' },
    { id: 'polygon', label: 'Area', icon: '⬠', tip: 'Click points; Enter or double-click to finish' },
    { id: 'path', label: 'Line', icon: '〰', tip: 'River, road, rail… click points; Enter or double-click to finish; the width is set in the Draw tab' },
    { id: 'brush', label: 'Scribble', icon: '✎', tip: 'Freehand brush in the chosen terrain' },
    { id: 'ellipse', label: 'Blob', icon: '◯', tip: 'Drag from the centre outwards' },
    { id: 'pin', label: 'Stamp', icon: '⚑', tip: 'Click to put a structure of its usual size; drag outwards to size it' },
    { id: 'label', label: 'Name', icon: 'Aa', tip: 'Click to name a spot; drag a rectangle to name an area — the name then stands above, in the middle of or below it. Printed on the finished picture in the style you choose (Map tab).' },
  ];
  const battleTools: { id: Tool; label: string; icon: string; tip: string }[] = [
    { id: 'select', label: 'Select', icon: '⇱', tip: 'Click a prop, token, label or door — or drag a box over cells. Drag to move (Alt = copy), arrow keys nudge, Delete removes, R rotates, Ctrl+D duplicates' },
    { id: 'rect', label: 'Room', icon: '▭', tip: 'Drag a rectangle (walls are added automatically)' },
    { id: 'paint', label: 'Paint', icon: '🖌', tip: 'Paint floor cells' },
    { id: 'erase', label: 'Erase', icon: '⌫', tip: 'Remove floor' },
    { id: 'door', label: 'Door', icon: '🚪', tip: 'Click a cell border (click again to remove)' },
    { id: 'wall', label: 'Wall', icon: '▮', tip: 'Add/remove an inner wall on a cell border' },
    { id: 'prop', label: 'Prop', icon: '▣', tip: 'Place furniture (R rotates, click to remove)' },
    { id: 'label', label: 'Name', icon: 'Aa', tip: 'Click a cell to name it; drag a rectangle (a room) to name an area — the name then stands above, in the middle of or below it. Printed on the finished picture in the style you choose (Map tab).' },
    { id: 'token', label: 'Token', icon: '●', tip: 'Start positions (for the VTT)' },
  ];
</script>

<!-- a file dropped anywhere else must not make the browser open it and leave the app -->
<svelte:window {onkeydown} {onkeyup} ondragover={(e) => e.dataTransfer?.types.includes('Files') && e.preventDefault()} ondrop={(e) => e.dataTransfer?.types.includes('Files') && e.preventDefault()} />

{#snippet nameOpts(place: LabelPlace, style: string | undefined, size: LabelSize | undefined, show: boolean, set: (p: NameSet) => void)}
  <div class="label">Stands</div>
  <div class="seg w">{#each LABEL_PLACES as pl}<button class:on={place === pl} onclick={() => set({ place: pl })}>{pl}</button>{/each}</div>
  <div class="label">Lettering style</div>
  <select class="field" value={style ?? ''} onchange={(e) => set({ style: e.currentTarget.value || null })}>
    <option value="">The map’s style ({styleInfo(doc?.lettering?.style).name})</option>
    {#each LABEL_STYLES as st}<option value={st.id}>{st.name}</option>{/each}
  </select>
  <div class="label">Size</div>
  <div class="seg w">{#each ['sm', 'md', 'lg'] as sz}<button class:on={(size ?? 'md') === sz} onclick={() => set({ size: sz === 'md' ? null : (sz as LabelSize) })}>{sz === 'sm' ? 'small' : sz === 'md' ? 'normal' : 'large'}</button>{/each}</div>
  <label class="chk"><input type="checkbox" checked={show} onchange={(e) => set({ show: e.currentTarget.checked })} /> print it on the picture</label>
{/snippet}

{#snippet namePanel(L: MapDoc['labels'][number], withDelete: boolean)}
  <div class="label">Name</div>
  <input class="field" value={L.text} onchange={(e) => edit([{ op: 'edit_label', x: L.x, y: L.y, text: e.currentTarget.value }])} />
  {@render nameOpts(L.place ?? 'middle', L.style, L.size, L.show !== false, (p) => edit([{ op: 'edit_label', x: L.x, y: L.y, ...p }]))}
  {#if L.area}
    <div class="dim">Stands next to an area of {Math.round(L.area.w)}×{Math.round(L.area.h)}{battle ? ' cells' : ' px'}. <button class="lnk" onclick={() => edit([{ op: 'edit_label', x: L.x, y: L.y, area: null }])}>Make it a point</button></div>
  {:else}
    <div class="dim">A point. With the Name tool, drag a rectangle to give a name an area — then it can stand above or below it.</div>
  {/if}
  {#if withDelete}<div class="acts"><button class="btn sm danger" onclick={() => { edit([{ op: 'remove_label', x: L.x, y: L.y }]); sel = null; }}>Delete</button></div>{/if}
{/snippet}

{#snippet namesSection()}
  <div class="step"><b>Aa</b> Names on the picture <span class="dim">({printable} to print)</span></div>
  <select class="field" value={doc?.lettering?.style ?? DEFAULT_LABEL_STYLE} onchange={(e) => setLettering(e.currentTarget.value)}>
    {#each LABEL_STYLES as st}<option value={st.id}>{st.name} — {st.setting}</option>{/each}
  </select>
  <p class="dim">The AI never paints text: names are set as lettering over the finished picture, in the style of your choice (a single name can have its own). They also show in the plan.</p>
  {#if doc?.renders.length}
    <button class="btn sm" disabled={printing || !printable} onclick={printOnPicture}>{printing ? 'Printing…' : 'Print the names on the picture'}</button>
    <p class="dim">A new picture is added; the painted one stays as it is. Print again after changing names or styles.</p>
  {:else}
    <p class="dim">Once the map is painted, the names can be printed on the finished picture.</p>
  {/if}
  <label class="chk"><input type="checkbox" bind:checked={showNames} /> show the names over painted pictures</label>
{/snippet}

<div class="scrim" role="presentation">
  <div class="modal" data-tour="map-modal" role="dialog" aria-label="Map editor">
    <header>
      <span class="logo">⌗</span>
      {#if doc}<input class="nm field" value={doc.name} onchange={(e) => rename(e.currentTarget.value)} />{/if}
      <span class="chip">{battle ? `${doc?.grid.cols}×${doc?.grid.rows} · ${doc?.grid.unit} ft/cell` : `${doc?.size.w}×${doc?.size.h}px`}</span>
      <span class="status">{status || 'Autosave on'}</span>
      <span class="grow"></span>
      <div class="seg" data-tour="map-views">
        <button class:on={view === 'plan'} onclick={() => (view = 'plan')} title="Editable plan">Plan</button>
        <button class:on={view === 'control'} onclick={() => (view = 'control')} title={staged ? 'What the model receives in step 1: the empty place' : 'What the image model receives'}>{staged ? 'Terrain input' : 'Model input'}</button>
        {#if staged}<button class:on={view === 'terrain'} disabled={!doc?.terrainPick} onclick={() => (view = 'terrain')} title="The painted terrain you picked (step 1)">Terrain</button>{/if}
        <button data-tour="map-view-painted" class:on={view === 'painted'} disabled={!painted} onclick={() => (view = 'painted')} title={staged ? 'Latest finished painting (step 2)' : 'Latest painted render'}>Painted</button>
      </div>
      <button class="btn ghost" disabled={!canUndo} onclick={undo} title="Undo (Ctrl+Z)">↶</button>
      <button class="btn ghost" disabled={!canRedo} onclick={redo} title="Redo">↷</button>
      <button class="btn ghost" onclick={fit} title="Fit to window">⤢</button>
      <button class="btn" onclick={close} title="Close (Esc) — everything is already saved">Done</button>
    </header>

    <div class="body">
      <nav class="tools" data-tour="map-tools">
        {#each battle ? battleTools : regionTools as t}
          <button class:on={tool === t.id} title={t.tip} onclick={() => { tool = t.id; pending = []; selected = null; sel = null; moving = null; if (t.id === 'token' && battle) panel = 'cast'; if (!battle && panel === 'cast') panel = 'draw'; }}><i>{t.icon}</i><span>{t.label}</span></button>
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
                {#if selToken.node && app.nodes[selToken.node] && !app.nodes[selToken.node].trashed}
                  {@const who = app.nodes[selToken.node]}
                  <div class="tie"><b>{who.title}</b><span class="dim">{who.type} · tied to its node</span></div>
                  <div class="acts"><button class="btn sm" onclick={() => selectNode(who.id)}>Open node</button><button class="btn sm" onclick={() => edit([{ op: 'edit_token', x: selToken.x, y: selToken.y, node: null }])}>Untie</button></div>
                {:else}
                  <select class="field" value={selToken.kind} onchange={(e) => edit([{ op: 'edit_token', x: selToken.x, y: selToken.y, kind: e.currentTarget.value as 'pc' | 'npc' | 'enemy' }])}><option value="enemy">enemy</option><option value="npc">NPC</option><option value="pc">player start (test)</option></select>
                  {#if cast.length && selToken.kind !== 'pc'}
                    <select class="field" value="" onchange={(e) => { const w = app.nodes[e.currentTarget.value]; if (w) edit([{ op: 'edit_token', x: selToken.x, y: selToken.y, node: w.id, kind: tokenKindOf(w), label: selToken.label || w.title }]); }}>
                      <option value="">Tie to a character…</option>
                      {#each cast as c}<option value={c.id}>{c.title}</option>{/each}
                    </select>
                  {/if}
                {/if}
                <div class="label">Name</div>
                <input class="field" value={selToken.label ?? ''} onchange={(e) => edit([{ op: 'edit_token', x: selToken.x, y: selToken.y, label: e.currentTarget.value }])} />
                <div class="acts"><button class="btn sm" onclick={duplicateSel}>⧉ Duplicate</button><button class="btn sm danger" onclick={deleteSel}>Delete</button></div>
              {:else if sel.t === 'label' && selLabel}
                {@render namePanel(selLabel, false)}
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
            {:else}
              <div class="dim">Click a shape, drag to move it. Its properties are in the <button class="lnk" onclick={() => (panel = 'draw')}>Draw</button> tab →</div>
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
              {#if tokenNode && app.nodes[tokenNode]}
                <div class="tie"><b>{app.nodes[tokenNode].title}</b><span class="dim">a character — click the plan</span></div>
                <button class="btn sm" onclick={() => (tokenNode = null)}>Plain marker instead</button>
              {:else}
                <select class="field" bind:value={tokenKind}><option value="enemy">enemy</option><option value="npc">NPC</option><option value="pc">player start (test)</option></select>
                <div class="dim">A plain marker. Pick a character in the <button class="lnk" onclick={() => (panel = 'cast')}>Characters</button> tab to put a real one.</div>
              {/if}
            {/if}
          {:else}
            <div class="dim">Kinds, line width and the properties of the selected shape are in the <button class="lnk" onclick={() => (panel = 'draw')}>Draw</button> tab →</div>
          {/if}
        </div>
      </nav>

      <div class="vp" data-tour="map-view" bind:this={vp} role="application" {onwheel} {onpointerdown} {onpointermove} {onpointerup} {ondblclick} {ondragover} {ondrop} ondragleave={() => (dropping = false)} oncontextmenu={(e) => e.preventDefault()} style="cursor:{spaceDown || panning ? 'grab' : tool === 'select' ? 'default' : 'crosshair'}">
        {#if doc}
          <div class="stage" bind:this={stage} style="width:{dim.w}px;height:{dim.h}px;transform:translate({tx}px,{ty}px) scale({k})">
            {#if view === 'painted' && painted}
              <img src={`/api/images/${painted}`} alt="painted map" draggable="false" style="width:{dim.w}px;height:{dim.h}px" />
            {:else if view === 'terrain' && doc.terrainPick}
              <img src={`/api/images/${doc.terrainPick}`} alt="painted terrain" draggable="false" style="width:{dim.w}px;height:{dim.h}px" />
            {:else}
              {@html svgStr}
            {/if}
            {#if lettersStr}<svg class="ov" width={dim.w} height={dim.h} viewBox="0 0 {dim.w} {dim.h}">{@html lettersStr}</svg>{/if}
            <svg class="ov" width={dim.w} height={dim.h} viewBox="0 0 {dim.w} {dim.h}">
              {#if (showGroups || hotGroup) && (view === 'plan' || view === 'control' || view === 'terrain')}
                {#each groups.filter((x) => showGroups || x.id === hotGroup) as g (g.id)}
                  <rect class="grp" class:hot={g.id === hotGroup} x={g.rect.x} y={g.rect.y} width={g.rect.w} height={g.rect.h} rx="4" />
                  <text class="grpid" x={g.rect.x + 3} y={g.rect.y + 13}>{g.id.slice(1)}</text>
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
                {#if drag && (tool === 'rect' || tool === 'select' || tool === 'label')}
                  {@const a = cellOf(drag.a)}{@const b = cellOf(drag.b)}
                  <rect class="sel" x={Math.min(a.x, b.x) * dim.cell} y={Math.min(a.y, b.y) * dim.cell} width={(Math.abs(a.x - b.x) + 1) * dim.cell} height={(Math.abs(a.y - b.y) + 1) * dim.cell} />
                {/if}
              {:else if !battle && view === 'plan'}
                {#each fresh.rects as r}<rect class="fresh" x={r.x} y={r.y} width={r.w} height={r.h} />{/each}
                {#if pending.length}
                  <polyline class="pend" style={tool === 'path' ? `stroke:${kindOf(kind).color};stroke-width:${lineWidth ?? kindOf(kind).width ?? 14};opacity:.75;fill:none` : `stroke:${kindOf(kind).color}`} points={[...pending, ...(pointerPos ? [[pointerPos.x, pointerPos.y]] : [])].map((q) => q.join(',')).join(' ')} />
                  {#each pending as q}<circle cx={q[0]} cy={q[1]} r="4" class="dot" />{/each}
                {/if}
                {#if strokePts.length}<polyline class="pend" style="stroke:{kindOf(kind).color};stroke-width:{brush};opacity:.7;fill:none" points={strokePts.map((q) => q.join(',')).join(' ')} />{/if}
                {#if drag && tool === 'label'}<rect class="sel" x={Math.min(drag.a.x, drag.b.x)} y={Math.min(drag.a.y, drag.b.y)} width={Math.abs(drag.b.x - drag.a.x)} height={Math.abs(drag.b.y - drag.a.y)} />{/if}
                {#if sel?.t === 'label' && selNameBox}<rect class="sel" x={selNameBox.x} y={selNameBox.y} width={selNameBox.w} height={selNameBox.h} />{/if}
                {#if drag && tool === 'ellipse'}<ellipse class="sel" cx={drag.a.x} cy={drag.a.y} rx={Math.abs(drag.b.x - drag.a.x)} ry={Math.abs(drag.b.y - drag.a.y)} />{/if}
                {#if drag && tool === 'pin'}<circle class="sel" cx={drag.a.x} cy={drag.a.y} r={Math.hypot(drag.b.x - drag.a.x, drag.b.y - drag.a.y) > 8 ? Math.hypot(drag.b.x - drag.a.x, drag.b.y - drag.a.y) : (stampR ?? kindOf(kind).size ?? 20)} style="fill:{kindOf(kind).color};fill-opacity:.35" />{:else if pointerPos && tool === 'pin' && !painting}<circle class="sel" cx={pointerPos.x} cy={pointerPos.y} r={stampR ?? kindOf(kind).size ?? 20} style="fill:{kindOf(kind).color};fill-opacity:.25" />{/if}
                {#if selected}
                  {@const s = doc.shapes.find((x) => x.id === selected)}
                  {#if s}
                    <g transform={shapeMove ? `translate(${shapeMove.dx} ${shapeMove.dy})` : ''}>
                    {#if s.type === 'polygon'}<polygon class="sel" points={s.points.map((q) => q.join(',')).join(' ')} />
                    {:else if s.type === 'path'}<polyline class="sel" style="fill:none" points={s.points.map((q) => q.join(',')).join(' ')} />
                    {:else if s.type === 'ellipse'}<ellipse class="sel" cx={s.points[0][0]} cy={s.points[0][1]} rx={s.points[1]?.[0] ?? 30} ry={s.points[1]?.[1] ?? 30} />
                    {:else}<circle class="sel" cx={s.points[0][0]} cy={s.points[0][1]} r={(s.r ?? 14) + 6} />{/if}
                    </g>
                    {#if tool === 'select' && (s.type === 'polygon' || s.type === 'path')}
                      {#each s.points as q, qi}<circle class="vh" cx={q[0]} cy={q[1]} r={5 / k} />{/each}
                    {/if}
                  {/if}
                {/if}
              {/if}
            </svg>
          </div>
        {:else}
          <div class="loading">loading…</div>
        {/if}
        {#if view === 'control'}<div class="hint">This is exactly what the image model receives: flat colours, no text.</div>{/if}
        {#if dropping}<div class="dropveil">Drop a picture to import it as this map's picture</div>{/if}
      </div>

      {#if ctx && doc}
        <!-- The menu opens on pointerup. On Windows the browser's contextmenu event comes AFTER that and lands on this scrim or
             on the menu itself: it must only be swallowed there, not close the menu again. A right press outside closes it. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="ctx-scrim" onclick={closeCtx} onpointerup={(e) => e.button === 2 && reopenCtx(e)} oncontextmenu={(e) => e.preventDefault()}></div>
        <div class="cmenu" role="menu" tabindex="-1" oncontextmenu={(e) => e.preventDefault()} style="left:{ctxPos.left}px; top:{ctxPos.top}px; width:300px">
          {#if selToken || selProp || selLabel || selDoor || sel?.t === 'area' || selShape}
            <div class="ctx-head"><b>{selToken ? (selToken.label || 'Token') : selProp ? (selProp.label || selProp.kind.replace('_', ' ')) : selLabel ? selLabel.text : selDoor ? 'Door' : sel?.t === 'area' ? `Area ${sel.w}×${sel.h}` : (selShape?.label || kindOf(selShape!.kind).name)}</b></div>
            {#if selToken || selProp || selLabel || selShape}<button class="ctx-item" role="menuitem" onclick={act(renameSel)}>✎ Rename…</button>{/if}
            {#if selToken?.node && app.nodes[selToken.node]}<button class="ctx-item" role="menuitem" onclick={act(() => selectNode(selToken!.node!))}>↗ Open character</button>{/if}
            {#if selProp}<button class="ctx-item" role="menuitem" onclick={act(rotateSel)}>⟳ Rotate <span class="sp"></span><span class="dim">R</span></button>{/if}
            {#if selProp}
              <button class="ctx-item" class:on={ctxSub === 'prop'} role="menuitem" onclick={() => (ctxSub = ctxSub === 'prop' ? null : 'prop')}>▣ Change kind <span class="sp"></span><span class="dim">▸</span></button>
              {#if ctxSub === 'prop'}<div class="ctx-sub">{#each PROP_KINDS as pk}<button class="ctx-item" class:on={selProp.kind === pk} onclick={act(() => edit([{ op: 'edit_prop', id: selProp!.id, kind: pk }]))}>{pk.replace('_', ' ')}</button>{/each}</div>{/if}
            {/if}
            {#if selToken}
              <button class="ctx-item" class:on={ctxSub === 'token'} role="menuitem" onclick={() => (ctxSub = ctxSub === 'token' ? null : 'token')}>● Change side <span class="sp"></span><span class="dim">▸</span></button>
              {#if ctxSub === 'token'}<div class="ctx-sub">{#each ['pc', 'npc', 'enemy'] as tk}<button class="ctx-item" class:on={selToken.kind === tk} onclick={act(() => edit([{ op: 'edit_token', x: selToken!.x, y: selToken!.y, kind: tk as 'pc' | 'npc' | 'enemy' }]))}>{tk}</button>{/each}</div>{/if}
            {/if}
            {#if selDoor}
              {#each DOOR_KINDS as dk}<button class="ctx-item" class:on={selDoor.kind === dk} role="menuitem" onclick={act(() => edit([{ op: 'door', x: selDoor!.x, y: selDoor!.y, side: selDoor!.side, kind: dk }]))}>🚪 {dk}</button>{/each}
            {/if}
            {#if sel?.t === 'area'}
              <button class="ctx-item" class:on={ctxSub === 'floor'} role="menuitem" onclick={() => (ctxSub = ctxSub === 'floor' ? null : 'floor')}>▭ Fill with floor <span class="sp"></span><span class="dim">▸</span></button>
              {#if ctxSub === 'floor'}<div class="ctx-sub">{#each Object.values(FLOORS) as fl}<button class="ctx-item" onclick={act(() => fillSel(fl.name))}><span style="color:{fl.color}">■</span> {fl.name}</button>{/each}</div>{/if}
            {/if}
            {#if selShape}
              <button class="ctx-item" class:on={ctxSub === 'kind'} role="menuitem" onclick={() => (ctxSub = ctxSub === 'kind' ? null : 'kind')}>◈ Change type <span class="sp"></span><span class="dim">▸</span></button>
              {#if ctxSub === 'kind'}<div class="ctx-sub">{#each ctxKinds as kd}<button class="ctx-item" class:on={selShape.kind === kd.id} onclick={act(() => changeKind(kd.id))}><span style="color:{kd.color}">■</span> {kd.name}</button>{/each}</div>{/if}
              <button class="ctx-item" role="menuitem" onclick={act(() => reorderShape(true))}>⤒ Bring to front</button>
              <button class="ctx-item" role="menuitem" onclick={act(() => reorderShape(false))}>⤓ Send to back</button>
            {/if}
            {#if selShape || (sel && sel.t !== 'door')}<button class="ctx-item" role="menuitem" onclick={act(() => (selShape ? duplicateShape() : duplicateSel()))}>⧉ Duplicate <span class="sp"></span><span class="dim">Ctrl+D</span></button>{/if}
            <button class="ctx-item danger" role="menuitem" onclick={act(() => (selShape ? (edit([{ op: 'remove_shape', id: selShape.id }]), (selected = null)) : deleteSel()))}>🗑 Delete <span class="sp"></span><span class="dim">Del</span></button>
            <div class="ctx-sep"></div>
          {:else}
            <div class="ctx-head"><b>{battle ? 'Cell ' + (inGrid(ctx.c) ? `${ctx.c.x + 1}, ${ctx.c.y + 1}` : '(outside)') : 'Map'}</b></div>
            <button class="ctx-item" role="menuitem" disabled={battle && !inGrid(ctx.c)} onclick={act(nameHere)}>Aa Name here…</button>
            {#if battle}
              <button class="ctx-item" class:on={ctxSub === 'prop'} role="menuitem" disabled={!inGrid(ctx.c)} onclick={() => (ctxSub = ctxSub === 'prop' ? null : 'prop')}>▣ Add prop here <span class="sp"></span><span class="dim">▸</span></button>
              {#if ctxSub === 'prop'}<div class="ctx-sub">{#each PROP_KINDS as pk}<button class="ctx-item" onclick={act(() => propHere(pk))}>{pk.replace('_', ' ')}</button>{/each}</div>{/if}
              <button class="ctx-item" class:on={ctxSub === 'token'} role="menuitem" disabled={!inGrid(ctx.c)} onclick={() => (ctxSub = ctxSub === 'token' ? null : 'token')}>● Add token here <span class="sp"></span><span class="dim">▸</span></button>
              {#if ctxSub === 'token'}
                <div class="ctx-sub">
                  {#each ['enemy', 'npc', 'pc'] as tk}<button class="ctx-item" onclick={act(() => tokenHere(tk as 'pc' | 'npc' | 'enemy'))}>plain {tk} marker</button>{/each}
                  {#each cast as cc (cc.id)}<button class="ctx-item" onclick={act(() => placeHere(cc.id))}><span style="color:{NODE_TYPE_INFO[cc.type].color}">{NODE_TYPE_INFO[cc.type].icon}</span> {cc.title}</button>{/each}
                </div>
              {/if}
              <button class="ctx-item" role="menuitem" onclick={act(() => (tool = 'select'))}>⇱ Select tool</button>
            {/if}
          {/if}
          <button class="ctx-item" role="menuitem" disabled={!canUndo} onclick={act(undo)}>↶ Undo <span class="sp"></span><span class="dim">Ctrl+Z</span></button>
          <button class="ctx-item" role="menuitem" disabled={!canRedo} onclick={act(redo)}>↷ Redo <span class="sp"></span><span class="dim">Ctrl+Shift+Z</span></button>
          <button class="ctx-item" role="menuitem" onclick={act(fit)}>⤢ Fit to window</button>
          <button class="ctx-item" role="menuitem" onclick={act(() => (showNames = !showNames))}>Aa {showNames ? 'Hide' : 'Show'} names</button>
          <button class="ctx-item" role="menuitem" onclick={act(() => { const n = prompt('Map name', doc?.name ?? ''); if (n !== null) rename(n); })}>✎ Rename map…</button>
        </div>
      {/if}

      <aside class="side">
        <div class="tabs" data-tour="map-tabs">
          {#if !battle}<button data-tour="map-tab-draw" class:on={panel === 'draw'} onclick={() => (panel = 'draw')} title="Kinds, line width, the properties of the selected shape">Draw</button>{/if}
          <button data-tour="map-tab-paint" class:on={panel === 'render'} onclick={() => (panel = 'render')}>Paint</button>
          {#if battle}<button data-tour="map-tab-cast" class:on={panel === 'cast'} onclick={() => (panel = 'cast')} title="The NPCs and enemies of this place, and their tokens">Characters{#if cast.length} <span class="dim">{placedTotal}/{cast.length}</span>{/if}</button>{/if}
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
          {#snippet planView()}
            {#if plan}
              {#if plan.orphans.length}
                <div class="warn" role="alert">
                  ⚠ {plan.orphans.length === 1 ? 'One shape' : `${plan.orphans.length} shapes`} on this map will not be painted:
                  <ul class="orph">{#each plan.orphans as o (o.id)}<li>{o.why}</li>{/each}</ul>
                </div>
              {/if}
              <details class="plan"><summary>What gets painted</summary><ul>{#each plan.passes as line}<li class="dim">{line}</li>{/each}</ul></details>
            {/if}
          {/snippet}
          {#snippet cameraView()}
            <div class="label" data-tour="map-camera">Camera <span class="dim">— {staged && !battle ? 'how the land is painted' : 'where the map is seen from'}</span></div>
            <div class="cams" class:two={cameras.length === 2} role="radiogroup" aria-label="Camera">
              {#each cameras as c (c.id)}
                <button class="cam" class:on={camSelected === c.id} role="radio" aria-checked={camSelected === c.id} aria-label={c.name} title={`${c.name} — ${c.hint}`} onclick={() => pickCamera(c.id)}><CameraIcon kind={c.icon} /></button>
              {/each}
            </div>
            {#each cameras.filter((c) => c.id === camSelected) as c (c.id)}<div class="dim"><b>{c.name}</b> — {c.hint}</div>{/each}
            {#if camSelected === 'custom'}
              <textarea class="field" rows="2" maxlength="300" placeholder="Describe the camera, e.g. a vertical cross-section of the tower seen from the side, one floor above the other" bind:value={viewText} oninput={cameraTextInput}></textarea>
              <div class="dim">{camMissing ? 'Describe the camera to paint with it. ' : ''}The plan the model is given is drawn from above, so a very different angle follows it only loosely. How things look (materials, colours) is the image style's job, not the camera's.</div>
            {/if}
          {/snippet}
          {#snippet importView()}
            <div class="label">Your own picture</div>
            <label class="btn" class:off={impBusy} title="Use a picture you already have as this map's picture (PNG, JPEG, WebP…)">⬆ Import a picture…<input type="file" accept={PICTURE_ACCEPT} hidden disabled={impBusy} data-tour="map-import" onchange={pickImport} /></label>
            {#if imp && impTarget}
              <div class="imp">
                <div class="dim"><b>{imp.name}</b> · {imp.w}×{imp.h} px</div>
                <canvas class="impview" bind:this={impCanvas}></canvas>
                <div class="dim">Scaled to {impTarget.w}×{impTarget.h} px{battle ? ` — ${impTarget.cols}×${impTarget.rows} cells` : ''}, the size this map is painted at.</div>
                <div class="label">Scaling</div>
                <div class="seg w">
                  {#each FIT_MODES as m (m.id)}<button class:on={impMode === m.id} title={m.hint} onclick={() => (impMode = m.id)}>{m.label}</button>{/each}
                </div>
                <div class="dim">{FIT_MODES.find((m) => m.id === impMode)?.hint}</div>
                {#if impMode === 'fit' && !impSameShape}
                  <label class="chk">empty bars <input type="color" bind:value={impBars} aria-label="Colour of the empty bars" /></label>
                {/if}
                <label class="chk" title={battle ? 'Change the number of rows so the grid has the shape of the picture' : 'Change the canvas so it has the shape of the picture'}>
                  <input type="checkbox" bind:checked={impMatch} /> make the {battle ? 'grid' : 'canvas'} the shape of the picture
                </label>
                {#if impMatch && battle}
                  <label class="num">cells across <input class="field" type="number" min="4" max="80" bind:value={impCols} /></label>
                  <div class="dim">The grid becomes {impTarget.cols}×{impTarget.rows} cells (floors you drew stay where they are).</div>
                {:else if impMatch}
                  <div class="dim">The canvas becomes {impTarget.w}×{impTarget.h} px.</div>
                {:else if !impSameShape}
                  <div class="dim">The picture is not the shape of the map: {impMode === 'fit' ? 'there will be empty bars' : impMode === 'fill' ? 'its edges are cropped' : 'it is distorted'}. Tick the box above to change the {battle ? 'grid' : 'canvas'} instead.</div>
                {/if}
                {#if impMatch && doc?.renders.length}<p class="warn">Painted versions you already have keep their old size and may no longer fit the map.</p>{/if}
                {#if staged}
                  <div class="label">Use it as</div>
                  <div class="seg w">
                    <button class:on={impAs === 'render'} onclick={() => (impAs = 'render')} title="The finished picture of the map">finished picture</button>
                    <button class:on={impAs === 'terrain'} onclick={() => (impAs = 'terrain')} title="An empty terrain: step 2 paints the props onto it">terrain</button>
                  </div>
                  <div class="dim">{impAs === 'render' ? 'It becomes the picture shown to the players (and sent to the VTT).' : `An empty ${battle ? 'place' : 'land'}: step 2 paints the ${battle ? 'props' : 'structures'} onto it, exactly where you put them.`}</div>
                {/if}
                <div class="row">
                  <button class="btn primary grow" disabled={impBusy || !nodeId} onclick={runImport}>{impBusy ? 'Importing…' : 'Import'}</button>
                  <button class="btn ghost" disabled={impBusy} onclick={dropImport}>cancel</button>
                </div>
                {#if !nodeId}<p class="warn">This map has no map node — create it from the canvas or ask the AI.</p>{/if}
              </div>
            {/if}
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
            <div class="mode" data-tour="map-mode">Precise painting · 2 steps <button class="lnk" onclick={() => (app.settingsOpen = true)} title="Change in Settings → Map painting">change</button></div>
            <p class="warn">⏱ This takes a while — {dur(paint?.terrainSeconds ?? 0)} for the terrain, then {dur(paint?.propsSeconds ?? 0)} for {paint?.groups ?? 0} {battle ? 'prop' : 'structure'} group{paint?.groups === 1 ? '' : 's'}, on this computer{paint?.measured ? '' : ' (a rough guess until ComfyUI has made an image here)'}. You decide after each step, and you can stop at any time.</p>

            <div class="step"><b>①</b> Terrain <span class="dim">{battle ? '— the empty place, no props' : '— the land, then rivers, roads and walls along your lines; no structures'}</span></div>
            <textarea class="field" data-tour="map-prompt" rows="3" placeholder="Materials, mood, lighting, setting… (the AI turns this into a description of the empty place)" bind:value={prompt_} oninput={promptInput}></textarea>
            <div class="seg w">
              {#each ['faithful', 'balanced', 'painterly'] as f}<button class:on={fidelity === f} onclick={() => (fidelity = f as typeof fidelity)}>{f}</button>{/each}
            </div>
            <div class="dim">{TERRAIN_HINT[fidelity]}</div>
            {@render planView()}
            {@render cameraView()}
            <div class="row">
              <select class="field" bind:value={variants} title="How many terrains to paint to choose from">{#each [1, 2, 3, 4] as n}<option value={n}>{n}×</option>{/each}</select>
              <button class="btn primary grow" data-tour="map-terrain-btn" onclick={renderNow} disabled={prompt_.trim().length < 8 || !nodeId || busy || camMissing}>{doc?.terrains?.length ? 'Paint another terrain' : 'Paint the terrain'}</button>
            </div>
            <div class="row">
              <button class="btn grow" onclick={askAi} disabled={!nodeId}>✦ AI writes the description</button>
              {#if busy}<button class="btn ghost" onclick={cancel}>stop</button>{/if}
            </div>
            {#if !nodeId}<p class="warn">This map has no map node — create it from the canvas or ask the AI.</p>{/if}
            {#if doc?.terrains?.length}
              <div class="label">Terrains <span class="dim">— click the one you like</span></div>
              <div class="grid" data-tour="map-terrains">
                {#each [...doc.terrains].reverse() as f (f)}
                  <button class="th" class:on={doc.terrainPick === f} onclick={() => pickTerrain(f)} title={doc.terrainPick === f ? 'Chosen for step 2' : 'Click to choose this terrain'}>
                    <img src={`/api/images/${f}?w=320`} alt="" loading="lazy" decoding="async" />
                    {#if doc.terrainPick === f}<i class="tick">✓</i>{/if}
                  </button>
                {/each}
              </div>
            {/if}

            <div class="step"><b>②</b> {battle ? 'Props' : 'Structures'} <span class="dim">— painted into their spots</span></div>
            <p class="dim" data-tour="map-groups">{battle ? 'Touching props of the same kind are painted as one object (a row of tables is one long table).' : 'Touching structures of the same kind are painted as one object (a cluster of huts is one village). Names and wording you give a shape are used.'} <label class="chk"><input type="checkbox" bind:checked={showGroups} /> show the groups on the plan</label></p>
            {#if groups.length}
              <details class="pp" data-tour="map-prop-prompts">
                <summary>Painting prompts of the groups{#if ownPrompts} <span class="dim">· {ownPrompts} written by you</span>{/if}</summary>
                <p class="dim">Every group is painted from its own prompt. Leave one empty and the AI writes it when you paint — with no AI connected a plain default is used. Write your own to steer what appears: your wording is used exactly as it is. After a painting run, what the AI wrote is shown here so you can adjust it and paint again.</p>
                {#each groups as g (g.id)}
                  {@const e = promptOf(g)}
                  {@const vi = variantInfo[g.id]}
                  <div class="gp" class:hot={hotGroup === g.id}>
                    <div class="gh">
                      <b>{g.id.slice(1)}</b> {g.kind.replace(/_/g, ' ')}{g.count > 1 ? ` ×${g.count}` : ''}
                      {#if e?.ai && e.text}<span class="tag ai">written by the AI</span>{:else if e?.text.trim()}<span class="tag">yours</span>{/if}
                    </div>
                    <textarea class="field" rows="2" placeholder={`${defaultPrompt(g)} (default)`} value={e?.text ?? ''}
                      onfocus={() => (hotGroup = g.id)} onblur={() => (hotGroup = hotGroup === g.id ? '' : hotGroup)}
                      oninput={(ev) => setPrompt(g, ev.currentTarget.value)}></textarea>
                    <div class="gb">
                      <button class="lnk" onclick={() => setPrompt(g, defaultPrompt(g))}>use the default as a start</button>
                      {#if e?.text}<button class="lnk" onclick={() => setPrompt(g, '')}>clear</button>{/if}
                      {#if doc?.renders.length}<button class="lnk" disabled={busy} onclick={() => repaintGroup(g)} title="Paint only this group again on the finished picture, with a new seed — the rest of the picture is not touched">↻ paint this one again</button>{/if}
                    </div>
                    {#if vi?.v && vi.v.variants.length > 1}
                      <div class="vars">
                        <span class="dim">Paintings of this group — click one to bring it back:</span>
                        <div class="vstrip">
                          {#each vi.v.variants as x, k (x.id)}
                            <button class="vth" class:on={vi.v.pick === x.id} disabled={busy || vi.v.pick === x.id} title={`${k + 1}. painting · ${x.seed ? `seed ${x.seed} · ` : ''}${when(x.at)}${vi.v.pick === x.id ? ' — in the picture now' : ' — click to use it, double-click to see the whole picture'}${x.text ? `\n${x.text}` : ''}`} onclick={() => pickVariant(g, x.id)} ondblclick={() => nodeId && (app.lightbox = { nodeId, file: x.file })}>
                              <span class="vimg" style={thumbStyle(x.file, vi.win)}></span><i>{k + 1}</i>
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                {/each}
              </details>
            {/if}
            {#if groups.length}
              <label class="chk" title="After the objects are painted, the surroundings of each one are blended into the picture: shadows appear, edges settle. Takes one more pass."><input type="checkbox" bind:checked={consolidate} /> blend the {battle ? 'props' : 'structures'} into the picture at the end <span class="dim">(+1 pass)</span></label>
            {/if}
            {#if !groups.length}
              <p class="warn">This map has no {battle ? 'props' : 'structures'}. Accept a terrain as the finished picture, or {battle ? 'place some props' : 'draw some structures'} first.</p>
              <button class="btn primary" onclick={acceptTerrain} disabled={!doc?.terrainPick || busy}>Use the chosen terrain as the finished picture</button>
            {:else}
              <button class="btn primary" data-tour="map-props-btn" onclick={paintProps} disabled={!doc?.terrainPick || prompt_.trim().length < 8 || !nodeId || busy}>
                {doc?.renders.length ? `Paint the ${battle ? 'props' : 'structures'} again` : `Paint the ${battle ? 'props' : 'structures'} on the chosen terrain`}
              </button>
              {#if !doc?.terrainPick}<div class="dim">Choose a terrain above first.</div>{/if}
            {/if}
            {@render jobsView()}
            {@render rendersView()}
            {@render importView()}
            {#if doc?.renders.length}<div class="dim">Not happy? Paint the {battle ? 'props' : 'structures'} again for a new variation, choose another terrain — or, if just one object came out wrong, open <i>Painting prompts of the groups</i> and use <b>↻ paint this one again</b> on it.</div>{/if}
          {:else}
            <div class="label">What does the place look like?</div>
            <textarea class="field" rows="4" placeholder="Materials, mood, lighting, setting… (not the layout — that comes from your plan)" bind:value={prompt_} oninput={promptInput}></textarea>
            <div class="label">Fidelity ↔ creativity</div>
            <div class="seg w">
              {#each ['faithful', 'balanced', 'painterly'] as f}<button class:on={fidelity === f} onclick={() => (fidelity = f as typeof fidelity)}>{f}</button>{/each}
            </div>
            <div class="dim">{FIDELITY_HINT[fidelity]}</div>
            {@render planView()}
            {@render cameraView()}
            <div class="row">
              <select class="field" bind:value={variants} title="Variants">{#each [1, 2, 3, 4] as n}<option value={n}>{n}×</option>{/each}</select>
              <button class="btn primary grow" onclick={renderNow} disabled={prompt_.trim().length < 8 || !nodeId || camMissing}>Paint it</button>
            </div>
            <div class="row">
              <button class="btn grow" onclick={askAi} disabled={!nodeId}>✦ AI writes the prompt</button>
              {#if busy}<button class="btn ghost" onclick={cancel}>stop</button>{/if}
            </div>
            {#if !nodeId}<p class="warn">This map has no map node — create it from the canvas or ask the AI.</p>{/if}
            {#if battle}<p class="dim">Quick painting (1 step). For props that land exactly where you put them, switch to <button class="lnk" onclick={() => (app.settingsOpen = true)}>Precise painting (2 steps)</button> in Settings.</p>{/if}
            {@render jobsView()}
            {@render rendersView()}
            {@render importView()}
          {/if}
        {:else if panel === 'draw' && doc && !battle}
          {#snippet kindGroup(title: string, list: RegionKind[])}
            <div class="label">{title}</div>
            <div class="kg">
              {#each list as kk (kk.id)}
                <button class="kb" class:on={kind === kk.id} onclick={() => pickKind(kk.id)} title={kk.prompt}><i style="background:{kk.color}"></i><span>{kk.name}</span>{#if kk.custom}<b title="your own type">★</b>{/if}</button>
              {/each}
            </div>
          {/snippet}
          {@const kk = kindOf(kind)}
          {#if tool === 'select'}
            <div class="dim">Select mode — pick a shape on the map to change it. Choose a kind below to draw again.</div>
          {:else}
            <div class="label">Drawing <b class="kn">{kk.name}</b> <span class="dim">· {kk.layer === 'structure' ? 'structure (painted into its area)' : kk.geometry === 'line' ? 'line (painted along its path)' : 'terrain'}</span></div>
          {/if}
          {#if tool === 'path'}
            <div class="label">Line width <span class="dim">{lineWidth ?? kk.width ?? 14}px{lineWidth === null ? ' · the kind’s own' : ''}</span></div>
            <input type="range" min="2" max="120" value={lineWidth ?? kk.width ?? 14} oninput={(e) => (lineWidth = +e.currentTarget.value)} />
            {#if lineWidth !== null}<button class="lnk" onclick={() => (lineWidth = null)}>use the kind’s width</button>{/if}
          {:else if tool === 'brush'}
            <div class="label">Brush {brush}px</div>
            <input type="range" min="8" max="140" bind:value={brush} />
          {:else if tool === 'pin'}
            <div class="label">Stamp radius <span class="dim">{stampR ?? kk.size ?? 20}px{stampR === null ? ' · the kind’s own' : ''} · or drag outwards on the map</span></div>
            <input type="range" min="4" max="120" value={stampR ?? kk.size ?? 20} oninput={(e) => (stampR = +e.currentTarget.value)} />
            {#if stampR !== null}<button class="lnk" onclick={() => (stampR = null)}>use the kind’s size</button>{/if}
          {/if}

          {@render kindGroup('Terrain — painted first', palette.terrain)}
          {@render kindGroup('Lines — rivers, roads, rails, bridges', palette.lines)}
          {@render kindGroup('Structures — painted into their area', palette.structures)}

          <div class="row" style="margin-top:8px">
            <button class="btn sm" onclick={newCustom}>＋ Your own type…</button>
            {#if kk.custom}<button class="btn sm" onclick={() => editCustom(kk)}>✎ Edit “{kk.name}”</button><button class="btn sm danger" onclick={() => removeCustom(kk.id)}>✕</button>{/if}
          </div>
          {#if customOpen}
            <div class="cfm">
              <div class="label">{cf.id ? 'Change your type' : 'A new type for this campaign'}</div>
              <input class="field" placeholder="Name (Radioactive crater, Ley line, Wizard tower…)" bind:value={cf.name} />
              <div class="seg w">
                {#each [['terrain', 'Terrain'], ['line', 'Line'], ['structure', 'Structure']] as [v, n]}<button class:on={cf.cls === v} onclick={() => (cf.cls = v as typeof cf.cls)}>{n}</button>{/each}
              </div>
              <div class="dim">{cf.cls === 'terrain' ? 'An area painted first, as part of the land.' : cf.cls === 'line' ? 'A multi-point path with a width, painted along its line after the land.' : 'An area painted into its exact shape after the land (a place is never a dot).'}</div>
              <label class="num">Colour on the sketch <input type="color" bind:value={cf.color} /></label>
              <textarea class="field" rows="3" placeholder="What does it look like from above? (a few words — the campaign style decides the look)" bind:value={cf.prompt}></textarea>
              {#if cf.cls === 'line'}
                <div class="row">
                  <label class="num">usual width px <input class="field" type="number" min="1" max="120" bind:value={cf.width} /></label>
                  <label class="num">painted with <select class="field" bind:value={cf.group}><option value="water">the rivers (water)</option><option value="land">roads &amp; rails (land)</option><option value="wall">walls &amp; fortifications (last)</option></select></label>
                </div>
              {:else if cf.cls === 'structure'}
                <label class="num">usual radius px <input class="field" type="number" min="3" max="200" bind:value={cf.size} /></label>
              {/if}
              <div class="row"><button class="btn primary grow" onclick={saveCustom} disabled={!cf.name.trim() || cf.prompt.trim().split(/\s+/).length < 2}>Save to the campaign</button><button class="btn ghost" onclick={() => (customOpen = false)}>Cancel</button></div>
            </div>
          {/if}

          {#if sel?.t === 'label' && selLabel}
            {@render namePanel(selLabel, true)}
          {/if}
          {#if selShape}
            {@const sk = kindOf(selShape.kind)}
            <div class="step"><b>▣</b> Selected: {sk.name}{selShape.label ? ` · “${selShape.label}”` : ''}</div>
            <div class="label">Kind</div>
            <select class="field" value={selShape.kind} onchange={(e) => changeKind(e.currentTarget.value)}>
              <optgroup label="Terrain">{#each palette.terrain as o}<option value={o.id}>{o.name}</option>{/each}</optgroup>
              <optgroup label="Lines">{#each palette.lines as o}<option value={o.id}>{o.name}</option>{/each}</optgroup>
              <optgroup label="Structures">{#each palette.structures as o}<option value={o.id}>{o.name}</option>{/each}</optgroup>
            </select>
            <div class="label">Name <span class="dim">(printed on the picture, in the lettering style of your choice)</span></div>
            <input class="field" value={selShape.label ?? ''} placeholder="Eldoria, the Greywater…" onchange={(e) => updateShape(selShape!, { label: e.currentTarget.value.trim() })} />
            {#if selShape.label}
              {@const S = selShape}
              {@render nameOpts(S.labelPlace ?? (sk.layer === 'structure' ? 'below' : 'middle'), S.labelStyle, S.labelSize, S.labelShow !== false, (p) => updateShape(S, { ...(p.place ? { labelPlace: p.place } : {}), ...('style' in p ? { labelStyle: p.style ?? undefined } : {}), ...('size' in p ? { labelSize: p.size ?? undefined } : {}), ...('show' in p ? { labelShow: p.show ? undefined : false } : {}) }))}
            {/if}
            {#if sk.layer === 'structure'}
              <div class="label">What should be painted here? <span class="dim">(optional)</span></div>
              <textarea class="field" rows="3" placeholder={`${sk.prompt} — leave empty and the AI writes it from the world's style`} value={selShape.prompt ?? ''} onchange={(e) => updateShape(selShape!, { prompt: e.currentTarget.value.trim() })}></textarea>
            {/if}
            {#if selShape.type === 'path'}
              <div class="label">Width <span class="dim">{selShape.width ?? sk.width ?? 14}px</span></div>
              <input type="range" min="2" max="120" value={selShape.width ?? sk.width ?? 14} onchange={(e) => updateShape(selShape!, { width: +e.currentTarget.value })} />
            {:else if selShape.type === 'ellipse'}
              <div class="row">
                <label class="num">width px <input class="field" type="number" min="4" max="1500" value={Math.round((selShape.points[1]?.[0] ?? 30) * 2)} onchange={(e) => updateShape(selShape!, { points: [selShape!.points[0], [Math.max(2, +e.currentTarget.value / 2), selShape!.points[1]?.[1] ?? 30]] })} /></label>
                <label class="num">height px <input class="field" type="number" min="4" max="1500" value={Math.round((selShape.points[1]?.[1] ?? 30) * 2)} onchange={(e) => updateShape(selShape!, { points: [selShape!.points[0], [selShape!.points[1]?.[0] ?? 30, Math.max(2, +e.currentTarget.value / 2)]] })} /></label>
              </div>
            {/if}
            {#if selShape.type !== 'ellipse'}<div class="dim">Drag the white corners to reshape · Alt-click a corner removes it.</div>{/if}
            <div class="acts">
              <button class="btn sm" onclick={duplicateShape} title="Ctrl+D">⧉ Duplicate</button>
              <button class="btn sm" onclick={() => reorderShape(true)} title="Draw on top of the others">▲ front</button>
              <button class="btn sm" onclick={() => reorderShape(false)} title="Draw below the others">▼ back</button>
              <button class="btn sm danger" onclick={() => { edit([{ op: 'remove_shape', id: selShape!.id }]); selected = null; }}>Delete</button>
            </div>
          {/if}
        {:else if panel === 'cast' && doc && battle}
          <div data-tour="map-cast">
            <div class="label">Characters of this place <span class="dim">({cast.length})</span></div>
            <p class="dim">NPCs and enemies that <b>belong to</b> {node ? `“${node.title}”` : 'this place'}. Put them on the plan: the token <b>is</b> the character, and pushing the map sends its sheet along — so the VTT gets the opponent <i>and</i> its token, tied together.</p>
            <div role="list">
            {#each cast as c (c.id)}
              {@const info = NODE_TYPE_INFO[c.type]}
              <div class="cc" class:on={tool === 'token' && tokenNode === c.id} style="--tc:{info.color}" role="listitem" draggable="true" ondragstart={(e) => { e.dataTransfer?.setData('application/x-pnp-token', c.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; }} title="Drag onto the plan to place it">
                {#if c.images[0]}<img src={`/api/images/${c.images[0]}?w=96`} alt="" />{:else}<span class="ic">{info.icon}</span>{/if}
                <div class="ct"><b>{c.title}</b><span class="dim">{c.type === 'enemy' ? 'enemy' : 'NPC'} · {placedOf(c.id) ? `${placedOf(c.id)} on the plan` : 'not placed'}{hasSheet(c) ? '' : ' · no sheet yet'}</span></div>
                <button class="btn sm" class:primary={tool === 'token' && tokenNode === c.id} onclick={() => startPlacing(c.id)} title="Then click a cell of the plan; click a token to take it away again">{placedOf(c.id) ? '＋ another' : 'Place'}</button>
                <button class="lnk" title="Open the node" onclick={() => selectNode(c.id)}>↗</button>
              </div>
            {:else}
              <p class="dim">Nobody belongs here yet — connect an NPC or enemy to this place with <i>belongs to</i>, or make one right here:</p>
            {/each}
            </div>
            <div class="newc">
              <input class="field" placeholder="New character of this place…" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && createCharacter()} />
              <select class="field" bind:value={newType}><option value="enemy">enemy</option><option value="npc">NPC</option></select>
              <button class="btn sm" disabled={!newName.trim() || !node} onclick={createCharacter}>Add</button>
            </div>
            {#if tool === 'token'}
              <p class="hint">{tokenNode && app.nodes[tokenNode] ? `Click a cell to put “${app.nodes[tokenNode].title}” there` : 'Click a cell for a plain marker'} · click a token to remove it. <button class="lnk" onclick={() => startPlacing(null)}>plain marker</button></p>
            {/if}
            <p class="dim">The sheet (stats, moves) is edited on the node itself — Inspector → character sheet. In the VTT the token and its combat entry stay tied together.</p>
          </div>
        {:else if doc}
          {#if battle}
            <div class="label">Grid</div>
            <div class="row">
              <label class="num">cols <input class="field" type="number" min="4" max="80" value={doc.grid.cols} onchange={(e) => resize(+e.currentTarget.value, doc!.grid.rows)} /></label>
              <label class="num">rows <input class="field" type="number" min="4" max="80" value={doc.grid.rows} onchange={(e) => resize(doc!.grid.cols, +e.currentTarget.value)} /></label>
            </div>
            <label class="num">feet per cell <input class="field" type="number" min="1" step="0.5" value={doc.grid.unit} onchange={(e) => { pushUndo(); doc!.grid.unit = +e.currentTarget.value || 6; touch(); }} /></label>
            <p class="dim">Walls follow the floor automatically. Cell borders: 1 cell = {doc.grid.unit} ft.</p>
            <div class="label">Tokens <span class="dim">({doc.tokens.length}, {doc.tokens.filter((t) => t.node).length} tied to a character)</span></div>
            <p class="dim">Tokens that stand for an NPC or enemy are tied to it: the map goes to the VTT together with their sheets. Player starts are only sent if the VTT asks for them.</p>
            {@render namesSection()}
          {:else}
            <div class="label">Canvas size</div>
            <div class="seg w">
              {#each [[1344, 768, 'wide'], [1024, 1024, 'square'], [768, 1344, 'tall']] as [w, h, n]}
                <button class:on={doc.size.w === w} onclick={() => setSize(w as number, h as number)}>{n}</button>
              {/each}
            </div>
            <div class="label">Background</div>
            <div class="sw">{#each palette.terrain as t}<button class:on={(doc.background ?? 'land') === t.id} style="--c:{t.color}" title={t.name} onclick={() => setBackground(t.id)}></button>{/each}</div>
            <p class="dim">Draw areas, rivers, roads and places in the <b>Draw</b> tab; the image model turns the sketch into a painted map. Rivers and roads are painted exactly along your lines.</p>
            {@render namesSection()}
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
  .kg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .kb { display: flex; align-items: center; gap: 6px; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 7px; padding: 3px 6px; font-size: 12px; color: var(--text-dim); text-align: left; min-width: 0; }
  .kb i { width: 14px; height: 14px; border-radius: 4px; flex: none; border: 1px solid #0006; }
  .kb span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .kb b { color: #f5c542; font-size: 11px; }
  .kb:hover { color: var(--text); }
  .kb.on { border-color: var(--accent); color: var(--text); background: var(--accent-soft); }
  .kn { color: var(--accent); }
  .cfm { margin: 8px 0; padding: 8px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--bg-3); display: grid; gap: 6px; }
  :global(.ov .vh) { fill: #fff; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .pal { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); }
  .pal .field { padding: 3px 6px; font-size: 12px; }
  .sw { display: flex; flex-wrap: wrap; gap: 4px; }
  .sw button { width: 22px; height: 22px; border-radius: 6px; border: 2px solid transparent; background: var(--c); padding: 0; }
  .sw button.on { border-color: #fff; box-shadow: 0 0 0 1px #000; }
  .chk { display: flex; gap: 5px; align-items: center; font-size: 12px; color: var(--text-dim); margin-top: 6px; }
  .dim { color: var(--text-faint); font-size: 11.5px; line-height: 1.45; text-transform: none; letter-spacing: 0; }
  .dropveil { position: absolute; inset: 10px; display: grid; place-items: center; border: 2px dashed var(--accent, #7aa2ff); border-radius: 12px; background: rgba(10,14,24,.7); color: var(--text); font-size: 15px; pointer-events: none; z-index: 5; }
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
  .cams { display: grid; grid-template-columns: repeat(auto-fit, minmax(54px, 1fr)); gap: 6px; }
  .cams.two { grid-template-columns: repeat(2, 1fr); }
  .cam { display: grid; place-items: center; padding: 6px 0 4px; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 9px; color: var(--text-dim); }
  .cam:hover { border-color: var(--accent); color: var(--text); }
  .cam.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .imp { display: grid; gap: 6px; margin-top: 6px; }
  .plan { margin: 4px 0; font-size: 12px; }
  .plan summary { cursor: pointer; color: var(--text-dim); }
  .plan ul, .orph { margin: 4px 0 4px 16px; padding: 0; }
  .vars { margin-top: 6px; display: grid; gap: 4px; }
  .vstrip { display: flex; flex-wrap: wrap; gap: 6px; }
  .vth { position: relative; padding: 0; border: 2px solid var(--line-2); border-radius: 8px; overflow: hidden; background: var(--bg); line-height: 0; }
  .vth:hover:not(:disabled) { border-color: var(--accent); }
  .vth.on { border-color: var(--ok, #7fe0a0); }
  .vth:disabled { opacity: 1; cursor: default; }
  .vth i { position: absolute; left: 3px; top: 3px; font-style: normal; font-size: 10px; line-height: 1; padding: 2px 5px; border-radius: 99px; background: rgba(10, 12, 17, 0.8); color: var(--text); }
  .vth.on i { background: var(--ok, #7fe0a0); color: #0a0c11; }
  .vimg { display: block; background-repeat: no-repeat; }
  .impview { width: 100%; height: auto; display: block; border: 1px solid var(--line-2); border-radius: 8px; background: #07080c; }
  label.btn { cursor: pointer; }
  label.btn.off { opacity: .6; pointer-events: none; }
  .tools .seg button { padding: 3px 5px; font-size: 11px; }
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
  :global(.ov .grp.hot) { fill: rgba(255, 220, 90, 0.28); stroke-width: 3; stroke-dasharray: none; }
  .pp { margin: 8px 0; border: 1px solid var(--line-2); border-radius: 8px; padding: 6px 8px; background: var(--bg-3); }
  .pp summary { cursor: pointer; font-size: 12.5px; font-weight: 600; }
  .gp { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); }
  .gp.hot { border-top-color: #ffd84a; }
  .gh { font-size: 12px; text-transform: capitalize; display: flex; gap: 6px; align-items: baseline; }
  .gh b { color: var(--accent); }
  .tag { margin-left: auto; text-transform: none; font-size: 10.5px; color: var(--text-faint); border: 1px solid var(--line-2); border-radius: 99px; padding: 0 6px; }
  .tag.ai { color: #7fb0e0; }
  .gb { display: flex; gap: 12px; margin-top: 3px; font-size: 11.5px; }
  :global(.ov .grpid) { fill: #fff; stroke: #000; stroke-width: 3; paint-order: stroke; font: 700 13px sans-serif; pointer-events: none; }
  .th { all: unset; cursor: pointer; border: 2px solid var(--line-2); border-radius: 8px; overflow: hidden; aspect-ratio: 3 / 2; }
  .th.on { border-color: var(--accent); }
  .th img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cc { display: grid; grid-template-columns: 38px 1fr auto auto; gap: 8px; align-items: center; padding: 6px 7px; margin: 4px 0; border: 1px solid var(--line-2); border-left: 3px solid var(--tc); border-radius: 8px; background: var(--bg-3); }
  .cc.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .cc img { width: 38px; height: 38px; border-radius: 6px; object-fit: cover; }
  .cc .ic { width: 38px; height: 38px; display: grid; place-items: center; font-size: 18px; color: var(--tc); background: var(--bg); border-radius: 6px; }
  .cc .ct { display: grid; min-width: 0; line-height: 1.25; }
  .cc .ct b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
  .newc { display: grid; grid-template-columns: 1fr 78px auto; gap: 6px; margin: 8px 0; }
  .tie { display: grid; line-height: 1.3; margin-bottom: 4px; }
  .lnk { background: none; border: 0; color: var(--accent); padding: 0 2px; text-decoration: underline; font-size: 11.5px; }
  .hint { color: var(--accent); font-size: 11.5px; line-height: 1.4; }
</style>
