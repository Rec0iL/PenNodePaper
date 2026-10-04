import { z, type ZodRawShape } from 'zod';
import { DEFAULT_GROUP, dieLabel, entryLine, fragmentName, parseEntry, rollLog, rollTable, seeded, tableEntries, tableFaces, clockOf, lintStory, nextPlayedSeq, playedPath, playerWiki, wikiMarkdown, slugify, storyStatus, validateSheet, visitsOf, type Visit } from '@pnp/shared';
import type { Actor, DoorKind, EdgeKind, EdgeSide, ImageKind, NodeStatus, NodeType, PropKind, StoryEdge, StoryNode, TerrainKind } from '@pnp/shared';
import { DOOR_KINDS, EDGE_KINDS, EDGE_SIDES, IMAGE_KINDS, NODE_STATUSES, NODE_TYPES, PROP_KINDS, TERRAINS } from '@pnp/shared';
import fs from 'node:fs';
import path from 'node:path';
import { BINDER_SECTIONS, binderHtml, renderPdf } from './binder.js';
import { buildBundle, characterFromNode, handoutFromNode, kinetikSession, roleFor, sceneFromImage, sceneFromMap, sheetOf, wantsPlayerStarts } from './vtt.js';
import { CONTROL_LEGEND, REGION_LEGEND, applyOps, imageSize, renderSvg, toPng, type MapOp } from './maps.js';
import type { Store, Tx } from './store.js';

// ---------------------------------------------------------------------------
// The command layer: the single way anything (UI, MCP, chat) changes a campaign.
// Each command runs inside one transaction => one undo step, one batch of
// animatable change events.
// ---------------------------------------------------------------------------

export interface Command<S extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  shape: S;
  /** Read-only commands never create a batch. */
  readOnly?: boolean;
  /** For the GM's UI only: not offered to the AI. */
  internal?: boolean;
  /** Talks to something outside the campaign (e.g. a VTT): returns a Promise, cannot be batched. */
  async?: boolean;
  run: (tx: Tx, args: z.infer<z.ZodObject<S>>) => unknown;
}

const NODE_W = 280;
const NODE_H = 150;

const nodeTypeEnum = z.enum(NODE_TYPES as unknown as [NodeType, ...NodeType[]]);
const statusEnum = z.enum(NODE_STATUSES as unknown as [NodeStatus, ...NodeStatus[]]);
const edgeKindEnum = z.enum(EDGE_KINDS as unknown as [EdgeKind, ...EdgeKind[]]);

const now = () => new Date().toISOString();

function describe(n: StoryNode) {
  return `${n.type} “${n.title}”`;
}

/** Find a free spot on a canvas, next to `nearId` if given. */
function freeSpot(tx: Tx, canvas: string, nearId?: string): { x: number; y: number } {
  const placed = Object.entries(tx.state.graph.placements).filter(([, p]) => p.canvas === canvas);
  const near = nearId ? tx.state.graph.placements[nearId] : undefined;
  let x = near ? near.x + NODE_W + 80 : 0;
  let y = near ? near.y : 0;
  if (!near && placed.length) {
    // right of the right-most node
    x = Math.max(...placed.map(([, p]) => p.x)) + NODE_W + 80;
    y = placed.reduce((s, [, p]) => s + p.y, 0) / placed.length;
  }
  const collides = (cx: number, cy: number) =>
    placed.some(([, p]) => Math.abs(p.x - cx) < NODE_W + 20 && Math.abs(p.y - cy) < NODE_H + 20);
  for (let i = 0; i < 60; i++) {
    const dy = Math.ceil(i / 2) * (NODE_H + 30) * (i % 2 ? 1 : -1);
    if (!collides(x, y + dy)) return { x: Math.round(x), y: Math.round(y + dy) };
  }
  return { x: Math.round(x), y: Math.round(y) };
}

function checkCanvas(tx: Tx, canvas: string) {
  if (!tx.state.graph.canvases.some((c) => c.id === canvas)) throw new Error(`Canvas "${canvas}" not found`);
}

function summarize(tx: Tx, n: StoryNode, withBody = false) {
  const p = tx.state.graph.placements[n.id];
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    summary: n.summary,
    status: n.status,
    ...(n.tags.length ? { tags: n.tags } : {}),
    where: n.trashed ? 'trash' : p ? { canvas: p.canvas, x: p.x, y: p.y } : 'pool',
    ...(n.poolHint ? { poolHint: n.poolHint } : {}),
    ...(Object.keys(n.fields).length ? { fields: n.fields } : {}),
    ...(withBody ? { body: n.body, readAloud: n.readAloud, images: n.images } : {}),
  };
}

function link(tx: Tx, from: string, to: string, kind: EdgeKind, label: string) {
  if (from === to) throw new Error('Cannot link a node to itself');
  const a = tx.requireNode(from);
  const b = tx.requireNode(to);
  if (a.trashed || b.trashed) throw new Error('Cannot link a trashed node');
  const dup = tx.state.graph.edges.find((e) => e.from === from && e.to === to && e.kind === kind);
  if (dup) return dup;
  const id = `e-${from}-${to}-${Math.random().toString(36).slice(2, 6)}`;
  const edge = { id, from, to, kind, label };
  tx.putEdge(edge);
  return edge;
}

const commands: Command[] = [];
function def<S extends ZodRawShape>(c: Command<S>) {
  commands.push(c as unknown as Command);
}

// ------------------------------- reading -----------------------------------

def({
  name: 'get_graph',
  description:
    'Overview of the whole campaign: canvases, every node (canvas position or "pool"), and all edges. Start here. Pool = prepared nodes without a fixed place in the story yet.',
  readOnly: true,
  shape: {
    includeBodies: z.boolean().optional().describe('Include full body/read-aloud text for every node (large).'),
    includeTrash: z.boolean().optional(),
  },
  run(tx, a) {
    const nodes = Object.values(tx.state.nodes).filter((n) => a.includeTrash || !n.trashed);
    return {
      campaign: { name: tx.state.meta.name, language: tx.state.meta.language },
      canvases: tx.state.graph.canvases,
      nodes: nodes.map((n) => summarize(tx, n, a.includeBodies)),
      edges: tx.state.graph.edges.map(({ id, from, to, kind, label }) => ({ id, from, to, kind, ...(label ? { label } : {}) })),
      frames: tx.state.graph.frames,
    };
  },
});

def({
  name: 'get_node',
  description: 'Full details of one node including body, read-aloud text, fields and its edges.',
  readOnly: true,
  shape: { id: z.string() },
  run(tx, a) {
    const n = tx.requireNode(a.id);
    return {
      ...summarize(tx, n, true),
      edges: tx.state.graph.edges.filter((e) => e.from === n.id || e.to === n.id),
    };
  },
});

def({
  name: 'search_nodes',
  description: 'Find nodes by text (title/summary/body/tags), type, tag, status or location.',
  readOnly: true,
  shape: {
    query: z.string().optional(),
    type: nodeTypeEnum.optional(),
    tag: z.string().optional(),
    status: statusEnum.optional(),
    where: z.enum(['canvas', 'pool', 'any']).optional(),
  },
  run(tx, a) {
    const q = a.query?.toLowerCase();
    return Object.values(tx.state.nodes)
      .filter((n) => !n.trashed)
      .filter((n) => !a.type || n.type === a.type)
      .filter((n) => !a.status || n.status === a.status)
      .filter((n) => !a.tag || n.tags.includes(a.tag))
      .filter((n) => {
        const placed = !!tx.state.graph.placements[n.id];
        return !a.where || a.where === 'any' || (a.where === 'canvas' ? placed : !placed);
      })
      .filter((n) => !q || `${n.title} ${n.summary} ${n.body} ${n.tags.join(' ')}`.toLowerCase().includes(q))
      .map((n) => summarize(tx, n));
  },
});

// ------------------------------- nodes -------------------------------------

def({
  name: 'create_node',
  description:
    'Create a node. By default it goes to the sidebar pool (place:"pool"); use place:"canvas" to put it on a canvas straight away (auto-positioned near `nearNodeId` if given). Optionally link it to an existing node in the same step. Returns the new id.',
  shape: {
    type: nodeTypeEnum,
    title: z.string().min(1),
    id: z.string().optional().describe('Optional wanted id (slug). Auto-generated otherwise.'),
    summary: z.string().optional().describe('One or two lines shown on the card.'),
    body: z.string().optional().describe('Markdown, GM-facing notes.'),
    readAloud: z.string().optional().describe('Text to read aloud to the players.'),
    tags: z.array(z.string()).optional(),
    status: statusEnum.optional(),
    fields: z.record(z.unknown()).optional().describe('Type-specific fields, e.g. {tier:"boss"} for npc.'),
    poolHint: z.string().optional().describe('For pool nodes: when/where this might come up.'),
    place: z.enum(['pool', 'canvas']).optional(),
    canvas: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    nearNodeId: z.string().optional().describe('Auto-place next to this node.'),
    linkFrom: z.string().optional().describe('Create an edge FROM this node to the new one.'),
    linkTo: z.string().optional().describe('Create an edge from the new node TO this one.'),
    linkKind: edgeKindEnum.optional(),
    linkLabel: z.string().optional(),
  },
  run(tx, a) {
    const id = tx.newNodeId(a.title, a.id);
    const t = now();
    const node: StoryNode = {
      id,
      type: a.type,
      title: a.title,
      summary: a.summary ?? '',
      body: a.body ?? '',
      readAloud: a.readAloud ?? '',
      tags: a.tags ?? [],
      status: a.status ?? 'untouched',
      fields: a.fields ?? {},
      images: [],
      poolHint: a.poolHint ?? '',
      trashed: false,
      createdAt: t,
      updatedAt: t,
    };
    tx.putNode(node);
    if (a.place === 'canvas' || a.x !== undefined || a.nearNodeId) {
      const canvas = a.canvas ?? tx.state.graph.canvases[0].id;
      checkCanvas(tx, canvas);
      const pos = a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : freeSpot(tx, canvas, a.nearNodeId ?? a.linkFrom);
      tx.setPlacement(id, { canvas, ...pos });
    }
    const kind = a.linkKind ?? 'leads-to';
    if (a.linkFrom) link(tx, a.linkFrom, id, kind, a.linkLabel ?? '');
    if (a.linkTo) link(tx, id, a.linkTo, kind, a.linkLabel ?? '');
    tx.label = `Created ${describe(node)}`;
    return { id };
  },
});

