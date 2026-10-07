import { tick } from 'svelte';
import type {
  Actor, Backend, Batch, CampaignState, ChatMsg, ChatStatus, ImageJob, MapDoc, VttStatus, ChangeEvent, CommandResult, EdgeKind, GraphFile, Placement, Proposal, ServerMsg, StoryEdge, StoryNode,
} from '@pnp/shared';

// ---------------------------------------------------------------------------
// Client-side campaign state + the animation director.
// Server pushes Batches of ChangeEvents; we apply them event by event and, for
// AI-made changes, pace them out so you can watch what changed.
// ---------------------------------------------------------------------------

export const NODE_W = 280;
export const NODE_H = 150;

export type NodeFx = { spawn?: boolean; flash?: boolean; glide?: boolean; hidden?: boolean; dissolve?: boolean };
export type EdgeFxMode = 'draw' | 'rewire' | 'flash' | 'fade';
export interface Ghost { node: StoryNode; placement: Placement; until: number }
export interface EdgeGhost { edge: StoryEdge; until: number }
export interface Flyer { id: number; from: DOMRect; to: DOMRect; node: StoryNode }
export interface RecentDiff { from: unknown; to: unknown; until: number }

export interface FlowApi {
  flowToScreen(p: { x: number; y: number }): { x: number; y: number };
  screenToFlow(p: { x: number; y: number }): { x: number; y: number };
  centerOn(p: { x: number; y: number }, duration?: number): Promise<unknown>;
  fit?(): Promise<unknown>;
  zoom(): number;
  getViewport(): { x: number; y: number; zoom: number };
  setViewport(v: { x: number; y: number; zoom: number }, duration?: number): Promise<unknown>;
  /** Zoom and move the camera so that this box (flow coordinates) fills the view. */
  fitBox(box: { x: number; y: number; width: number; height: number }, duration?: number): Promise<unknown>;
}

const emptyGraph = (): GraphFile => ({ version: 1, canvases: [{ id: 'main', name: 'Main story' }], placements: {}, edges: [], frames: [] });

