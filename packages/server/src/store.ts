import { randomBytes } from 'node:crypto';
import type {
  Actor, Batch, CampaignState, ChangeEvent, FieldDiff, Frame, Proposal, ImageJob, ImageKind, MapDoc, Placement, StoryEdge, StoryNode, StyleConfig,
} from '@pnp/shared';
import { slugify } from '@pnp/shared';
import path from 'node:path';
import { Persistence } from './persistence.js';
import { Backups } from './backup.js';
import { Imports } from './imports.js';
import { FileBooks } from './rulebook.js';
import { Maps } from './maps.js';
import { VttHub } from './vtt.js';
import { syncParty } from './party.js';

// ---------------------------------------------------------------------------
// Primitive ops. Every mutation is expressed as a list of these, each carrying
// the previous value, so a batch can be undone/redone and turned into events.
// ---------------------------------------------------------------------------

type Op =
  | { k: 'node'; id: string; prev: StoryNode | null; next: StoryNode | null }
  | { k: 'placement'; id: string; prev: Placement | null; next: Placement | null }
  | { k: 'edge'; id: string; prev: StoryEdge | null; next: StoryEdge | null }
  | { k: 'canvas'; id: string; prev: { id: string; name: string } | null; next: { id: string; name: string } | null }
  | { k: 'frame'; id: string; prev: Frame | null; next: Frame | null };

interface UndoEntry {
  batchId: string;
  label: string;
  actor: Actor;
  ops: Op[];
  /** review mode: the AI turn this step belongs to */
  proposal?: string;
}

export type BatchListener = (batch: Batch) => void;