def({
  name: 'update_node',
  description:
    'Edit a node. Only the given properties change. `fields` is merged key by key (set a key to null to remove it). `tags` replaces the tag list.',
  shape: {
    id: z.string(),
    type: nodeTypeEnum.optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    body: z.string().optional(),
    readAloud: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: statusEnum.optional(),
    fields: z.record(z.unknown()).optional(),
    poolHint: z.string().optional(),
  },
  run(tx, a) {
    const cur = tx.requireNode(a.id);
    const next: StoryNode = { ...cur, fields: { ...cur.fields } };
    for (const k of ['type', 'title', 'summary', 'body', 'readAloud', 'tags', 'status', 'poolHint'] as const) {
      if (a[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = a[k];
    }
    if (a.fields) {
      for (const [k, v] of Object.entries(a.fields)) {
        if (v === null) delete next.fields[k];
        else next.fields[k] = v;
      }
    }
    next.updatedAt = now();
    tx.putNode(next);
    tx.label = `Edited ${describe(next)}`;
    return { id: a.id };
  },
});

def({
  name: 'delete_node',
  description: 'Move a node to the trash (soft delete, reversible with restore_node or undo). Its edges are removed.',
  shape: { id: z.string() },
  run(tx, a) {
    const n = tx.requireNode(a.id);
    if (n.trashed) return { id: a.id, already: true };
    for (const e of tx.state.graph.edges.filter((e) => e.from === a.id || e.to === a.id)) tx.removeEdge(e.id);
    tx.setPlacement(a.id, null);
    tx.putNode({ ...n, trashed: true, updatedAt: now() });
    tx.label = `Deleted ${describe(n)}`;
    return { id: a.id };
  },
});

def({
  name: 'restore_node',
  description: 'Restore a trashed node; it returns to the pool (its old edges are not restored, undo does that).',
  shape: { id: z.string() },
  run(tx, a) {
    const n = tx.requireNode(a.id);
    if (!n.trashed) return { id: a.id, already: true };
    tx.putNode({ ...n, trashed: false, updatedAt: now() });
    tx.label = `Restored ${describe(n)}`;
    return { id: a.id };
  },
});

// ------------------------------- placement ---------------------------------

def({
  name: 'move_to_pool',
  description: 'Move a node from the canvas into the sidebar pool (keeps its edges).',
  shape: { id: z.string() },
  run(tx, a) {
    const n = tx.requireNode(a.id);
    tx.setPlacement(a.id, null);
    tx.label = `Moved ${describe(n)} to the pool`;
    return { id: a.id };
  },
});

def({
  name: 'place_on_canvas',
  description:
    'Place a pool node on a canvas. Give x/y, or omit them to auto-position (next to `nearNodeId` if given). Also works to re-place an already placed node.',
  shape: {
    id: z.string(),
    canvas: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    nearNodeId: z.string().optional(),
  },
  run(tx, a) {
    const n = tx.requireNode(a.id);
    if (n.trashed) throw new Error('Node is trashed; restore it first');
    const canvas = a.canvas ?? tx.state.graph.placements[a.id]?.canvas ?? tx.state.graph.canvases[0].id;
    checkCanvas(tx, canvas);
    const pos = a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : freeSpot(tx, canvas, a.nearNodeId);
    tx.setPlacement(a.id, { canvas, ...pos });
    tx.label = `Placed ${describe(n)} on the canvas`;
    return { id: a.id, ...pos, canvas };
  },
});

def({
  name: 'move_node',
  description: 'Move a placed node to new canvas coordinates (optionally to another canvas).',
  shape: { id: z.string(), x: z.number(), y: z.number(), canvas: z.string().optional() },
  run(tx, a) {
    const n = tx.requireNode(a.id);
    const cur = tx.state.graph.placements[a.id];
    if (!cur) throw new Error('Node is in the pool; use place_on_canvas');
    const canvas = a.canvas ?? cur.canvas;
    checkCanvas(tx, canvas);
    tx.setPlacement(a.id, { canvas, x: Math.round(a.x), y: Math.round(a.y) });
    tx.label = `Moved ${describe(n)}`;
    return { id: a.id };
  },
});

// ------------------------------- edges -------------------------------------

def({
  name: 'link',
  description: 'Create an edge between two nodes. kind: leads-to (story flow), conditional, reveals, belongs-to, foreshadows, bridge.',
  shape: { from: z.string(), to: z.string(), kind: edgeKindEnum.optional(), label: z.string().optional() },
  run(tx, a) {
    const e = link(tx, a.from, a.to, a.kind ?? 'leads-to', a.label ?? '');
    tx.label = `Linked “${tx.requireNode(a.from).title}” → “${tx.requireNode(a.to).title}”`;
    return { edgeId: e.id };
  },
});

def({
  name: 'unlink',
  description: 'Remove an edge, by edgeId or by from+to (+kind).',
  shape: { edgeId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), kind: edgeKindEnum.optional() },
  run(tx, a) {
    const edges = tx.state.graph.edges.filter((e) =>
      a.edgeId ? e.id === a.edgeId : e.from === a.from && e.to === a.to && (!a.kind || e.kind === a.kind));
    if (!edges.length) throw new Error('No matching edge');
    for (const e of edges) tx.removeEdge(e.id);
    tx.label = `Unlinked ${edges.length} edge${edges.length > 1 ? 's' : ''}`;
    return { removed: edges.map((e) => e.id) };
  },
});

def({
  name: 'relink',
  description: 'Re-point an existing edge: change its source (`from`), target (`to`), kind or label. Animated in the UI as the edge end sliding to the new node.',
  shape: {
    edgeId: z.string(),
    from: z.string().optional(),
    to: z.string().optional(),
    kind: edgeKindEnum.optional(),
    label: z.string().optional(),
    noTrail: z.boolean().optional().describe('true = do not highlight this connection as part of the played path (the GM wants it unmarked).'),
  },
  run(tx, a) {
    const cur = tx.state.graph.edges.find((e) => e.id === a.edgeId);
    if (!cur) throw new Error(`Edge "${a.edgeId}" not found`);
    const next: StoryEdge = { ...cur, from: a.from ?? cur.from, to: a.to ?? cur.to, kind: a.kind ?? cur.kind, label: a.label ?? cur.label };
    if (a.noTrail !== undefined) { if (a.noTrail) next.noTrail = true; else delete next.noTrail; }
    if (next.from === next.to) throw new Error('Cannot link a node to itself');
    tx.requireNode(next.from);
    tx.requireNode(next.to);
    tx.putEdge(next);
    const moved = next.from !== cur.from || next.to !== cur.to;
    tx.label = moved
      ? `Relinked edge to “${tx.requireNode(next.to).title}”`
      : next.label !== cur.label
        ? next.label ? `Labelled a connection “${next.label}”` : 'Cleared a connection label'
        : !!next.noTrail !== !!cur.noTrail
          ? next.noTrail ? 'Unmarked a connection on the played path' : 'Marked a connection on the played path again'
          : 'Changed a connection’s kind';
    return { edgeId: a.edgeId };
  },
});

// ------------------------------- rulebooks ---------------------------------

def({
  name: 'list_chapters',
  description: 'Table of contents of the loaded rulebook(s) (section ids you can pass to get_section). depth = deepest heading level.',
  readOnly: true,
  shape: { book: z.string().optional(), depth: z.number().int().min(1).max(6).optional() },
  run(tx, a) {
    const r = tx.store.rulebooks;
    if (r.empty) return { books: [], note: 'No rulebook loaded. The GM can add one in the Library tab.' };
    return { books: r.list(), chapters: r.chapters(a.book, a.depth ?? 2) };
  },
});

def({
  name: 'search_rules',
  description: 'Full-text search the loaded rulebook(s). Returns the best sections with a snippet; then call get_section for the full text. Consult the rules before inventing mechanics.',
  readOnly: true,
  shape: { query: z.string().min(1), limit: z.number().int().min(1).max(20).optional(), book: z.string().optional() },
  run(tx, a) {
    return tx.store.rulebooks.search(a.query, a.limit ?? 6, a.book).map((h) => ({ id: h.id, title: h.trail.join(' › ') || h.title, snippet: h.snippet, score: h.score }));
  },
});

def({
  name: 'get_section',
  description: 'Full text of one rulebook section by id (from search_rules / list_chapters), including its sub-sections.',
  readOnly: true,
  shape: { id: z.string(), includeChildren: z.boolean().optional() },
  run(tx, a) {
    return tx.store.rulebooks.section(a.id, a.includeChildren ?? true);
  },
});

def({
  name: 'set_rules_digest',
  description:
    'Write the short "core rules" cheat sheet (markdown, ideally under ~1500 words) that is always included in the AI context. Only on request. Replaces the previous digest.',
  shape: { text: z.string().min(1) },
  run(tx, a) {
    tx.store.rulebooks.setDigest(a.text);
    return { ok: true, chars: a.text.length };
  },
});

// ------------------------------- world books --------------------------------
// Stable worldbuilding documents (lore, geography, history, factions) live in the
// Library next to the rulebooks, as markdown files. They are searchable like the rules;
// the AI always sees each book's compact summary + outline in its context.

def({
  name: 'list_world_chapters',
  description:
    'List the world books (stable worldbuilding documents) with their summaries, plus the heading outline with section ids. Without `book`: all books.',
  readOnly: true,
  shape: { book: z.string().optional(), depth: z.number().int().min(1).max(6).optional() },
  run(tx, a) {
    const w = tx.store.world;
    return {
      books: w.list().map((b) => ({ ...b, summary: w.summary(b.name) })),
      chapters: w.chapters(a.book, a.depth ?? 3),
    };
  },
});

def({
  name: 'search_world',
  description:
    'Full-text keyword search across the world books (lore, geography, history, factions, naming…). Returns sections with snippets; use get_world_section to read one. Use this to recall established world facts before inventing new ones.',
  readOnly: true,
  shape: { query: z.string().min(1), book: z.string().optional(), limit: z.number().int().min(1).max(20).optional() },
  run(tx, a) {
    return tx.store.world.search(a.query, a.limit ?? 6, a.book).map((h) => ({ id: h.id, title: h.trail.join(' › ') || h.title, snippet: h.snippet, score: h.score }));
  },
});

def({
  name: 'get_world_section',
  description: 'Full text of one world-book section by id (from search_world / list_world_chapters), including sub-sections.',
  readOnly: true,
  shape: { id: z.string(), includeChildren: z.boolean().optional() },
  run(tx, a) {
    return tx.store.world.section(a.id, a.includeChildren ?? true);
  },
});

def({
  name: 'write_world',
  description:
    'Create a world book, replace it, or append to it (markdown with # headings so it stays searchable). ONLY when the GM asks you to write or extend the world document — it is stable reference material, not scratch space. The previous version is backed up. Also pass `summary`: a dense 300-600 character digest of the whole book (key places, powers, tensions, naming), which is what you and other AIs see first.',
  shape: {
    book: z.string().min(1).describe('Book name, e.g. "aethermoor".'),
    text: z.string().min(1),
    mode: z.enum(['replace', 'append']).optional(),
    summary: z.string().optional(),
  },
  run(tx, a) {
    const w = tx.store.world;
    const known = w.list().some((b) => b.name === a.book);
    const book = a.mode === 'append' && known ? w.append(a.book, a.text) : w.add(a.book, a.text);
    if (a.summary) w.setSummary(book.name, a.summary);
    return { book: book.name, sections: book.sections.length, chars: book.chars, summary: a.summary ? 'saved' : w.summary(book.name) ? 'kept' : 'missing — please add one with set_world_summary' };
  },
});

def({
  name: 'set_world_summary',
  description: 'Set the compact summary (300-600 characters: the gist of the whole book) shown to the AI for a world book. Keep it dense and factual.',
  shape: { book: z.string(), summary: z.string().min(1) },
  run(tx, a) {
    tx.store.world.setSummary(a.book, a.summary);
    return { ok: true };
  },
});

// ------------------------------- images ------------------------------------

const imageKindEnum = z.enum(Object.keys(IMAGE_KINDS) as [ImageKind, ...ImageKind[]]);

def({
  name: 'generate_image',
  description:
    'Queue image generation (local ComfyUI, Krea 2) for a node. Returns immediately; finished images attach to the node automatically (first one becomes the cover) — check progress with image_queue. Write the prompt as natural-language prose describing subject, setting, composition, lighting and mood (no tag lists, no "masterpiece"); the campaign style is appended automatically. kind picks the format: portrait (character), scene (wide place), item, handout (document page), banner, square. variants 1-4 makes alternatives to choose from.',
  shape: {
    nodeId: z.string(),
    prompt: z.string().min(8),
    kind: imageKindEnum.optional(),
    variants: z.number().int().min(1).max(4).optional(),
    seed: z.number().int().optional(),
    negative: z.string().optional(),
  },
  run(tx, a) {
    if (!tx.store.images) throw new Error('Image generation is not available.');
    tx.requireNode(a.nodeId);
    const jobs = tx.store.images.enqueue({ ...a, actor: tx.actor });
    return { queued: jobs.map((j) => ({ jobId: j.id, seed: j.seed, size: `${j.w}x${j.h}` })), note: 'Queued. Images attach to the node when ready; use image_queue to check.' };
  },
});

def({
  name: 'image_queue',
  description: 'Recent image jobs with status (queued/running/done/error), progress and resulting file.',
  readOnly: true,
  shape: { nodeId: z.string().optional() },
  run(tx, a) {
    return (tx.store.images?.jobs ?? []).filter((j) => !a.nodeId || j.nodeId === a.nodeId).slice(-12).map((j) => ({
      jobId: j.id, nodeId: j.nodeId, kind: j.kind, status: j.status, progress: Math.round(j.progress * 100), file: j.file, error: j.error,
    }));
  },
});

def({
  name: 'get_image_style',
  description: 'The campaign image style (suffix appended to every prompt) and the available image kinds with their sizes.',
  readOnly: true,
  shape: {},
  run(tx) {
    return { style: tx.store.images?.style(), kinds: Object.fromEntries(Object.entries(IMAGE_KINDS).map(([k, v]) => [k, `${v.w}x${v.h} — ${v.hint}`])) };
  },
});

def({
  name: 'set_image_style',
  description:
    'Set the campaign image style (only when the GM asks you to). suffix = look appended to every image prompt (medium, palette, lighting, mood, materials; 25-50 words, no names/plot); negative = things to avoid; mapSuffix = how painted maps look (must stay top-down). Base it on the world books (search_world / get_world_section). Replaces the given fields.',
  shape: { suffix: z.string().optional(), negative: z.string().optional(), mapSuffix: z.string().optional() },
  run(tx, a) {
    const m = tx.state.meta;
    m.style = { ...m.style, ...(a.suffix !== undefined ? { suffix: a.suffix.trim() } : {}), ...(a.negative !== undefined ? { negative: a.negative.trim() } : {}), ...(a.mapSuffix !== undefined ? { mapSuffix: a.mapSuffix.trim() } : {}) };
    tx.store.persistence.writeMeta(m);
    tx.store.emitMeta();
    return { style: tx.store.images?.style() };
  },
});

def({
  name: 'set_cover_image',
  description: 'Choose which of a node’s images is the cover (shown on the card).',
  shape: { nodeId: z.string(), file: z.string() },
  run(tx, a) {
    const n = tx.requireNode(a.nodeId);
    if (!n.images.includes(a.file)) throw new Error(`"${a.file}" is not one of this node's images`);
    tx.putNode({ ...n, images: [a.file, ...n.images.filter((f) => f !== a.file)], updatedAt: now() });
    tx.label = `New cover for ${describe(n)}`;
    return { ok: true };
  },
});

def({
  name: 'remove_image',
  description: 'Detach an image from a node (the file stays in the campaign images folder).',
  shape: { nodeId: z.string(), file: z.string() },
  run(tx, a) {
    const n = tx.requireNode(a.nodeId);
    if (!n.images.includes(a.file)) throw new Error(`"${a.file}" is not one of this node's images`);
    tx.putNode({ ...n, images: n.images.filter((f) => f !== a.file), updatedAt: now() });
    tx.label = `Removed an image from ${describe(n)}`;
    return { ok: true };
  },
});

// ------------------------------- maps --------------------------------------
// A map is a structured document (maps/<id>.json) attached to a node (fields.mapId) — usually a location
// (fields.mapId). Battle maps are text rows of floor cells + doors/props; region
// maps are colour-coded vector shapes. Renders paint them via ComfyUI img2img.

const xy = { x: z.number(), y: z.number() };
const sideEnum = z.enum(EDGE_SIDES as unknown as [EdgeSide, ...EdgeSide[]]);
const mapOps = z.discriminatedUnion('op', [
  z.object({ op: z.literal('room'), ...xy, w: z.number().int().min(1), h: z.number().int().min(1), floor: z.string().optional(), name: z.string().optional() }).describe('Rectangular room: floor + auto walls (also separates it from touching rooms).'),
  z.object({ op: z.literal('corridor'), from: z.tuple([z.number(), z.number()]), to: z.tuple([z.number(), z.number()]), width: z.number().int().min(1).max(6).optional(), floor: z.string().optional() }).describe('L-shaped corridor, horizontal first then vertical.'),
  z.object({ op: z.literal('fill'), ...xy, w: z.number().int().min(1), h: z.number().int().min(1), floor: z.string() }).describe('Set floor of a rectangle of cells (no auto walls). floor "rock" removes floor.'),
  z.object({ op: z.literal('clear'), ...xy, w: z.number().int().min(1), h: z.number().int().min(1) }),
  z.object({ op: z.literal('door'), ...xy, side: sideEnum, kind: z.enum(DOOR_KINDS as unknown as [DoorKind, ...DoorKind[]]).optional() }).describe('Door on the n/e/s/w edge of cell x,y (cuts the wall). kinds: door, secret, window, arch, portcullis.'),
  z.object({ op: z.literal('remove_door'), ...xy, side: sideEnum }),
  z.object({ op: z.literal('wall'), ...xy, side: sideEnum }).describe('Extra inner wall on a cell edge.'),
  z.object({ op: z.literal('open'), ...xy, side: sideEnum }).describe('Remove the wall on a cell edge (wide passage).'),
  z.object({ op: z.literal('prop'), kind: z.enum(PROP_KINDS as unknown as [PropKind, ...PropKind[]]), ...xy, w: z.number().optional(), h: z.number().optional(), rot: z.number().optional(), label: z.string().optional(), id: z.string().optional() }).describe('Furniture/object at cell x,y spanning w x h cells.'),
  z.object({ op: z.literal('remove_prop'), id: z.string() }),
  z.object({ op: z.literal('label'), ...xy, text: z.string() }).describe('Room name in the plan preview (never painted into the image).'),
  z.object({ op: z.literal('token'), ...xy, kind: z.enum(['pc', 'npc', 'enemy']), label: z.string().optional() }).describe('Token start position for the VTT: pc = player start marker (only sent if the VTT wants it), npc / enemy = figures.'),
  z.object({ op: z.literal('remove_label'), ...xy }).describe('Remove labels near x,y.'),
  z.object({ op: z.literal('remove_token'), ...xy }),
  z.object({ op: z.literal('move_area'), ...xy, w: z.number().int().min(1), h: z.number().int().min(1), dx: z.number().int(), dy: z.number().int(), copy: z.boolean().optional() }).describe('Move (or copy, copy:true) everything inside the rectangle x,y,w,h — floor, walls, doors, props, tokens, labels — by dx,dy cells. Use it to shift a room or furniture group instead of redrawing it. The target must stay inside the grid; empty rock does not overwrite existing floor.'),
  z.object({ op: z.literal('edit_prop'), id: z.string(), kind: z.enum(PROP_KINDS as unknown as [PropKind, ...PropKind[]]).optional(), x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional(), rot: z.number().nullable().optional(), label: z.string().nullable().optional() }).describe('Change an existing prop (get its id from get_map): move it, resize it (swap w/h to rotate), change its kind or label.'),
  z.object({ op: z.literal('edit_token'), ...xy, to: z.tuple([z.number(), z.number()]).optional(), kind: z.enum(['pc', 'npc', 'enemy']).optional(), label: z.string().nullable().optional() }).describe('Move or relabel the token that stands at cell x,y.'),
  z.object({ op: z.literal('edit_label'), ...xy, to: z.tuple([z.number(), z.number()]).optional(), text: z.string().optional() }).describe('Move or rename the label near x,y.'),
  z.object({ op: z.literal('resize'), cols: z.number().int(), rows: z.number().int() }),
  z.object({ op: z.literal('shape'), type: z.enum(['polygon', 'path', 'ellipse', 'pin']), kind: z.enum(Object.keys(TERRAINS) as [TerrainKind, ...TerrainKind[]]), points: z.array(z.tuple([z.number(), z.number()])).min(1), r: z.number().optional(), width: z.number().optional(), label: z.string().optional(), id: z.string().optional() }).describe('REGION maps: polygon (areas), path (roads, rivers), ellipse (points[0]=centre, points[1]=[rx,ry]), pin (towns). Coordinates in canvas pixels.'),
  z.object({ op: z.literal('remove_shape'), id: z.string() }),
  z.object({ op: z.literal('clear_all') }),
]);

const FIDELITY = { faithful: 0.62, balanced: 0.7, painterly: 0.8 } as const;

const mapNodeId = (tx: Tx, mapId: string) => Object.values(tx.state.nodes).find((n) => !n.trashed && n.fields.mapId === mapId)?.id ?? null;

def({
  name: 'list_maps',
  description: 'All maps in the campaign with their size and the node (location) they are attached to.',
  readOnly: true,
  shape: {},
  run(tx) {
    return tx.store.maps.list().map((m) => ({ mapId: m.id, name: m.name, kind: m.kind, size: m.kind === 'battle' ? `${m.grid.cols}x${m.grid.rows} cells` : `${m.size.w}x${m.size.h}px`, nodeId: mapNodeId(tx, m.id), renders: m.renders.length }));
  },
});

def({
  name: 'create_map',
  description:
    'Create an empty map attached to a location: with nodeId it becomes the map of that existing node (the node keeps its type and images — use this for "the map of the tavern"); without nodeId a new location node is created for it (in the pool, or on the canvas with place:"canvas"). kind "battle" = grid floor plan for tactical play (cols x rows cells, unit = feet per cell, default 6); kind "region" = free vector map (overland, world, a town) in a canvas of width x height px. Then fill it with edit_map and paint it with render_map.',
  shape: {
    name: z.string().min(1),
    kind: z.enum(['battle', 'region']).optional(),
    cols: z.number().int().min(4).max(80).optional(),
    rows: z.number().int().min(4).max(80).optional(),
    unit: z.number().positive().optional(),
    width: z.number().int().min(256).max(2048).optional(),
    height: z.number().int().min(256).max(2048).optional(),
    place: z.enum(['pool', 'canvas']).optional(),
    summary: z.string().optional(),
    nodeId: z.string().optional().describe('Attach the new map to this existing node (usually a location) instead of creating a node. A node has at most one map.'),
  },
  run(tx, a) {
    if (a.nodeId) {
      const n = tx.requireNode(a.nodeId);
      if (typeof n.fields.mapId === 'string' && n.fields.mapId) throw new Error(`“${n.title}” already has a map (${n.fields.mapId}).`);
    }
    const m = tx.store.maps.create(a.name, a.kind ?? 'battle', a.cols, a.rows, a.unit);
    if (m.kind === 'region') {
      m.size = { w: Math.round((a.width ?? 1344) / 16) * 16, h: Math.round((a.height ?? 768) / 16) * 16 };
      tx.store.maps.save(m, { backup: 'none' });
    }
    if (a.nodeId) {
      const n = tx.requireNode(a.nodeId);
      tx.putNode({ ...n, fields: { ...n.fields, mapId: m.id }, updatedAt: now() });
      tx.label = `Created a map for “${n.title}”`;
      return { mapId: m.id, nodeId: n.id, kind: m.kind };
    }
    const id = tx.newNodeId(a.name);
    const t = now();
    tx.putNode({
      id, type: 'location', title: a.name, summary: a.summary ?? (m.kind === 'battle' ? `Battle map ${m.grid.cols}×${m.grid.rows}` : 'Region map'), body: '', readAloud: '', tags: [], status: 'untouched',
      fields: { mapId: m.id }, images: [], poolHint: '', trashed: false, createdAt: t, updatedAt: t,
    });
    if (a.place === 'canvas') {
      const canvas = tx.state.graph.canvases[0].id;
      tx.setPlacement(id, { canvas, ...freeSpot(tx, canvas) });
    }
    tx.label = `Created map “${a.name}”`;
    return { mapId: m.id, nodeId: id, kind: m.kind };
  },
});

def({
  name: 'get_map',
  description: 'Text view of a map: for battle maps the cell rows (y=0 is the top, "." = rock) with the floor legend plus doors/props/labels/tokens; for region maps the shapes. Read this before editing.',
  readOnly: true,
  shape: { mapId: z.string() },
  run(tx, a) {
    const m = tx.store.maps.get(a.mapId);
    return { mapId: m.id, nodeId: mapNodeId(tx, m.id), view: tx.store.maps.describe(m), renders: m.renders };
  },
});

def({
  name: 'edit_map',
  description:
    'Change a map with a list of ops, applied in order (all-or-nothing). Battle maps: draw rooms and corridors, add doors/props/labels/tokens — walls are derived automatically. Coordinates are grid cells (x right, y down, 0,0 top-left). Floors: stone wood dirt grass carpet water lava rubble marble sand ice, or rock. Region maps: add shapes. The change appears live in the GM’s map editor. Check the result with get_map.',
  shape: { mapId: z.string(), ops: z.array(mapOps).min(1).max(120) },
  run(tx, a) {
    const m = tx.store.maps.get(a.mapId);
    const r = applyOps(m, a.ops as MapOp[]);
    tx.store.maps.save(m);
    tx.store.emitMap(m, tx.actor);
    return { applied: r.ok, notes: r.notes };
  },
});

def({
  name: 'render_map',
  description:
    'Paint a map with the local image model (img2img from a colour-coded render of the layout). Queues and returns immediately; the finished image is added to the location’s images and is listed in the map’s renders (check with image_queue). prompt = what the place looks like (materials, mood, lighting, setting) — NOT the layout, that comes from the map. fidelity: faithful (keeps the plan exactly, flatter look), balanced (default), painterly (richer, may drift from the plan). Takes ~1.5 min per variant.',
  shape: {
    mapId: z.string(),
    prompt: z.string().min(8),
    fidelity: z.enum(['faithful', 'balanced', 'painterly']).optional(),
    denoise: z.number().min(0.3).max(0.95).optional(),
    variants: z.number().int().min(1).max(4).optional(),
    seed: z.number().int().optional(),
  },
  run(tx, a) {
    const images = tx.store.images;
    if (!images) throw new Error('Image generation is not available.');
    const m = tx.store.maps.get(a.mapId);
    const nodeId = mapNodeId(tx, m.id);
    if (!nodeId) throw new Error(`Map "${m.id}" is not attached to any node. Create it with create_map (with nodeId to attach it to a location).`);
    const maps = tx.store.maps;
    const { w, h } = imageSize(m);
    const denoise = a.denoise ?? FIDELITY[a.fidelity ?? 'balanced'];
    const style = images.style();
    const prompt = `${a.prompt.trim().replace(/[.\s]+$/, '')}. ${style.mapSuffix}. ${m.kind === 'battle' ? CONTROL_LEGEND : REGION_LEGEND}`;
    const negative = `${style.negative}, characters, people, perspective view, 3d render, photograph`;
    const png = toPng(renderSvg(m, 'control'));
    const jobs = images.enqueueCustom({
      nodeId, kind: 'map', prompt: a.prompt.trim(), w, h, variants: a.variants, seed: a.seed, actor: tx.actor,
      build: async (seed) => {
        const name = await images.comfy.uploadImage(png, `pnp-${m.id}.png`);
        return images.comfy.buildImg2Img(prompt, negative, name, seed, denoise);
      },
      after: (file) => {
        const cur = maps.get(m.id);
        cur.renders.push(file);
        maps.save(cur, { backup: 'none' });
        tx.store.emitMap(cur, tx.actor);
      },
    });
    return { queued: jobs.map((j) => ({ jobId: j.id, seed: j.seed })), size: `${w}x${h}`, denoise, note: 'Queued (~1.5 min each). The result becomes the node cover; check with image_queue.' };
  },
});

def({
  name: 'delete_map',
  description: 'Delete a map document (its map node and rendered images stay; the node just loses its layout).',
  shape: { mapId: z.string() },
  run(tx, a) {
    tx.store.maps.get(a.mapId);
    tx.store.maps.remove(a.mapId);
    return { ok: true };
  },
});

// ------------------------------- VTT ---------------------------------------
// The VTT is whatever tabletop software the GM runs (KINETIK VTT, a friend's VTT…). It connects to
// PenNodePaper's bridge and announces what it supports; everything is pushed in one fixed format (UPF).

def({
  name: 'get_vtt_capabilities',
  description:
    'Is a VTT connected, and what can it receive? Returns its capability profile (live while connected, otherwise the last cached one): the push kinds it accepts (handout / scene / character / music_cue) and — most important — its CHARACTER ROLES: for each role (e.g. enemy, npc) the exact sheet structure (fields with type, range, options, conditional fields) plus presets with the game’s own defaults. Fill character sheets in exactly these terms (see set_character_sheet), using the rulebook for the actual numbers. A VTT may describe characters without being able to receive them (canReceiveCharacters:false): you can still write the sheets for the GM to read.',
  readOnly: true,
  shape: {},
  run(tx) {
    const s = tx.store.vtt.status();
    return {
      connected: s.connected, source: s.source, vtt: s.profile,
      characterRoles: s.profile?.characters?.roles ?? [],
      canReceiveCharacters: !!s.profile?.push.character,
      note: s.connected ? 'Pushes go live to the connected VTT.' : s.profile ? 'Not connected: this is the last known profile (sheets can still be edited; use export_vtt_bundle for an offline file).' : 'No VTT has connected yet, so no character sheet structure is known.',
    };
  },
});

def({
  name: 'push_handout',
  description: 'Send a node to the VTT as a player handout — any node: an NPC portrait, an item, a location illustration, a scene. Sends the chosen image (default: the node’s cover illustration) if it has one, else its read-aloud text (or summary). GM notes are never sent. By default it is only ADDED to the GM’s handout library in the VTT; reveal:true (or a player id in `to`) also shows it to the players immediately — only do that when the GM asked.',
  async: true,
  shape: { nodeId: z.string(), image: z.string().optional().describe('Which of the node\'s images (file name; default: its cover illustration) — works for ANY node with images: NPC portraits, items, locations, scenes…'), to: z.string().optional().describe('Player id to show it to'), reveal: z.boolean().optional().describe('Show to all players right now') },
  async run(tx, a) {
    const h = handoutFromNode(tx.store, tx.store.imagesDir, a.nodeId, { to: a.to, reveal: a.reveal, image: a.image });
    await tx.store.vtt.push({ kind: 'handout', payload: h });
    return { pushed: 'handout', title: h.title, as: h.kind, revealed: !!(a.reveal || a.to) };
  },
});

def({
  name: 'push_scene',
  description: 'Show a place on the VTT\'s map screen. Two ways: (1) the tactical MAP of a location (mapId, or nodeId of a location that has a map): grid size, offset, token starts; uses the latest painted render (or the plan image with image:"plan"). (2) an ILLUSTRATION of a location as a backdrop (nodeId + imageFile, a file name from the node\'s images): no grid, no tokens — for the establishing shot before the battle map. activate:true shows it to the players right away; ask the GM which of the two they want shown first.',
  async: true,
  shape: { mapId: z.string().optional(), nodeId: z.string().optional(), imageFile: z.string().optional().describe('Show this illustration of the node as a backdrop instead of its map.'), image: z.enum(['painted', 'plan']).optional(), activate: z.boolean().optional(), includePlayers: z.boolean().optional().describe('Also send player start markers (pc tokens). Default: only if the VTT asks for them in its profile.') },
  async run(tx, a) {
    if (a.imageFile) {
      if (!a.nodeId) throw new Error('imageFile needs the nodeId it belongs to.');
      const sc = sceneFromImage(tx.store, tx.store.imagesDir, a.nodeId, a.imageFile, { activate: a.activate });
      await tx.store.vtt.push({ kind: 'scene', payload: sc });
      return { pushed: 'scene', name: sc.name, as: 'backdrop (no grid)' };
    }
    const mapId = a.mapId ?? (a.nodeId ? String(tx.requireNode(a.nodeId).fields.mapId ?? '') : '');
    if (!mapId) throw new Error('Give a mapId, or the nodeId of a location that has a map.');
    const sc = sceneFromMap(tx.store, tx.store.imagesDir, mapId, { image: a.image, activate: a.activate, players: wantsPlayerStarts(tx.store.vtt.status().profile, a.includePlayers) });
    await tx.store.vtt.push({ kind: 'scene', payload: sc });
    return { pushed: 'scene', name: sc.name, grid: `${sc.grid.size}px · ${sc.grid.unitsPerCell} ${sc.grid.unit}/cell`, tokens: sc.tokens.length };
  },
});

def({
  name: 'set_character_sheet',
  description:
    'Fill in or change the character sheet of an enemy/NPC node, in the structure the connected (or last known) VTT declares — see get_vtt_capabilities → characterRoles. role picks the sheet type (default: enemy nodes → "enemy", npc nodes → "npc"). preset starts from the game’s defaults for that archetype/tier (e.g. a KINETIK tier); `sheet` then overrides single values. Values are validated against the schema (types, ranges, options); invalid input is rejected with the reason. Read the rulebook (search_rules) to choose sensible numbers and abilities.',
  shape: {
    nodeId: z.string(),
    role: z.string().optional(),
    preset: z.string().optional(),
    sheet: z.record(z.unknown()).optional().describe('Field values keyed by the role’s field keys.'),
    replace: z.boolean().optional().describe('Discard the existing sheet instead of merging into it.'),
  },
  run(tx, a) {
    const n = tx.requireNode(a.nodeId);
    const profile = tx.store.vtt.status().profile;
    const role = roleFor(profile, n, a.role);
    const preset = role.presets?.find((p) => p.id === (a.preset ?? n.fields.preset));
    if (a.preset && !preset) throw new Error(`Unknown preset "${a.preset}" for role "${role.id}". Presets: ${(role.presets ?? []).map((p) => p.id).join(', ') || '(none)'}`);
    const base = a.replace ? {} : sheetOf(n);
    const merged = { ...base, ...(a.preset ? preset!.values : {}), ...(a.sheet ?? {}) };
    const check = validateSheet(role, merged, { preset: preset?.id });
    if (check.errors.length) throw new Error(`Sheet rejected: ${check.errors.join('; ')}`);
    const fields: Record<string, unknown> = { ...n.fields, role: role.id, sheet: check.sheet };
    if (preset) fields.preset = preset.id;
    for (const k of Object.keys(fields)) if (!['role', 'preset', 'sheet', 'mapId'].includes(k) && k in check.sheet) delete fields[k]; // migrate loose legacy fields
    tx.putNode({ ...n, fields, updatedAt: now() });
    tx.label = `Edited the ${role.label} sheet of ${describe(n)}`;
    return { role: role.id, preset: preset?.id, sheet: check.sheet, warnings: check.warnings };
  },
});

def({
  name: 'push_character',
  description:
    'Send an enemy/NPC node to the VTT as a character (the VTT creates it in its own way: combat entry, token, …). The sheet is validated against the VTT’s declared role first; the node’s cover image becomes the portrait. Fill the sheet with set_character_sheet first. Only push when the GM asks.',
  async: true,
  shape: { nodeId: z.string(), role: z.string().optional() },
  async run(tx, a) {
    const prof = tx.store.vtt.status().profile;
    if (prof && !prof.push.character) throw new Error(`${prof.name} describes characters but can't receive them yet. The sheet is saved on the node; the GM can read it there, copy it (Inspector → Copy), or export it with export_vtt_bundle.`);
    const { character, warnings } = characterFromNode(tx.store, tx.store.imagesDir, a.nodeId, tx.store.vtt.status().profile, a.role);
    await tx.store.vtt.push({ kind: 'character', payload: character });
    return { pushed: 'character', role: character.role, name: character.name, portrait: !!character.portrait, warnings };
  },
});

def({
  name: 'list_vtt_tracks',
  description: 'The music tracks the VTT knows (shipped + the GM’s own uploads), with ids for play_track.',
  async: true,
  readOnly: true,
  shape: {},
  async run(tx) {
    return await tx.store.vtt.tracks();
  },
});

def({
  name: 'play_track',
  description: 'Start or stop music in the VTT. Use a trackId from list_vtt_tracks, or a free-text mood if the VTT supports moods.',
  async: true,
  shape: { action: z.enum(['play', 'stop']), trackId: z.string().optional(), mood: z.string().optional() },
  async run(tx, a) {
    await tx.store.vtt.push({ kind: 'music_cue', payload: a });
    return { ok: true, ...a };
  },
});

def({
  name: 'export_vtt_bundle',
  description:
    'Offline export for a VTT. format "kinetik-session" = a fresh KINETIK VTT session file (scenes + handouts; load it on the GM start screen — NOTE it replaces that VTT’s session); "upf" = the universal bundle other VTTs can import. Select handouts / maps / characters by node id / map id; omit all three to export every handout node, every map and every enemy node with a valid sheet. Returns the file path and a download URL.',
  shape: {
    format: z.enum(['kinetik-session', 'upf']).optional(),
    handouts: z.array(z.string()).optional(),
    maps: z.array(z.string()).optional(),
    characters: z.array(z.string()).optional(),
    includePlayers: z.boolean().optional().describe('Keep player start markers in exported scenes (default: only if the VTT wants them).'),
  },
  run(tx, a) {
    const all = !a.handouts && !a.maps && !a.characters;
    const handouts = a.handouts ?? (all ? Object.values(tx.state.nodes).filter((n) => n.type === 'handout' && !n.trashed && (n.images.length || n.readAloud || n.summary)).map((n) => n.id) : []);
    const maps = a.maps ?? (all ? tx.store.maps.list().filter((m) => m.renders.length || m.kind === 'battle').map((m) => m.id) : []);
    const profile = tx.store.vtt.status().profile;
    const characters =
      a.characters ??
      (all
        ? Object.values(tx.state.nodes).filter((n) => n.type === 'enemy' && !n.trashed).filter((n) => {
            try {
              characterFromNode(tx.store, tx.store.imagesDir, n.id, profile);
              return true;
            } catch {
              return false; // incomplete sheet: skipped in the default selection
            }
          }).map((n) => n.id)
        : []);
    const bundle = buildBundle(tx.store, tx.store.imagesDir, { handouts, maps, characters }, profile, { includePlayers: a.includePlayers });
    const format = a.format ?? 'kinetik-session';
    const body = format === 'upf' ? bundle : kinetikSession(bundle);
    fs.mkdirSync(tx.store.exportsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const file = `${slugify(tx.state.meta.name)}-${stamp}.${format === 'upf' ? 'upf' : 'kinetik-session'}.json`;
    fs.writeFileSync(path.join(tx.store.exportsDir, file), JSON.stringify(body));
    return { file, url: `/api/exports/${file}`, handouts: bundle.handouts.length, scenes: bundle.scenes.length, characters: bundle.characters.length };
  },
});

// ------------------------------- story tracking -----------------------------
// Where are the players, what did they skip, what do they know? Pure analysis lives in
// @pnp/shared/story.ts so the UI and these tools always agree.

def({
  name: 'lint_story',
  description:
    'Check the story graph for problems: decisions with fewer than two ways forward, dead ends, clues nobody can find, separate unreachable chains, "key" nodes with fewer than three paths in (three-clue rule), clocks that are full, unlinked mentions. Returns warnings first. Use it before a session or after big edits, and fix what the GM asks you to.',
  readOnly: true,
  shape: { level: z.enum(['warn', 'info', 'all']).optional() },
  run(tx, a) {
    const issues = lintStory(tx.state).filter((i) => !a.level || a.level === 'all' || i.level === a.level);
    return { count: issues.length, warnings: issues.filter((i) => i.level === 'warn').length, issues };
  },
});

def({
  name: 'story_status',
  description:
    'Where is the story right now? Returns the played path (in order), where the players are, the FRONTIER (unplayed nodes the story can pick up next, nearest first; converges:true = several planned paths meet there — good places to merge back), what was SKIPPED (planned nodes before something already played), roads NOT TAKEN at forks, clues/secrets the players do NOT know yet and what each would have opened up, and progress clocks. Use this to answer "how do we get back on track and what did they miss?".',
  readOnly: true,
  shape: {},
  run(tx) {
    return storyStatus(tx.state);
  },
});

function markPlayed(tx: Tx, a: { nodeId: string; status?: 'active' | 'done' | 'skipped'; after?: string; group?: string; keep?: boolean }) {
    const n = tx.requireNode(a.nodeId);
    const status = a.status ?? 'active';
    const group = (a.group?.trim() || DEFAULT_GROUP).slice(0, 40);
    const here = Object.values(tx.state.nodes).filter((x) => !x.trashed && x.id !== n.id && visitsOf(x).some((v) => v.group === group && v.here));
    let placedNow = false;
    let linkedFrom: string | undefined;

    if (status !== 'skipped') {
      const from = a.after ?? here[0]?.id;
      if (!tx.state.graph.placements[n.id]) {
        const ref = from ? tx.state.graph.placements[from] : undefined;
        const canvas = ref?.canvas ?? tx.state.graph.canvases[0].id;
        tx.setPlacement(n.id, { canvas, ...freeSpot(tx, canvas, from) });
        placedNow = true;
      }
      if (from && from !== n.id && placedNow && !tx.state.graph.edges.some((e) => e.from === from && e.to === n.id)) {
        link(tx, from, n.id, 'leads-to', '');
        linkedFrom = from;
      }
    }

    // this group leaves where it was; the node stays active if another group is still there
    const settle = (x: StoryNode, visits: Visit[]): StoryNode => {
      const fields: Record<string, unknown> = { ...x.fields, visits };
      delete fields.playedSeq;
      return { ...x, fields, status: visits.some((v) => v.here) ? 'active' : visits.length ? 'done' : x.status, updatedAt: now() };
    };
    if (status === 'active' && !a.keep) {
      for (const prev of here) tx.putNode(settle(prev, visitsOf(prev).map((v) => (v.group === group ? { ...v, here: false } : v))));
    }

    const visits = visitsOf(n);
    const mine = visits.find((v) => v.group === group);
    const seq = mine?.seq ?? nextPlayedSeq(tx.state);
    if (status === 'skipped') {
      const rest = visits.filter((v) => v.group !== group);
      tx.putNode({ ...settle(n, rest), status: 'skipped' });
    } else {
      const next = [...visits.filter((v) => v.group !== group), { group, seq, here: status === 'active' }];
      tx.putNode(settle(n, next));
    }
    tx.label =
      status === 'skipped' ? `Skipped ${describe(n)}` : `${group === DEFAULT_GROUP ? 'Players' : group} ${status === 'active' ? 'reached' : 'finished'} ${describe(n)}${placedNow ? ' (added to the story map)' : ''}`;
    return { id: n.id, group, status, seq: status === 'skipped' ? undefined : seq, placed: placedNow, linkedFrom, path: playedPath(tx.state, group).map((p) => p.title) };
}

def({
  name: 'mark_played',
  description:
    'Record that the players reached a node. status "active" (default) = they are there now (that group\'s previous node becomes done); "done" = they left it; "skipped" = deliberately bypassed. A POOL node that the players visit is placed on the canvas next to `after` (default: where that group was) and linked from it, so the improvised detour becomes part of the story map. If the party SPLITS UP, give each sub-group its own `group` name (e.g. "Anna & Ben", "Rogues"): every group has its own position and trail, and a node stays active while any group is on it. Rejoining = both groups mark the same node. Default group: "party". ONLY use `group` when the party really splits — never to tell two nodes apart; for the players being at several nodes at once (tavern + a running event) use set_here. Use when the GM tells you what happened at the table.',
  shape: {
    nodeId: z.string(),
    status: z.enum(['active', 'done', 'skipped']).optional(),
    after: z.string().optional().describe('Node this group came from (links after → node, places a pool node next to it).'),
    group: z.string().optional().describe('Which part of the party (default "party"). Use one name per sub-group when the party splits.'),
  },
  run(tx, a) {
    return markPlayed(tx, a);
  },
});

/** Rename a group everywhere (its trail and its position), merging into an existing visit when both exist. */
function renameGroup(tx: Tx, from: string, to: string) {
  if (from === to) return;
  for (const n of Object.values(tx.state.nodes)) {
    const vs = visitsOf(n);
    if (!vs.some((v) => v.group === from)) continue;
    const merged: Visit[] = [];
    for (const v of vs) {
      const g = v.group === from ? to : v.group;
      const have = merged.find((m) => m.group === g);
      if (have) { have.seq = Math.min(have.seq, v.seq); have.here = have.here || v.here; } else merged.push({ ...v, group: g });
    }
    const fields: Record<string, unknown> = { ...n.fields, visits: merged };
    delete fields.playedSeq;
    tx.putNode({ ...n, fields, updatedAt: now() });
  }
}

def({
  name: 'set_status',
  description:
    'Set a node\'s table status. active = "in play right now" (several nodes can be active at once — a running event, a clock, a place the players could return to; it does NOT move the players: use move_players / mark_played for that). done / skipped = played or deliberately bypassed (recorded on the played path). untouched = reset: forget that it was played.',
  shape: { nodeId: z.string(), status: z.enum(['untouched', 'active', 'done', 'skipped']) },
  run(tx, a) {
    const n = tx.requireNode(a.nodeId);
    if (a.status === 'done' || a.status === 'skipped') return markPlayed(tx, { nodeId: a.nodeId, status: a.status });
    const fields: Record<string, unknown> = { ...n.fields };
    if (a.status === 'untouched') { delete fields.visits; delete fields.playedSeq; }
    tx.putNode({ ...n, status: a.status, fields, updatedAt: now() });
    tx.label = a.status === 'active' ? `Set “${n.title}” active` : `Reset “${n.title}” to untouched`;
    return { node: n.id, status: a.status };
  },
});

def({
  name: 'set_here',
  description:
    'The players are at SEVERAL nodes at once — e.g. in the tavern while the bell event is running. Marks every node in `nodeIds` as "players are here" for that group (default "party"); where the group was before is settled (done), unless it is one of the new nodes. Pool nodes are placed and linked from where the group was. For ONE node use mark_played; for a party that splits into parts use move_players. To mark nodes as merely "in play" without saying the players are there, use set_status active.',
  shape: { nodeIds: z.array(z.string()).min(1), group: z.string().optional() },
  run(tx, a) {
    const group = (a.group?.trim() || DEFAULT_GROUP).slice(0, 40);
    const ids = [...new Set(a.nodeIds)];
    for (const id of ids) tx.requireNode(id);
    const before = Object.values(tx.state.nodes).filter((x) => !x.trashed && !ids.includes(x.id) && visitsOf(x).some((v) => v.group === group && v.here));
    const from = before[0]?.id;
    for (const prev of before) {
      const fields: Record<string, unknown> = { ...prev.fields, visits: visitsOf(prev).map((v) => (v.group === group ? { ...v, here: false } : v)) };
      delete fields.playedSeq;
      const still = (fields.visits as Visit[]).some((v) => v.here);
      tx.putNode({ ...prev, fields, status: still ? 'active' : 'done', updatedAt: now() });
    }
    ids.forEach((id) => markPlayed(tx, { nodeId: id, status: 'active', group, after: from, keep: true }));
    tx.label = `${group === DEFAULT_GROUP ? 'Players' : group} are at ${ids.map((id) => describe(tx.requireNode(id))).join(' and ')}`;
    return { group, nodes: ids };
  },
});

def({
  name: 'move_players',
  description:
    'Move some of the PLAYER CHARACTERS to a node — the way to track a party that splits up or comes back together ("two go to Brenn, two go to Mira"). `characters` = player-character node ids or names (see get_party). They become one group at `nodeId`; the others stay where they were, as their own group with their own trail. If another group is already at that node, they merge. Group names are derived from who is together (e.g. "Jin & Mia"; everybody = "party"). A pool node that they visit is placed and linked from where they came from.',
  shape: { characters: z.array(z.string()).min(1), nodeId: z.string() },
  run(tx, a) {
    const target = tx.requireNode(a.nodeId);
    const all = Object.values(tx.state.nodes).filter((n) => n.type === 'pc' && !n.trashed && n.fields.present !== false);
    if (!all.length) throw new Error('No player characters yet — connect a VTT that reports its party, or use mark_played with a group name.');
    const pick = (ref: string) => all.find((n) => n.id === ref) ?? all.find((n) => n.title.toLowerCase() === ref.toLowerCase()) ?? all.find((n) => n.title.toLowerCase().startsWith(ref.toLowerCase()));
    const moving = [...new Set(a.characters.map((r) => pick(r) ?? (() => { throw new Error(`No player character "${r}". Party: ${all.map((n) => n.title).join(', ')}`); })()))];
    const frag = (n: StoryNode) => (typeof n.fields.group === 'string' && n.fields.group ? n.fields.group : DEFAULT_GROUP);
    const nameFor = (members: StoryNode[]) => fragmentName(members.map((n) => n.title), all.length);
    const setGroup = (members: StoryNode[], g: string) => {
      for (const m of members) {
        const cur = tx.requireNode(m.id);
        const fields = { ...cur.fields };
        if (g === DEFAULT_GROUP) delete fields.group; else fields.group = g;
        tx.putNode({ ...cur, fields, updatedAt: now() });
      }
    };

    const touched = [...new Set(moving.map(frag))];
    // where the moving players came from (to place/link a visited pool node and to find the previous position)
    const cameFrom = Object.values(tx.state.nodes).find((n) => !n.trashed && visitsOf(n).some((v) => v.here && touched.includes(v.group)))?.id;

    // the ones left behind keep their place and trail under their own (smaller) group name
    const emptied: string[] = [];
    for (const f of touched) {
      const rest = all.filter((n) => frag(n) === f && !moving.includes(n));
      if (!rest.length) { emptied.push(f); continue; }
      const nm = nameFor(rest);
      renameGroup(tx, f, nm);
      setGroup(rest, nm);
    }
    // another group already at the target joins them
    const atTarget = [...new Set(visitsOf(tx.requireNode(a.nodeId)).filter((v) => v.here).map((v) => v.group))].filter((g) => !touched.includes(g));
    const joining = all.filter((n) => atTarget.includes(frag(tx.requireNode(n.id))));
    const together = [...new Set([...moving, ...joining])];
    const final = nameFor(together);
    for (const g of atTarget) renameGroup(tx, g, final);
    for (const f of emptied) renameGroup(tx, f, final); // a whole group moving on keeps its trail
    setGroup(together, final);

    const r = markPlayed(tx, { nodeId: a.nodeId, status: 'active', group: final, after: cameFrom && cameFrom !== a.nodeId ? cameFrom : undefined });
    tx.label = `${together.map((n) => n.title.split(/\s+/)[0]).join(' & ')} → ${describe(target)}${r.placed ? ' (added to the story map)' : ''}`;
    return { group: final, members: together.map((n) => n.title), node: target.id, placed: r.placed, groups: [...new Set(all.map((n) => frag(tx.requireNode(n.id))))] };
  },
});

def({
  name: 'set_known',
  description: 'Record whether the players know about a clue/secret/lore node (so you never spoil it, and story_status lists what they still do not know).',
  shape: { nodeId: z.string(), known: z.boolean() },
  run(tx, a) {
    const n = tx.requireNode(a.nodeId);
    tx.putNode({ ...n, fields: { ...n.fields, known: a.known }, updatedAt: now() });
    tx.label = `${a.known ? 'Players learned' : 'Players do not know'}: ${describe(n)}`;
    return { id: n.id, known: a.known };
  },
});

def({
  name: 'set_table',
  description:
    'Fill a random table (a node of type "table"; create one with create_node first). `entries` = the lines, each a string; "3× Fog" makes an entry three times as likely (3 faces of the die). The table\'s die is the total number of faces (6 entries = d6, 20 = d20). Replaces the old entries unless append:true. Write evocative, specific entries in the campaign language — names, rumours, loot, weather, complications; use the world books for local colour. Typical size 6, 8, 10, 12 or 20.',
  shape: { nodeId: z.string(), entries: z.array(z.string().min(1)).min(1).max(100), append: z.boolean().optional() },
  run(tx, a) {
    const n = tx.requireNode(a.nodeId);
    if (n.type !== 'table') throw new Error(`“${n.title}” is a ${n.type}, not a random table (create the node with type "table").`);
    const fresh = a.entries.flatMap((e) => parseEntry(e) ?? []).map(entryLine);
    if (!fresh.length) throw new Error('No usable entries.');
    const entries = [...(a.append ? tableEntries(n).map(entryLine) : []), ...fresh];
    tx.putNode({ ...n, fields: { ...n.fields, entries }, updatedAt: now() });
    tx.label = `${a.append ? 'Added to' : 'Filled'} the table “${n.title}” (${entries.length} entries)`;
    return { id: n.id, entries: entries.length, die: dieLabel(tableFaces(tableEntries({ fields: { entries } }))) };
  },
});

def({
  name: 'roll_table',
  description: 'Roll a random table node (once or several times, with replacement). The result is remembered on the node (last roll + history) so the GM sees it. Use for names, rumours, loot, weather, complications — and tell the GM what came up. `seed` makes a roll reproducible.',
  shape: { nodeId: z.string(), times: z.number().int().min(1).max(10).optional(), seed: z.number().int().optional() },
  run(tx, a) {
    const n = tx.requireNode(a.nodeId);
    const entries = tableEntries(n);
    if (!entries.length) throw new Error(`The table “${n.title}” has no entries yet — fill it with set_table.`);
    const rnd = a.seed !== undefined ? seeded(a.seed) : Math.random;
    const rolls = Array.from({ length: a.times ?? 1 }, () => rollTable(entries, rnd));
    const at = now();
    const history = [...rolls.map((r) => ({ at, roll: r.roll, text: r.text })), ...rollLog(n)].slice(0, 12);
    tx.putNode({ ...n, fields: { ...n.fields, last: rolls.map((r) => r.text).join(' · '), history }, updatedAt: at });
    tx.label = `Rolled “${n.title}”: ${rolls.map((r) => r.text).join(' · ')}`;
    return { table: n.title, die: dieLabel(tableFaces(entries)), results: rolls.map((r) => ({ roll: r.roll, result: r.text })) };
  },
});

def({
  name: 'export_binder',
  description: 'Make the GM binder: the whole campaign as one printable PDF in the exports folder (cover, contents, story map, the story beat by beat with read-aloud boxes and GM notes, prepared material, places with their maps, people with sheets, things, handouts, random tables, the party). `sections` picks parts (map, story, pool, places, people, things, handouts, tables, party); notes:false leaves out the GM notes (e.g. for a co-GM handout); images:false makes it smaller. Takes a few seconds.',
  shape: { sections: z.array(z.enum(BINDER_SECTIONS)).optional(), notes: z.boolean().optional(), images: z.boolean().optional() },
  run(tx, a) {
    const html = binderHtml(tx.store, a);
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const file = `${slugify(tx.state.meta.name)}-binder-${stamp}.pdf`;
    renderPdf(html, tx.store.persistence.dir, path.join(tx.store.exportsDir, file));
    const bytes = fs.statSync(path.join(tx.store.exportsDir, file)).size;
    return { file, url: `/api/exports/${file}`, mb: Math.round(bytes / 1e5) / 10 };
  },
});

def({
  name: 'accept_proposal',
  description: 'GM only: keep the AI\'s pending changes (review mode). Without id: all of them.',
  internal: true,
  shape: { id: z.string().optional() },
  run(tx, a) {
    return { accepted: tx.store.acceptProposal(a.id) };
  },
});

def({
  name: 'reject_proposal',
  description: 'GM only: take the AI\'s pending changes back (review mode). Without id: all of them.',
  internal: true,
  shape: { id: z.string().optional() },
  run(tx, a) {
    return { rejected: tx.store.rejectProposal(a.id, tx.actor) };
  },
});

def({
  name: 'create_snapshot',
  description: 'Save a safety copy of the whole campaign (nodes, graph, maps, books, images) that the GM can restore later. Do this BEFORE a big or risky bulk change (restructuring many nodes, importing notes, deleting a lot) and tell the GM you did. Restoring is the GM\'s decision.',
  shape: { label: z.string().optional().describe('Short reason, e.g. "before merging the two acts".') },
  run(tx, a) {
    const s = tx.store.backups.create({ kind: 'manual', label: a.label });
    return { snapshot: s.id, label: s.label, mb: Math.round(s.bytes / 1e5) / 10 };
  },
});

def({
  name: 'list_snapshots',
  description: 'The campaign\'s snapshots, newest first (id, time, kind: auto/manual/pre-restore, label).',
  readOnly: true,
  shape: {},
  run(tx) {
    return tx.store.backups.list().slice(0, 30);
  },
});

def({
  name: 'list_imports',
  description: 'Notes the GM imported (files or pasted text) that are waiting to be turned into nodes: name, size in characters.',
  readOnly: true,
  shape: {},
  run(tx) {
    return tx.store.imports.list();
  },
});

def({
  name: 'read_import',
  description: 'Read an imported notes file in chunks (default 6000 characters, cut at a line break). Follow `next` until it is null. Read ALL of it before creating nodes from it.',
  readOnly: true,
  shape: { name: z.string(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(500).max(20000).optional() },
  run(tx, a) {
    return tx.store.imports.read(a.name, a.offset ?? 0, a.limit ?? 6000);
  },
});

def({
  name: 'player_wiki',
  description:
    'What the PLAYERS know, safe to share: the story so far (in the order they played it), the people, places and things they met, and the clues/lore they learned — only text written for the players (the read-aloud block; summaries and notes are the GM\'s and are never included) or anything they have not experienced. Use it to write a session recap or answer "what do my players know about X?". Returns structured entries plus ready-made markdown.',
  readOnly: true,
  shape: {},
  run(tx) {
    const w = playerWiki(tx.state);
    return { ...w, markdown: wikiMarkdown(w) };
  },
});

def({
  name: 'export_player_wiki',
  description: 'Save the player wiki (see player_wiki) as a markdown file in the campaign\'s exports folder, to hand to the players. Pass `text` to save YOUR OWN spoiler-safe recap instead of the generated list (write it from player_wiki only).',
  shape: { text: z.string().optional() },
  run(tx, a) {
    const md = a.text?.trim() ? `${a.text.trim()}\n` : wikiMarkdown(playerWiki(tx.state));
    fs.mkdirSync(tx.store.exportsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const file = `${slugify(tx.state.meta.name)}-players-${stamp}.md`;
    fs.writeFileSync(path.join(tx.store.exportsDir, file), md);
    return { file, url: `/api/exports/${file}`, chars: md.length };
  },
});

def({
  name: 'push_player_wiki',
  description: 'Send the player wiki (or your own spoiler-safe `text`, e.g. a written recap) to the VTT as a text handout titled "Recap". reveal:true shows it to the players right now — only when the GM asked.',
  async: true,
  shape: { text: z.string().optional(), title: z.string().optional(), reveal: z.boolean().optional() },
  async run(tx, a) {
    const text = a.text?.trim() || wikiMarkdown(playerWiki(tx.state));
    await tx.store.vtt.push({ kind: 'handout', payload: { id: 'player-recap', title: a.title?.trim() || 'Recap', kind: 'text', text, reveal: a.reveal } });
    return { pushed: 'handout', title: a.title?.trim() || 'Recap', revealed: !!a.reveal, chars: text.length };
  },
});

def({
  name: 'advance_clock',
  description: 'Advance (or set) a progress clock node (type "clock": fields segments, filled, consequence). When it fills, the node becomes active and its consequence is due. Use `by` for a delta (negative to roll back) or `set` for an absolute value.',
  shape: { nodeId: z.string(), by: z.number().int().optional(), set: z.number().int().optional() },
  run(tx, a) {
    const n = tx.requireNode(a.nodeId);
    if (n.type !== 'clock') throw new Error(`“${n.title}” is a ${n.type}, not a clock`);
    const c = clockOf(n);
    const filled = Math.max(0, Math.min(c.segments, a.set ?? c.filled + (a.by ?? 1)));
    const nowFull = filled >= c.segments;
    tx.putNode({ ...n, status: nowFull && !c.full ? 'active' : n.status, fields: { ...n.fields, segments: c.segments, filled }, updatedAt: now() });
    tx.label = `Clock “${n.title}” ${filled}/${c.segments}${nowFull ? ' — FULL' : ''}`;
    return { id: n.id, filled, segments: c.segments, full: nowFull, consequence: c.consequence };
  },
});

def({
  name: 'get_party',
  description:
    'The players\' characters, as synced from the VTT and saved with the campaign (available even when the VTT is not running): name, player, group (when the party has split), whether they are in the VTT right now, and each sheet in the game\'s own fields. Use it to tailor encounters, hooks and handouts to the party — and never reveal one player\'s private information to another.',
  readOnly: true,
  shape: {},
  run(tx) {
    return Object.values(tx.state.nodes).filter((n) => n.type === 'pc' && !n.trashed).map((n) => ({
      id: n.id, name: n.title, player: n.fields.playerName ?? null, group: n.fields.group ?? null, inVtt: n.fields.present !== false, online: n.fields.online === true,
      lastChanged: n.fields.syncedAt ?? null, sheet: n.fields.sheet ?? {}, gmNotes: [n.summary, n.body].filter((x) => x.trim() && !x.startsWith('Played by')).join('\n\n') || undefined,
    }));
  },
});

def({
  name: 'sync_party',
  description: 'Fetch the players\' characters from the connected VTT right now and update their nodes (this also happens automatically on connect and whenever the VTT reports a change).',
  async: true,
  shape: {},
  async run(tx) {
    const list = await tx.store.vtt.fetchParty();
    return { characters: list.map((c) => c.name) };
  },
});

def({
  name: 'set_party_group',
  description: 'Say which part of the party each player character is in when the party splits up (the group names match mark_played\'s `group`). group "" puts them back into the main party.',
  shape: { nodeIds: z.array(z.string()).min(1), group: z.string() },
  run(tx, a) {
    for (const id of a.nodeIds) {
      const n = tx.requireNode(id);
      if (n.type !== 'pc') throw new Error(`“${n.title}” is not a player character`);
      const fields = { ...n.fields };
      if (a.group.trim()) fields.group = a.group.trim().slice(0, 40);
      else delete fields.group;
      tx.putNode({ ...n, fields, updatedAt: now() });
    }
    tx.label = a.group.trim() ? `Moved ${a.nodeIds.length} character(s) to group “${a.group.trim()}”` : `Rejoined ${a.nodeIds.length} character(s) to the party`;
    return { group: a.group.trim() || null, moved: a.nodeIds.length };
  },
});

// ------------------------------- misc --------------------------------------

def({
  name: 'create_canvas',
  description: 'Create an additional canvas (e.g. one per act or chapter).',
  shape: { name: z.string().min(1), id: z.string().optional() },
  run(tx, a) {
    const id = a.id || a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'canvas';
    if (tx.state.graph.canvases.some((c) => c.id === id)) throw new Error(`Canvas "${id}" exists`);
    tx.putCanvas({ id, name: a.name });
    tx.label = `Created canvas “${a.name}”`;
    return { id };
  },
});

// ------------------------------- frames ---------------------------------------
// A frame is a labelled coloured area behind a group of nodes on a canvas (an act, a chapter, "the harbour").
const FRAME_COLORS = ['#7aa2ff', '#7fe0a0', '#ffb454', '#ff7a9c', '#b89cff', '#5fd4c4', '#ffd166'];
const FRAME_PAD = 40;
const NODE_W_ = 280;
const NODE_H_ = 92;
const inFrame = (f: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }) => {
  const cx = p.x + NODE_W_ / 2, cy = p.y + NODE_H_ / 2;
  return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h;
};

def({
  name: 'create_frame',
  description:
    'Draw a labelled, coloured frame behind a group of nodes on a canvas — an act, a chapter, a district ("The harbour"). Give `nodeIds` to fit the frame around those placed nodes, or x/y/w/h (canvas pixels; a node card is about 280×92). Nodes inside a frame move with it when the GM drags it. Use it to organise a large canvas.',
  shape: {
    title: z.string().min(1).max(60),
    nodeIds: z.array(z.string()).optional(),
    canvas: z.string().optional(),
    x: z.number().optional(), y: z.number().optional(), w: z.number().min(120).optional(), h: z.number().min(80).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    id: z.string().optional(),
  },
  run(tx, a) {
    let canvas = a.canvas ?? tx.state.graph.canvases[0].id;
    let box: { x: number; y: number; w: number; h: number };
    if (a.nodeIds?.length) {
      const ps = a.nodeIds.map((id) => ({ id, p: tx.state.graph.placements[id] })).map((x) => {
        if (!x.p) throw new Error(`“${tx.requireNode(x.id).title}” is in the pool — place it on the canvas first.`);
        return x.p;
      });
      canvas = ps[0].canvas;
      const x0 = Math.min(...ps.map((p) => p.x)) - FRAME_PAD, y0 = Math.min(...ps.map((p) => p.y)) - FRAME_PAD - 24;
      box = { x: x0, y: y0, w: Math.max(...ps.map((p) => p.x)) + NODE_W_ + FRAME_PAD - x0, h: Math.max(...ps.map((p) => p.y)) + NODE_H_ + FRAME_PAD - y0 };
    } else box = { x: a.x ?? 0, y: a.y ?? 0, w: a.w ?? 640, h: a.h ?? 380 };
    if (!tx.state.graph.canvases.some((c) => c.id === canvas)) throw new Error(`No canvas "${canvas}"`);
    const base = slugify(a.id || a.title) || 'frame';
    let id = `frame-${base}`;
    for (let i = 2; tx.state.graph.frames.some((f) => f.id === id); i++) id = `frame-${base}-${i}`;
    tx.putFrame({ id, canvas, title: a.title.trim(), ...box, color: a.color ?? FRAME_COLORS[tx.state.graph.frames.length % FRAME_COLORS.length] });
    tx.label = `Framed “${a.title.trim()}”`;
    return { id, ...box };
  },
});

def({
  name: 'update_frame',
  description: 'Rename, recolour, resize or move a frame (this does NOT move the nodes inside it — use move_frame for that).',
  shape: {
    id: z.string(), title: z.string().min(1).max(60).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    x: z.number().optional(), y: z.number().optional(), w: z.number().min(120).optional(), h: z.number().min(80).optional(),
  },
  run(tx, a) {
    const f = tx.state.graph.frames.find((x) => x.id === a.id);
    if (!f) throw new Error(`No frame "${a.id}"`);
    const { id: _id, ...patch } = a;
    tx.putFrame({ ...f, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
    tx.label = patch.title && patch.title !== f.title ? `Renamed the frame “${f.title}” → “${patch.title}”` : `Changed the frame “${f.title}”`;
    return { id: f.id };
  },
});

def({
  name: 'move_frame',
  description: 'Move a frame by dx,dy canvas pixels TOGETHER with the nodes inside it (a node is inside when its centre is).',
  shape: { id: z.string(), dx: z.number(), dy: z.number() },
  run(tx, a) {
    const f = tx.state.graph.frames.find((x) => x.id === a.id);
    if (!f) throw new Error(`No frame "${a.id}"`);
    const inside = Object.entries(tx.state.graph.placements).filter(([, p]) => p.canvas === f.canvas && inFrame(f, p));
    for (const [id, p] of inside) tx.setPlacement(id, { ...p, x: Math.round(p.x + a.dx), y: Math.round(p.y + a.dy) });
    tx.putFrame({ ...f, x: Math.round(f.x + a.dx), y: Math.round(f.y + a.dy) });
    tx.label = `Moved the frame “${f.title}” with ${inside.length} node${inside.length === 1 ? '' : 's'}`;
    return { id: f.id, moved: inside.map(([id]) => id) };
  },
});

def({
  name: 'delete_frame',
  description: 'Remove a frame (the nodes inside stay where they are).',
  shape: { id: z.string() },
  run(tx, a) {
    const f = tx.state.graph.frames.find((x) => x.id === a.id);
    if (!f) throw new Error(`No frame "${a.id}"`);
    tx.removeFrame(f.id);
    tx.label = `Removed the frame “${f.title}”`;
    return { id: f.id };
  },
});

def({
  name: 'annotate',
  description:
    'Pin an annotation (sticky note) to a node, e.g. what actually happened at the table. Creates an annotation node next to the target, linked with belongs-to.',
  shape: { targetId: z.string(), text: z.string().min(1), title: z.string().optional() },
  run(tx, a) {
    const target = tx.requireNode(a.targetId);
    const id = tx.newNodeId(a.title ?? 'note');
    const t = now();
    tx.putNode({
      id, type: 'annotation', title: a.title ?? 'Note', summary: a.text.slice(0, 140), body: a.text, readAloud: '',
      tags: [], status: 'untouched', fields: {}, images: [], poolHint: '', trashed: false, createdAt: t, updatedAt: t,
    });
    const placed = tx.state.graph.placements[a.targetId];
    if (placed) {
      const pos = freeSpot(tx, placed.canvas, a.targetId);
      tx.setPlacement(id, { canvas: placed.canvas, ...pos });
    }
    link(tx, id, a.targetId, 'belongs-to', '');
    tx.label = `Annotated ${describe(target)}`;
    return { id };
  },
});

def({
  name: 'batch',
  description:
    'Run several of the graph-changing commands as ONE undo step. ops: [{command, args}]. Use it for compound edits (e.g. create + link + place). Give new nodes an explicit `id` so later ops in the same batch can reference them.',
  shape: {
    ops: z.array(z.object({ command: z.string(), args: z.record(z.unknown()).optional() })).min(1),
    label: z.string().optional(),
  },
  run(tx, a) {
    const results: unknown[] = [];
    const labels: string[] = [];
    for (const op of a.ops) {
      if (op.command === 'batch') throw new Error('batch cannot be nested');
      const c = commands.find((x) => x.name === op.command);
      if (!c) throw new Error(`Unknown command "${op.command}"`);
      if (c.async) throw new Error(`"${op.command}" talks to an external service and cannot be part of a batch`);
      tx.label = '';
      results.push(c.run(tx, z.object(c.shape).parse(op.args ?? {})));
      if (tx.label) labels.push(tx.label);
    }
    tx.label = a.label ?? (labels.length > 1 ? `${labels[0]} (+${labels.length - 1} more)` : labels[0] ?? 'Batch');
    return results;
  },
});

// ---------------------------------------------------------------------------

export function listCommands() {
  return commands;
}

/** What the AI may call (the GM-only commands are left out). */
export const aiCommands = () => commands.filter((c) => !c.internal);

export function runCommand(store: Store, name: string, rawArgs: unknown, actor: Actor): unknown {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`Unknown command "${name}"`);
  if (c.internal && (actor === 'claude' || actor === 'agy')) throw new Error(`"${name}" is for the GM only.`);
  const args = z.object(c.shape).parse(rawArgs ?? {});
  return store.transact(actor, c.description.slice(0, 40), (tx) => c.run(tx, args));
}