function ls(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
export function remember(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch { /* private mode */ }
}

const LAYOUT_DEFAULT = { left: 300, right: 380, bottom: 150, input: 56 };
const LAYOUT_LIMITS = { left: [200, 560], right: [280, 720], bottom: [80, 460], input: [48, 420] } as const;
function loadLayout() {
  const out = { ...LAYOUT_DEFAULT };
  try {
    const saved = JSON.parse(ls('pnp.layout') ?? '{}') as Record<string, unknown>;
    for (const k of Object.keys(out) as (keyof typeof out)[]) {
      const v = saved[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(LAYOUT_LIMITS[k][0], Math.min(LAYOUT_LIMITS[k][1], v));
    }
  } catch { /* defaults */ }
  return out;
}

/** Resize a panel (px), clamped to sensible limits, and remember it. */
export function setPanelSize(which: 'left' | 'right' | 'bottom' | 'input', px: number) {
  const [lo, hi] = LAYOUT_LIMITS[which];
  app.layout[which] = Math.round(Math.max(lo, Math.min(hi, px)));
  remember('pnp.layout', JSON.stringify(app.layout));
}
export const resetPanelSize = (which: 'left' | 'right' | 'bottom' | 'input') => setPanelSize(which, LAYOUT_DEFAULT[which]);

export const app = $state({
  /** Panel sizes in px (drag the splitters). */
  layout: loadLayout(),
  connected: false,
  loaded: false,
  meta: { name: '', language: 'de', createdAt: '' } as CampaignState['meta'],
  nodes: {} as Record<string, StoryNode>,
  graph: emptyGraph(),
  history: [] as Batch[],
  canUndo: false,
  canRedo: false,

  canvasId: 'main',
  selectedId: null as string | null,
  selectedEdge: null as string | null,
  /** Several nodes selected at once on the canvas (empty unless 2+). */
  multi: [] as string[],
  /** Which part of the party the table controls refer to (parties can split up). */
  playGroup: 'party',
  tab: 'inspector' as 'inspector' | 'chat' | 'library' | 'story',
  edgeKind: 'leads-to' as EdgeKind,
  followAi: true,
  toast: '' as string,
  toastKind: 'error' as 'error' | 'ok',
  jobs: [] as ImageJob[],
  vtt: null as VttStatus | null,
  /** Map editor modal (by map id) and the latest map change pushed by the server (AI edits, other tabs). */
  mapEditor: null as null | { mapId: string },
  mapEvent: null as null | { map: MapDoc; actor: Actor; at: number },
  settingsOpen: false,
  /** the music & sounds panel (play on the connected VTT) */
  soundsOpen: false,
  /** the connected VTT's tracks (null = not loaded) — shared by the sounds panel and the nodes' Sound & music section */
  tracks: null as null | { id: string; title: string; category?: string; uploaded?: boolean }[],
  tracksFor: '',
  /** AI changes waiting for Accept / Reject (review mode). */
  proposals: [] as Proposal[],
  /** A frame that was just created and wants its title typed in. */
  editingFrame: null as string | null,
  /** Right-click menu on a frame (screen position). */
  frameMenu: null as null | { frameId: string; x: number; y: number },
  /** Ctrl+K search palette. */
  paletteOpen: false,
  /** GM binder (PDF) dialog. */
  binderOpen: false,
  /** Backups & sync dialog. */
  backupsOpen: false,
  /** Level of detail of the canvas: far zoomed out, cards show only their big title (semantic zoom). */
  lod: 'full' as 'full' | 'compact',
  /** Bumped when another campaign is opened: the canvas re-fits its view. */
  fitNonce: 0,
  /** Image-queue dropdown in the top bar. */
  queueOpen: false,
  /** Right-click menu on a node (screen position). */
  nodeMenu: null as null | { nodeId: string; x: number; y: number },
  edgeMenu: null as null | { edgeId: string; x: number; y: number },
  /** a node the GM enlarged with a double-click (shows notes, read-aloud and a bigger picture); `view` = the camera to go back to */
  enlarged: null as null | { id: string; view: { x: number; y: number; zoom: number } | null },
  /** the "connect to a node on another canvas" dialog */
  crossLink: null as null | { fromId: string; dir: 'out' | 'in'; canvas?: string },
  /** Right-click on empty canvas: screen position for the menu, flow position for the new node. */
  paneMenu: null as null | { x: number; y: number; fx: number; fy: number },
  lightbox: null as null | { nodeId: string; file: string },
  /** World-book editor modal: name = existing book, null = new book. */
  editor: null as null | { name: string | null },

  chat: [] as ChatMsg[],
  /** Unsent chat input per thread ('' = main chat, else node id) — the Chat component unmounts on tab switches. */
  drafts: {} as Record<string, { text: string; pins: string[] }>,
  chatStatus: { busy: false } as ChatStatus,
  backend: (ls('pnp.backend') === 'agy' ? 'agy' : 'claude') as Backend,
  models: { claude: ls('pnp.model.claude') ?? '', agy: ls('pnp.model.agy') ?? '' } as Record<Backend, string>,

  // transient animation state
  fx: {} as Record<string, NodeFx>,
  edgeFx: {} as Record<string, EdgeFxMode>,
  ghosts: {} as Record<string, Ghost>,
  edgeGhosts: {} as Record<string, EdgeGhost>,
  flyers: [] as Flyer[],
  presence: null as { actor: Actor; nodeId: string | null; edgeId: string | null; until: number } | null,
  /** previous label of a connection the AI just edited (shown struck-through for a few seconds) */
  edgeDiffs: {} as Record<string, { from: string; until: number }>,
  diffs: {} as Record<string, Record<string, RecentDiff>>,
});

let flowApi: FlowApi | null = null;

/** Camera move for the animation director. xyflow resolves its promise only when the transition *ends*: if the
 *  user pans/zooms meanwhile the transition is interrupted and the promise never settles, which would stall the
 *  whole batch queue (nothing new would be drawn until a reload) — so never wait longer than the move itself. */
const camera = (p: { x: number; y: number }, duration = 500) =>
  Promise.race([Promise.resolve(flowApi?.centerOn(p, duration)).catch(() => {}), new Promise<void>((r) => setTimeout(r, duration + 300))]);
/** Follow the AI to a placement — onto its canvas first, if it works on another one than the GM is looking at. */
const cameraTo = async (pl: { canvas: string; x: number; y: number }, duration = 450) => {
  if (pl.canvas !== app.canvasId) {
    app.canvasId = pl.canvas;
    await tick();
  }
  await camera({ x: pl.x + NODE_W / 2, y: pl.y + NODE_H / 2 }, duration);
};
export const registerFlowApi = (a: FlowApi | null) => {
  flowApi = a;
};

/** Flow coordinates (top-left of a new ~280×80 card) that put it in the middle of what the GM currently sees. */
export function viewCenter(): { x: number; y: number } {
  const r = document.querySelector('.canvas')?.getBoundingClientRect();
  const c = r ? screenToFlow({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
  return { x: Math.round(c.x - 140), y: Math.round(c.y - 40) };
}

/** Table actions on a whole selection (one undo step). */
export const setStatusMany = (ids: string[], status: string) =>
  cmd('batch', { ops: ids.map((nodeId) => ({ command: 'set_status', args: { nodeId, status } })), label: `Set ${ids.length} nodes ${status}` });
export const hereMany = (ids: string[], group?: string) => cmd('set_here', { nodeIds: ids, ...(group ? { group } : {}) });

let chatMetaCache: Promise<{ models: { claude: { id: string; label: string }[]; agy: { id: string; label: string }[] }; agy: { installed: boolean; registered: boolean; permitted: boolean } }> | null = null;
/** Models and agy status, fetched once (not on every node selection); pass refresh after changing agy's setup. */
export function chatMeta(refresh = false) {
  if (!chatMetaCache || refresh) {
    chatMetaCache = Promise.all([fetch('/api/models').then((r) => r.json()), fetch('/api/agy/status').then((r) => r.json())]).then(([models, agy]) => ({ models, agy }));
    chatMetaCache.catch(() => (chatMetaCache = null));
  }
  return chatMetaCache;
}

/** Called while the canvas pans/zooms; flips the level of detail with a little hysteresis so it never flickers. */
export function noteZoom(z: number) {
  if (app.lod === 'full' && z < 0.42) app.lod = 'compact';
  else if (app.lod === 'compact' && z > 0.5) app.lod = 'full';
}

/** Open the dialog that connects a node to one on another canvas. */
export function openCrossLink(fromId: string, dir: 'out' | 'in' = 'out', canvas?: string) {
  closeMenus();
  app.crossLink = { fromId, dir, canvas };
}

/** Double-click on a node: enlarge it in place and zoom the camera onto it; again (or Esc, ×, a click on the canvas) puts everything back. */
/** Wait until an element has its final size: its pictures are loaded and the size has not changed for a few frames. */
async function settled(el: Element, maxMs = 4000) {
  const t0 = performance.now();
  let last = '';
  let steady = 0;
  while (performance.now() - t0 < maxMs) {
    const r = el.getBoundingClientRect();
    const sig = `${Math.round(r.width)}x${Math.round(r.height)}`;
    const loading = [...el.querySelectorAll('img')].some((i) => !i.complete);
    steady = !loading && sig === last ? steady + 1 : 0;
    last = sig;
    if (steady >= 4) return;
    await sleep(50);
  }
}

/** a camera move back to where the view was, still pending after a click that closed an enlarged card (see closeEnlarged) */
let restoring: { view: { x: number; y: number; zoom: number }; until: number } | null = null;

export async function toggleEnlarge(id: string) {
  if (app.enlarged?.id === id) return closeEnlarged();
  const p = app.graph.placements[id];
  if (!p || p.canvas !== app.canvasId || !flowApi) return;
  // from one enlarged card straight to the next the camera still goes back to the ORIGINAL view when it is all over
  const pending = restoring && Date.now() < restoring.until ? restoring.view : null;
  restoring = null;
  const view = app.enlarged?.view ?? pending ?? flowApi.getViewport();
  app.enlarged = { id, view };
  selectNode(id);
  await tick();
  // the card grows and then loads its pictures, which changes its size again: zoom only once it has settled
  await sleep(60);
  const wrap = document.querySelector(`.svelte-flow__node[data-id="${CSS.escape(id)}"]`);
  if (wrap) await settled(wrap);
  if (app.enlarged?.id !== id) return;
  const el = document.querySelector(`.svelte-flow__node[data-id="${CSS.escape(id)}"]`);
  if (!el || !flowApi) return;
  const r = el.getBoundingClientRect();
  const a = flowApi.screenToFlow({ x: r.left, y: r.top });
  const b = flowApi.screenToFlow({ x: r.right, y: r.bottom });
  void flowApi.fitBox({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }, 450);
}

/** restore: go back to where the camera was before (not when the canvas was switched meanwhile).
 *  fromPointer: the close was caused by a mouse press (a click on the canvas starts xyflow's pan handling, which would cancel the
 *  camera move) — so the camera goes back when the button is released, and only if you did not move the view yourself meanwhile. */
export function closeEnlarged(restore = true, fromPointer = false) {
  const e = app.enlarged;
  if (!e) return;
  app.enlarged = null;
  if (!restore || !e.view || !flowApi) return;
  const back = e.view;
  if (!fromPointer) return void flowApi.setViewport(back, 400);
  const v0 = flowApi.getViewport();
  const mine = (restoring = { view: back, until: Date.now() + 900 });
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    window.removeEventListener('pointerup', go, true);
    if (restoring !== mine) return; // another card was enlarged meanwhile and carries the original view on
    const v1 = flowApi?.getViewport();
    if (!v1 || (Math.abs(v1.x - v0.x) < 2 && Math.abs(v1.y - v0.y) < 2 && Math.abs(v1.zoom - v0.zoom) < 0.005)) void flowApi?.setViewport(back, 400);
  };
  window.addEventListener('pointerup', go, true);
  setTimeout(go, 400); // touch or a missed release: do not hang around
}

export function closeMenus() {
  app.nodeMenu = null;
  app.edgeMenu = null;
  app.paneMenu = null;
  app.frameMenu = null;
}

export const screenToFlow = (p: { x: number; y: number }) => flowApi?.screenToFlow(p) ?? p;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isAi = (a: Actor) => a === 'claude' || a === 'agy';
let flyerSeq = 0;

// ------------------------------- helpers -----------------------------------

/** Image jobs that are running or waiting, in the order they will be worked off. */
export const activeJobs = () => app.jobs.filter((j) => j.status === 'queued' || j.status === 'running');
/** 0 = being generated now, n = n jobs are ahead of it. */
export const jobAhead = (id: string) => Math.max(0, activeJobs().findIndex((j) => j.id === id));

export function say(msg: string, kind: 'error' | 'ok' = 'error') {
  app.toast = msg;
  app.toastKind = kind;
  setTimeout(() => {
    if (app.toast === msg) app.toast = '';
  }, 4000);
}

export async function cmd<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T | undefined> {
  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, args, actor: 'user' }),
    });
    const j = (await res.json()) as CommandResult;
    if (!j.ok) {
      say(j.error ?? 'Command failed');
      return undefined;
    }
    return j.result as T;
  } catch (e) {
    say(`Server unreachable: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/** Fetch the VTT's track list (once per connection; `force` asks again). */
export async function loadTracks(force = false) {
  const key = app.vtt?.connected ? (app.vtt.profile?.id ?? '') : '';
  if (!key) { app.tracks = null; app.tracksFor = ''; return; }
  if (!force && app.tracks && app.tracksFor === key) return;
  app.tracksFor = key;
  const r = await cmd<{ id: string; title: string; category?: string; uploaded?: boolean }[]>('list_vtt_tracks');
  app.tracks = Array.isArray(r) ? r : [];
}

export async function sendChat(text: string, opts: { nodeId?: string; pins?: string[] } = {}): Promise<boolean> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, backend: app.backend, model: app.models[app.backend] || undefined, ...opts }),
  });
  if (!res.ok) {
    say(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not send');
    return false;
  }
  return true;
}
export const cancelChat = () => fetch('/api/chat/cancel', { method: 'POST' });
export const clearChat = () => fetch('/api/chat/clear', { method: 'POST' }).then(() => (app.chat = []));

export const undo = () => fetch('/api/undo', { method: 'POST' });
export const redo = () => fetch('/api/redo', { method: 'POST' });

export function poolNodes(): StoryNode[] {
  return Object.values(app.nodes)
    .filter((n) => !n.trashed && !app.graph.placements[n.id])
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function selectEdge(id: string | null) {
  app.selectedEdge = id;
  if (id) {
    app.selectedId = null;
    app.tab = 'inspector';
  }
}

export function selectNode(id: string | null, tab?: 'inspector' | 'chat') {
  app.selectedId = id;
  if (id) app.selectedEdge = null;
  if (id && tab !== 'chat') app.tab = 'inspector';
}

export function focusEdge(id: string) {
  const e = app.graph.edges.find((x) => x.id === id);
  if (!e) return;
  selectEdge(id);
  const a = app.graph.placements[e.from];
  const b = app.graph.placements[e.to];
  if (a && b) {
    app.canvasId = a.canvas;
    void flowApi?.centerOn({ x: (a.x + b.x) / 2 + NODE_W / 2, y: (a.y + b.y) / 2 + NODE_H / 2 }, 500);
  }
}

export function focusNode(id: string) {
  const p = app.graph.placements[id];
  selectNode(id);
  if (p) {
    app.canvasId = p.canvas;
    void flowApi?.centerOn({ x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 }, 500);
  }
}

/** The GM clicked a portal: jump to what it leads to (the arrival node if it has one, else the canvas). */
export function gotoPortal(node: StoryNode) {
  const cid = typeof node.fields.canvas === 'string' ? node.fields.canvas : '';
  const tid = typeof node.fields.nodeId === 'string' ? node.fields.nodeId : '';
  if (tid && app.graph.placements[tid]) return focusNode(tid);
  if (app.graph.canvases.some((c) => c.id === cid)) app.canvasId = cid;
}

/** The AI asked to show a canvas (show_canvas). Respects "follow the AI". */
function showCanvasFromAi(canvas: string, nodeId: string | undefined, actor: Actor) {
  if (!app.followAi || !app.graph.canvases.some((c) => c.id === canvas)) return;
  app.canvasId = canvas;
  const p = nodeId ? app.graph.placements[nodeId] : undefined;
  if (nodeId && p) {
    focusPresence(actor, nodeId);
    void tick().then(() => camera({ x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 }, 500));
  }
}

// ------------------------------- state sync --------------------------------

/** Another campaign was opened: nothing of the old one may linger in the view. */
function resetForCampaign() {
  app.selectedId = null;
  app.selectedEdge = null;
  app.multi = [];
  app.nodeMenu = null;
  app.edgeMenu = null;
  app.crossLink = null;
  app.enlarged = null;
  app.paneMenu = null;
  app.mapEditor = null;
  app.lightbox = null;
  app.editor = null;
  app.presence = null;
  app.fx = {};
  app.ghosts = {};
  app.edgeGhosts = {};
  app.canvasId = 'main';
  app.fitNonce++;
}

function load(state: CampaignState) {
  app.meta = state.meta;
  app.nodes = state.nodes;
  app.graph = state.graph;
  if (!state.graph.canvases.some((c) => c.id === app.canvasId)) app.canvasId = state.graph.canvases[0]?.id ?? 'main';
  app.loaded = true;
}

function setFx(id: string, patch: Partial<NodeFx>, ms?: number) {
  app.fx[id] = { ...app.fx[id], ...patch };
  if (ms) {
    const keys = Object.keys(patch) as (keyof NodeFx)[];
    setTimeout(() => {
      const cur = app.fx[id];
      if (!cur) return;
      for (const k of keys) delete cur[k];
      if (!Object.keys(cur).length) delete app.fx[id];
    }, ms);
  }
}

function setEdgeFx(id: string, mode: EdgeFxMode, ms: number) {
  app.edgeFx[id] = mode;
  setTimeout(() => {
    if (app.edgeFx[id] === mode) delete app.edgeFx[id];
  }, ms);
}

const rectOf = (sel: string): DOMRect | null => document.querySelector(sel)?.getBoundingClientRect() ?? null;

async function flyer(from: DOMRect, to: DOMRect, node: StoryNode) {
  const f: Flyer = { id: ++flyerSeq, from, to, node };
  app.flyers.push(f);
  await sleep(720);
  app.flyers = app.flyers.filter((x) => x.id !== f.id);
}

function pointOf(p: Placement) {
  const z = flowApi?.zoom() ?? 1;
  const tl = flowApi?.flowToScreen(p) ?? { x: p.x, y: p.y };
  return new DOMRect(tl.x, tl.y, NODE_W * z, NODE_H * z);
}

/** Targets are node ids, or "edge:<id>" for connections. */
function focusPresence(actor: Actor, target: string | undefined) {
  if (!target || !isAi(actor)) return;
  const edgeId = target.startsWith('edge:') ? target.slice(5) : null;
  app.presence = { actor, nodeId: edgeId ? null : target, edgeId, until: Date.now() + 3200 };
  setTimeout(() => {
    if (app.presence && app.presence.until <= Date.now()) app.presence = null;
  }, 3300);
}

async function centerOnEdge(edge: StoryEdge) {
  const a = app.graph.placements[edge.from];
  const b = app.graph.placements[edge.to];
  if (!a || !b) return;
  await camera({ x: (a.x + b.x) / 2 + NODE_W / 2, y: (a.y + b.y) / 2 + NODE_H / 2 }, 450);
}

async function applyEvent(ev: ChangeEvent, actor: Actor): Promise<string | undefined> {
  const ai = isAi(actor);
  const follow = ai && app.followAi;
  switch (ev.type) {
    case 'node.created': {
      app.nodes[ev.node.id] = ev.node;
      if (ev.placement) {
        app.graph.placements[ev.node.id] = ev.placement;
        if (follow) await cameraTo(ev.placement);
      }
      setFx(ev.node.id, { spawn: true }, 1100);
      return ev.node.id;
    }
    case 'node.updated': {
      const n = app.nodes[ev.id];
      if (!n) return;
      const until = Date.now() + (ai ? 9000 : 2500);
      for (const d of ev.diffs) {
        (n as unknown as Record<string, unknown>)[d.field] = d.to;
        (app.diffs[ev.id] ??= {})[d.field] = { from: d.from, to: d.to, until };
      }
      setTimeout(() => {
        const m = app.diffs[ev.id];
        if (!m) return;
        for (const k of Object.keys(m)) if (m[k].until <= Date.now()) delete m[k];
      }, (ai ? 9000 : 2500) + 100);
      setFx(ev.id, { flash: true }, 1300);
      return ev.id;
    }
    case 'node.trashed': {
      const n = app.nodes[ev.id];
      const p = app.graph.placements[ev.id];
      if (n && p) {
        app.ghosts[ev.id] = { node: { ...n }, placement: { ...p }, until: Date.now() + 800 };
        setTimeout(() => delete app.ghosts[ev.id], 850);
      }
      if (n) n.trashed = true;
      delete app.graph.placements[ev.id];
      if (app.selectedId === ev.id) app.selectedId = null;
      return ev.id;
    }
    case 'node.restored': {
      const n = app.nodes[ev.id];
      if (n) n.trashed = false;
      if (ev.placement) app.graph.placements[ev.id] = ev.placement;
      setFx(ev.id, { spawn: true }, 1100);
      return ev.id;
    }
    case 'node.placed': {
      const n = app.nodes[ev.id];
      const from = ai ? rectOf(`[data-pool-id="${ev.id}"]`) : null;
      if (ai && from && n) {
        setFx(ev.id, { hidden: true });
        app.graph.placements[ev.id] = ev.placement;
        try {
          await tick();
          if (follow) await cameraTo(ev.placement);
          await tick();
          await flyer(from, pointOf(ev.placement), n);
        } finally {
          // never leave the card invisible, whatever went wrong above
          setFx(ev.id, { spawn: true }, 1100);
          delete app.fx[ev.id]?.hidden;
          if (app.fx[ev.id] && !Object.keys(app.fx[ev.id]).length) delete app.fx[ev.id];
        }
      } else {
        app.graph.placements[ev.id] = ev.placement;
        setFx(ev.id, { spawn: true }, 1100);
      }
      return ev.id;
    }
    case 'node.pooled': {
      const n = app.nodes[ev.id];
      const from = ai ? rectOf(`.svelte-flow__node[data-id="${ev.id}"]`) : null;
      delete app.graph.placements[ev.id];
      if (ai && from && n) {
        setFx(`pool:${ev.id}`, { hidden: true });
        try {
          await tick();
          const to = rectOf(`[data-pool-id="${ev.id}"]`);
          if (to) await flyer(from, to, n);
        } finally {
          delete app.fx[`pool:${ev.id}`];
        }
        setFx(ev.id, { spawn: true }, 900);
      }
      return ev.id;
    }
    case 'node.moved': {
      if (ai) setFx(ev.id, { glide: true }, 1000);
      app.graph.placements[ev.id] = ev.to;
      if (follow) await cameraTo(ev.to);
      return ev.id;
    }
    case 'edge.created': {
      app.graph.edges.push(ev.edge);
      setEdgeFx(ev.edge.id, 'draw', 1300);
      if (follow) await centerOnEdge(ev.edge);
      return `edge:${ev.edge.id}`;
    }
    case 'edge.updated':
    case 'edge.rewired': {
      const i = app.graph.edges.findIndex((e) => e.id === ev.edge.id);
      if (i >= 0) app.graph.edges[i] = ev.edge;
      else app.graph.edges.push(ev.edge);
      // dragging a jump marker only changes `markers`: no flash for that
      const b = ev.before, e = ev.edge;
      const onlyMarker = ev.type === 'edge.updated' && b.from === e.from && b.to === e.to && b.kind === e.kind && b.label === e.label && !!b.noTrail === !!e.noTrail;
      if (!onlyMarker) setEdgeFx(ev.edge.id, ev.type === 'edge.rewired' ? 'rewire' : 'flash', 1300);
      if (ev.before.label !== ev.edge.label) {
        const id = ev.edge.id;
        app.edgeDiffs[id] = { from: ev.before.label, until: Date.now() + (ai ? 9000 : 2500) };
        setTimeout(() => {
          if (app.edgeDiffs[id] && app.edgeDiffs[id].until <= Date.now()) delete app.edgeDiffs[id];
        }, (ai ? 9000 : 2500) + 100);
      }
      if (follow) await centerOnEdge(ev.edge);
      return `edge:${ev.edge.id}`;
    }
    case 'edge.deleted': {
      const i = app.graph.edges.findIndex((e) => e.id === ev.edge.id);
      if (i >= 0) app.graph.edges.splice(i, 1);
      app.edgeGhosts[ev.edge.id] = { edge: ev.edge, until: Date.now() + 700 };
      setTimeout(() => delete app.edgeGhosts[ev.edge.id], 750);
      return ev.edge.from;
    }
    case 'graph.meta':
      app.graph.canvases = ev.canvases;
      app.graph.frames = ev.frames;
      if (!ev.canvases.some((c) => c.id === app.canvasId)) app.canvasId = ev.canvases[0]?.id ?? 'main';
      return;
    case 'graph.reloaded':
      return;
  }
}

/** One animation step may never hold up the rest: a camera move, a card flight or a handler that throws must not leave
 *  everything the AI did afterwards undrawn (that looks like "the nodes are invisible until I reload"). */
const EVENT_TIMEOUT_MS = 4000;
let pendingBatches = 0;
let needResync = false;

/** Safety net: re-read the whole campaign from the server (what a reload would show). */
async function resync() {
  try {
    const r = (await (await fetch('/api/state')).json()) as { state: CampaignState; canUndo: boolean; canRedo: boolean };
    load(r.state);
    app.canUndo = r.canUndo;
    app.canRedo = r.canRedo;
  } catch (e) {
    console.error('resync', e);
  }
}

async function applyBatch(batch: Batch) {
  const ai = isAi(batch.actor);
  app.history.push(batch);
  if (app.history.length > 200) app.history.shift();
  // the canvas list first (it is sent last): a new canvas' tab must exist before the view follows the AI onto it
  const events = [...batch.events].sort((x, y) => Number(y.type === 'graph.meta') - Number(x.type === 'graph.meta'));
  for (const ev of events) {
    let nodeId: string | undefined;
    try {
      const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), EVENT_TIMEOUT_MS));
      const res = await Promise.race([applyEvent(ev, batch.actor), timeout]);
      if (res === 'timeout') {
        console.warn('[animation] a step took too long and was skipped:', ev.type, ev);
        needResync = true;
      } else nodeId = res;
    } catch (e) {
      console.error('[animation] a step failed, carrying on:', ev.type, e);
      needResync = true;
    }
    focusPresence(batch.actor, nodeId);
    if (ai) await sleep(360);
  }
}

let chain: Promise<void> = Promise.resolve();
const enqueue = (batch: Batch) => {
  pendingBatches++;
  chain = chain
    .then(() => applyBatch(batch))
    .catch((e) => {
      console.error('applyBatch', e);
      needResync = true;
    })
    .then(async () => {
      pendingBatches--;
      // only when nothing else is queued: replaying later events on top of a fresh state could draw things twice
      if (needResync && pendingBatches === 0) {
        needResync = false;
        await resync();
      }
    });
};

// ------------------------------- websocket ---------------------------------

let ws: WebSocket | null = null;
let retry = 0;
let disposed = false;

export function connect() {
  // one socket only: a second connect() (hot reload, remount) must not open another listener on the same server
  if (disposed || (ws && ws.readyState <= WebSocket.OPEN)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    app.connected = true;
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    if (disposed) return;
    app.connected = false;
    setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
  };
  sock.onmessage = (m) => {
    const msg = JSON.parse(m.data) as ServerMsg;
    if (msg.t === 'hello') {
      chain = chain.then(() => {
        if (msg.switched) resetForCampaign();
        load(msg.state);
        app.history = msg.history;
        app.canUndo = msg.canUndo;
        app.canRedo = msg.canRedo;
        app.chat = msg.chat;
        app.chatStatus = msg.chatStatus;
        app.jobs = msg.jobs;
        app.vtt = msg.vtt;
        app.proposals = msg.proposals ?? [];
      });
    } else if (msg.t === 'chat') {
      const i = app.chat.findIndex((m) => m.id === msg.msg.id);
      if (i >= 0) app.chat[i] = msg.msg;
      else app.chat.push(msg.msg);
    } else if (msg.t === 'vtt') {
      app.vtt = msg.status;
    } else if (msg.t === 'view') {
      showCanvasFromAi(msg.canvas, msg.nodeId, msg.actor);
    } else if (msg.t === 'map') {
      app.mapEvent = { map: msg.map, actor: msg.actor, at: Date.now() };
    } else if (msg.t === 'image.job') {
      const i = app.jobs.findIndex((j) => j.id === msg.job.id);
      if (i >= 0) app.jobs[i] = msg.job;
      else app.jobs.push(msg.job);
    } else if (msg.t === 'proposals') {
      app.proposals = msg.list;
    } else if (msg.t === 'chat.status') {
      app.chatStatus = msg.status;
    } else if (msg.t === 'batch') {
      enqueue(msg.batch);
      chain = chain.then(() => {
        app.canUndo = msg.canUndo;
        app.canRedo = msg.canRedo;
      });
    } else if (msg.t === 'reload') {
      chain = chain.then(() => load(msg.state));
    }
  };
}

// Hot reload replaced this module without ever disposing the old copy (Vite only disposes modules that accept updates),
// so every edit left one more live socket behind — each receiving every broadcast — and the page got slower the longer
// you worked on it. This module owns the app state, so an update to it simply reloads the page.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    ws?.close();
    ws = null;
  });
  import.meta.hot.accept(() => location.reload());
}