/** Implemented by ImageService (kept as an interface to avoid a circular import). */
export interface ImageApi {
  jobs: ImageJob[];
  enqueue(req: { nodeId: string; prompt: string; kind?: ImageKind; variants?: number; seed?: number; negative?: string; actor: Actor }): ImageJob[];
  enqueueCustom(c: import('./images.js').CustomJob): ImageJob[];
  cancel(jobId?: string): void;
  fullPrompt(prompt: string): string;
  style(): StyleConfig;
  comfy: import('./comfy.js').Comfy;
  /** How battle maps are painted (the user's setting for this computer). */
  mapMode(): import('@pnp/shared').MapPaintMode;
  /** Runs the AI once, headless (used to write painting prompts). */
  ai: import('./style.js').Runner;
  estimateSeconds(megapixels: number): { seconds: number; measured: boolean };
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class Tx {
  readonly ops: Op[] = [];
  label = '';
  constructor(readonly store: Store, readonly actor: Actor) {}

  get state() {
    return this.store.state;
  }

  node(id: string): StoryNode | undefined {
    return this.store.state.nodes[id];
  }

  requireNode(id: string): StoryNode {
    const n = this.node(id);
    if (!n) throw new Error(`Node "${id}" not found`);
    return n;
  }

  /** Create or replace a node. */
  putNode(next: StoryNode) {
    const prev = this.store.state.nodes[next.id] ?? null;
    this.ops.push({ k: 'node', id: next.id, prev: clone(prev), next: clone(next) });
    this.store.state.nodes[next.id] = clone(next);
  }

  setPlacement(id: string, next: Placement | null) {
    const prev = this.store.state.graph.placements[id] ?? null;
    if (same(prev, next)) return;
    this.ops.push({ k: 'placement', id, prev: clone(prev), next: clone(next) });
    if (next) this.store.state.graph.placements[id] = clone(next);
    else delete this.store.state.graph.placements[id];
  }

  putEdge(next: StoryEdge) {
    const prev = this.store.state.graph.edges.find((e) => e.id === next.id) ?? null;
    this.ops.push({ k: 'edge', id: next.id, prev: clone(prev), next: clone(next) });
    const i = this.store.state.graph.edges.findIndex((e) => e.id === next.id);
    if (i >= 0) this.store.state.graph.edges[i] = clone(next);
    else this.store.state.graph.edges.push(clone(next));
  }

  removeEdge(id: string) {
    const i = this.store.state.graph.edges.findIndex((e) => e.id === id);
    if (i < 0) return;
    const prev = this.store.state.graph.edges[i];
    this.ops.push({ k: 'edge', id, prev: clone(prev), next: null });
    this.store.state.graph.edges.splice(i, 1);
  }

  putCanvas(next: { id: string; name: string }) {
    const prev = this.store.state.graph.canvases.find((c) => c.id === next.id) ?? null;
    this.ops.push({ k: 'canvas', id: next.id, prev: clone(prev), next: clone(next) });
    const i = this.store.state.graph.canvases.findIndex((c) => c.id === next.id);
    if (i >= 0) this.store.state.graph.canvases[i] = clone(next);
    else this.store.state.graph.canvases.push(clone(next));
  }

  removeCanvas(id: string) {
    const i = this.store.state.graph.canvases.findIndex((c) => c.id === id);
    if (i < 0) return;
    this.ops.push({ k: 'canvas', id, prev: clone(this.store.state.graph.canvases[i]), next: null });
    this.store.state.graph.canvases.splice(i, 1);
  }

  putFrame(next: Frame) {
    const prev = this.store.state.graph.frames.find((f) => f.id === next.id) ?? null;
    if (same(prev, next)) return;
    this.ops.push({ k: 'frame', id: next.id, prev: clone(prev), next: clone(next) });
    const i = this.store.state.graph.frames.findIndex((f) => f.id === next.id);
    if (i >= 0) this.store.state.graph.frames[i] = clone(next);
    else this.store.state.graph.frames.push(clone(next));
  }

  removeFrame(id: string) {
    const i = this.store.state.graph.frames.findIndex((f) => f.id === id);
    if (i < 0) return;
    this.ops.push({ k: 'frame', id, prev: clone(this.store.state.graph.frames[i]), next: null });
    this.store.state.graph.frames.splice(i, 1);
  }

  /** A readable, unique node id derived from the title. */
  newNodeId(title: string, wanted?: string): string {
    const base = slugify(wanted || title);
    if (wanted && !this.node(base)) return base;
    for (let i = 0; i < 20; i++) {
      const id = `${base}-${randomBytes(2).toString('hex')}`;
      if (!this.node(id)) return id;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }
}

export class Store {
  state: CampaignState;
  history: Batch[] = [];
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private listeners = new Set<BatchListener>();
  private seq = 0;
  /** Set by the server once ComfyUI is wired up. */
  images: ImageApi | null = null;
  readonly maps: Maps;
  readonly vtt: VttHub;
  private mapListeners = new Set<(map: MapDoc, actor: Actor) => void>();
  readonly rulebooks: FileBooks;
  /** Stable worldbuilding documents (lore, geography, history) — Library, not canvas. */
  readonly world: FileBooks;
  /** Notes the GM imported, waiting to be turned into nodes. */
  readonly imports: Imports;
  /** Snapshots, restore, mirror folder and git for this campaign. */
  readonly backups: Backups;

  constructor(readonly persistence: Persistence) {
    this.state = persistence.load();
    this.rulebooks = new FileBooks(path.join(persistence.dir, 'rulebooks'));
    this.maps = new Maps(path.join(persistence.dir, 'maps'));
    this.vtt = new VttHub(path.join(persistence.dir, 'vtts'), () => this.state.meta.name);
    this.vtt.onParty = (profile, chars) => {
      try {
        syncParty(this, profile, chars);
      } catch (e) {
        console.error('[party] sync failed', e);
      }
    };
    this.world = new FileBooks(path.join(persistence.dir, 'worldbooks'));
    this.imports = new Imports(path.join(persistence.dir, 'imports'));
    this.backups = new Backups(persistence.dir, () => this.state.meta.backup);
  }

  get imagesDir() {
    return path.join(this.persistence.dir, 'images');
  }
  get exportsDir() {
    return path.join(this.persistence.dir, 'exports');
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  onMap(fn: (map: MapDoc, actor: Actor) => void): () => void {
    this.mapListeners.add(fn);
    return () => this.mapListeners.delete(fn);
  }
  private viewListeners = new Set<(v: { canvas: string; nodeId?: string; actor: Actor }) => void>();
  /** The AI asked the GM's view to show a canvas (not part of the campaign, never undoable). */
  onView(fn: (v: { canvas: string; nodeId?: string; actor: Actor }) => void) {
    this.viewListeners.add(fn);
    return () => this.viewListeners.delete(fn);
  }
  emitView(v: { canvas: string; nodeId?: string; actor: Actor }) {
    for (const l of this.viewListeners) l(v);
  }
  private metaListeners = new Set<() => void>();
  onMeta(fn: () => void) {
    this.metaListeners.add(fn);
  }
  /** Campaign settings (style, language, comfy) changed outside the settings screen. */
  emitMeta() {
    for (const l of this.metaListeners) l();
  }
  emitMap(map: MapDoc, actor: Actor) {
    for (const l of this.mapListeners) l(map, actor);
  }

  subscribe(fn: BatchListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Run a mutation as one atomic, undoable batch. No ops -> no batch. */
  transact<T>(actor: Actor, label: string, fn: (tx: Tx) => T): T {
    const tx = new Tx(this, actor);
    let result: T;
    try {
      result = fn(tx);
    } catch (err) {
      // roll back everything applied so far
      this.applyOps(tx.ops, 'reverse', false);
      throw err;
    }
    // nothing changed (e.g. editing a field to the value it already has): no batch, no undo step
    if (tx.ops.length === 0 || tx.ops.every((o) => same(o.prev, o.next))) {
      this.applyOps(tx.ops, 'reverse', false);
      return result;
    }
    const batch = this.commit(tx.ops, actor, tx.label || label);
    let proposal: string | undefined;
    if (this.state.meta.aiMode === 'review' && (actor === 'claude' || actor === 'agy')) {
      // a chat run is one proposal; an outside client (Claude Code over MCP) is grouped by the minute
      proposal = this.turn?.id ?? `ext-${actor}-${Math.floor(Date.now() / 60_000)}`;
      batch.proposal = proposal;
      if (!this.proposalInfo.has(proposal)) this.proposalInfo.set(proposal, { title: this.turn?.title ?? `${actor} (outside chat)`, actor, at: batch.at });
    }
    this.undoStack.push({ batchId: batch.id, label: batch.label, actor, ops: tx.ops, proposal });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.emit(batch);
    return result;
  }

  // ---- review mode: AI changes are applied, but wait for the GM's Accept / Reject ----
  private turn: { id: string; title: string } | null = null;
  private proposalInfo = new Map<string, { title: string; actor: Actor; at: string }>();
  private accepted = new Set<string>();

  /** The AI starts working on one chat message: everything it changes until endTurn() is one proposal. */
  beginTurn(title: string) {
    this.turn = { id: `turn-${randomBytes(4).toString('hex')}`, title: title.replace(/\s+/g, ' ').trim().slice(0, 90) };
  }
  endTurn() {
    this.turn = null;
  }

  /** Pending proposals, oldest first (only steps that are still applied count). */
  proposals(): Proposal[] {
    const out = new Map<string, Proposal>();
    for (const e of this.undoStack) {
      if (!e.proposal || this.accepted.has(e.proposal)) continue;
      const info = this.proposalInfo.get(e.proposal) ?? { title: 'AI changes', actor: e.actor, at: '' };
      const p = out.get(e.proposal) ?? { id: e.proposal, actor: info.actor, at: info.at, title: info.title, steps: [], nodes: [], edges: [], newNodes: [], linked: 0 };
      p.steps.push(e.label);
      for (const op of e.ops) {
        if (op.k === 'node') {
          if (!p.nodes.includes(op.id)) p.nodes.push(op.id);
          if (!op.prev && op.next && !p.newNodes.includes(op.id)) p.newNodes.push(op.id);
        } else if (op.k === 'placement') {
          if (!p.nodes.includes(op.id)) p.nodes.push(op.id);
        } else if (op.k === 'edge') {
          if (!p.edges.includes(op.id)) p.edges.push(op.id);
          if (!op.prev && op.next) p.linked++;
          const ed = (op.next ?? op.prev) as StoryEdge | null;
          for (const n of ed ? [ed.from, ed.to] : []) if (!p.nodes.includes(n)) p.nodes.push(n);
        }
      }
      out.set(e.proposal, p);
    }
    return [...out.values()];
  }

  /** Keep the AI's changes (all pending proposals when no id is given). */
  acceptProposal(id?: string): number {
    const list = this.proposals().filter((p) => !id || p.id === id);
    for (const p of list) this.accepted.add(p.id);
    return list.length;
  }

  /** Take the AI's changes back. Refuses when you changed the same things afterwards (undo those first or accept). */
  rejectProposal(id?: string, actor: Actor = 'user'): number {
    const ids = this.proposals().filter((p) => !id || p.id === id).map((p) => p.id);
    let n = 0;
    for (const pid of ids.reverse()) {
      const mine = this.undoStack.filter((e) => e.proposal === pid);
      if (!mine.length) continue;
      const keys = new Set(mine.flatMap((e) => e.ops.map((o) => `${o.k}:${o.id}`)));
      const first = this.undoStack.indexOf(mine[0]);
      const clash = this.undoStack.slice(first).find((e) => e.proposal !== pid && e.ops.some((o) => keys.has(`${o.k}:${o.id}`)));
      if (clash) throw new Error(`You changed some of the same things afterwards (“${clash.label}”). Undo that first, or accept the AI's change.`);
      for (const e of [...mine].reverse()) {
        this.undoStack.splice(this.undoStack.indexOf(e), 1);
        this.applyOps(e.ops, 'reverse', false);
        const batch = this.commit(e.ops, actor, `Rejected: ${e.label}`, e.batchId, 'reverse');
        this.emit(batch);
      }
      n++;
    }
    return n;
  }

  undo(actor: Actor = 'user'): Batch | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.applyOps(entry.ops, 'reverse', false);
    const batch = this.commit(entry.ops, actor, `Undo: ${entry.label}`, entry.batchId, 'reverse');
    this.redoStack.push(entry);
    this.emit(batch);
    return batch;
  }

  redo(actor: Actor = 'user'): Batch | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.applyOps(entry.ops, 'forward', false);
    const batch = this.commit(entry.ops, actor, `Redo: ${entry.label}`, entry.batchId, 'forward');
    this.undoStack.push(entry);
    this.emit(batch);
    return batch;
  }

  /** Forget history (used after seeding demo content). */
  resetHistory() {
    this.history.length = 0;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Replace everything from disk (external change that can't be diffed). */
  replaceState(state: CampaignState) {
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
  }

  private emit(batch: Batch) {
    for (const l of this.listeners) l(batch);
  }

  private applyOps(ops: Op[], dir: 'forward' | 'reverse', _persist: boolean) {
    const list = dir === 'forward' ? ops : [...ops].reverse();
    for (const op of list) {
      const value = dir === 'forward' ? op.next : op.prev;
      switch (op.k) {
        case 'node':
          if (value) this.state.nodes[op.id] = clone(value as StoryNode);
          else delete this.state.nodes[op.id];
          break;
        case 'placement':
          if (value) this.state.graph.placements[op.id] = clone(value as Placement);
          else delete this.state.graph.placements[op.id];
          break;
        case 'edge': {
          const i = this.state.graph.edges.findIndex((e) => e.id === op.id);
          if (value) {
            if (i >= 0) this.state.graph.edges[i] = clone(value as StoryEdge);
            else this.state.graph.edges.push(clone(value as StoryEdge));
          } else if (i >= 0) this.state.graph.edges.splice(i, 1);
          break;
        }
        case 'frame': {
          const i = this.state.graph.frames.findIndex((f) => f.id === op.id);
          if (value) {
            if (i >= 0) this.state.graph.frames[i] = clone(value as Frame);
            else this.state.graph.frames.push(clone(value as Frame));
          } else if (i >= 0) this.state.graph.frames.splice(i, 1);
          break;
        }
        case 'canvas': {
          const i = this.state.graph.canvases.findIndex((c) => c.id === op.id);
          if (value) {
            const v = clone(value as { id: string; name: string });
            if (i >= 0) this.state.graph.canvases[i] = v;
            else this.state.graph.canvases.push(v);
          } else if (i >= 0) this.state.graph.canvases.splice(i, 1);
          break;
        }
      }
    }
  }

  private commit(ops: Op[], actor: Actor, label: string, undoOf?: string, dir: 'forward' | 'reverse' = 'forward'): Batch {
    const events = deriveEvents(ops, dir, this.state);
    // persist
    const nodeIds = new Set<string>();
    let graphDirty = false;
    for (const op of ops) {
      if (op.k === 'node') nodeIds.add(op.id);
      else graphDirty = true;
    }
    for (const id of nodeIds) {
      const n = this.state.nodes[id];
      if (n) this.persistence.writeNode(n);
      else this.persistence.removeNode(id);
    }
    if (graphDirty) this.persistence.writeGraph(this.state.graph);

    const batch: Batch = {
      id: randomBytes(5).toString('hex'),
      seq: ++this.seq,
      at: new Date().toISOString(),
      actor,
      label,
      undoOf,
      events,
    };
    this.history.push(batch);
    if (this.history.length > 500) this.history.shift();
    return batch;
  }
}

// ---------------------------------------------------------------------------
// Event derivation: collapse ops per entity (first prev -> last next), then
// turn the net change into semantic events the UI can animate.
// ---------------------------------------------------------------------------

function deriveEvents(ops: Op[], dir: 'forward' | 'reverse', state: CampaignState): ChangeEvent[] {
  type Net<T> = { prev: T | null; next: T | null };
  const nodes = new Map<string, Net<StoryNode>>();
  const places = new Map<string, Net<Placement>>();
  const edges = new Map<string, Net<StoryEdge>>();

  const ordered = dir === 'forward' ? ops : [...ops].reverse();
  const pick = (op: Op) => (dir === 'forward' ? { prev: op.prev, next: op.next } : { prev: op.next, next: op.prev });
  const fold = <T>(m: Map<string, Net<T>>, id: string, p: T | null, n: T | null) => {
    const cur = m.get(id);
    if (cur) cur.next = n;
    else m.set(id, { prev: p, next: n });
  };
  for (const op of ordered) {
    const { prev, next } = pick(op);
    if (op.k === 'node') fold(nodes, op.id, prev as StoryNode | null, next as StoryNode | null);
    else if (op.k === 'placement') fold(places, op.id, prev as Placement | null, next as Placement | null);
    else if (op.k === 'edge') fold(edges, op.id, prev as StoryEdge | null, next as StoryEdge | null);
  }

  const events: ChangeEvent[] = [];
  const consumedPlacement = new Set<string>();

  for (const [id, { prev, next }] of nodes) {
    if (!prev && next) {
      const placement = places.get(id)?.next ?? null;
      consumedPlacement.add(id);
      events.push({ type: 'node.created', node: next, placement });
    } else if (prev && !next) {
      events.push({ type: 'node.trashed', id });
      consumedPlacement.add(id);
    } else if (prev && next) {
      if (!prev.trashed && next.trashed) {
        events.push({ type: 'node.trashed', id });
        consumedPlacement.add(id);
      } else if (prev.trashed && !next.trashed) {
        events.push({ type: 'node.restored', id, placement: places.get(id)?.next ?? null });
        consumedPlacement.add(id);
      } else {
        const diffs = diffNode(prev, next);
        if (diffs.length) events.push({ type: 'node.updated', id, diffs });
      }
    }
  }

  for (const [id, { prev, next }] of places) {
    if (consumedPlacement.has(id)) continue;
    if (!prev && next) events.push({ type: 'node.placed', id, from: 'pool', placement: next });
    else if (prev && !next) events.push({ type: 'node.pooled', id, from: prev });
    else if (prev && next && !same(prev, next)) events.push({ type: 'node.moved', id, from: prev, to: next });
  }

  for (const [, { prev, next }] of edges) {
    if (!prev && next) events.push({ type: 'edge.created', edge: next });
    else if (prev && !next) events.push({ type: 'edge.deleted', edge: prev });
    else if (prev && next && !same(prev, next)) {
      if (prev.from !== next.from || prev.to !== next.to) events.push({ type: 'edge.rewired', edge: next, before: prev });
      else events.push({ type: 'edge.updated', edge: next, before: prev });
    }
  }
  if (ops.some((o) => o.k === 'canvas' || o.k === 'frame')) events.push({ type: 'graph.meta', canvases: clone(state.graph.canvases), frames: clone(state.graph.frames) });
  return events;
}

const DIFF_FIELDS: (keyof StoryNode)[] = [
  'type', 'title', 'summary', 'body', 'readAloud', 'tags', 'status', 'fields', 'images', 'poolHint',
];

function diffNode(a: StoryNode, b: StoryNode): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const f of DIFF_FIELDS) {
    if (!same(a[f], b[f])) out.push({ field: f, from: a[f], to: b[f] });
  }
  return out;
}

export { diffNode };
