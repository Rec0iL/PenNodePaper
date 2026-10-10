import type { MapDoc } from './mapdata.js';

// Shared domain types for PenNodePaper (server, web, MCP all speak this).

export const NODE_TYPES = [
  // story
  'scene', 'encounter', 'event', 'clue', 'decision',
  // world
  'pc', 'npc', 'enemy', 'location', 'faction', 'item', 'lore',
  // play helpers
  'handout', 'annotation', 'clock', 'table',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const NODE_STATUSES = ['untouched', 'active', 'done', 'skipped'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const EDGE_KINDS = [
  'leads-to', 'conditional', 'reveals', 'belongs-to', 'foreshadows', 'bridge',
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export type Actor = 'user' | 'claude' | 'agy' | 'system';

export interface StoryNode {
  id: string;
  type: NodeType;
  title: string;
  summary: string;
  /** Markdown body: GM-facing notes. */
  body: string;
  /** Text meant to be read aloud to the players. */
  readAloud: string;
  tags: string[];
  status: NodeStatus;
  /** Type-specific custom fields (e.g. NPC tier, clock segments). */
  fields: Record<string, unknown>;
  /** Image file names inside the campaign's images/ folder; first = cover. */
  images: string[];
  /** Pool nodes: when/where this might happen. */
  poolHint: string;
  trashed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoryEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label: string;
  /** The GM switched the played-path highlight off for this connection. */
  noTrail?: boolean;
  /** Where the GM dragged this connection's jump marker to, per canvas (canvas id → position); unset = placed automatically. */
  markers?: Record<string, { x: number; y: number }>;
}

export interface Placement {
  canvas: string;
  x: number;
  y: number;
}

/** The colours offered for frames (a frame's colour is any #rrggbb; the AI may pick any as well). */
export const FRAME_PALETTE = ['#7aa2ff', '#7fe0a0', '#ffb454', '#ff7a9c', '#b89cff', '#5fd4c4', '#ffd166', '#8b93a7'] as const;

export interface Canvas {
  id: string;
  name: string;
}

export interface Frame {
  id: string;
  canvas: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface GraphFile {
  version: 1;
  canvases: Canvas[];
  /** nodeId -> placement. A non-trashed node without placement lives in the pool. */
  placements: Record<string, Placement>;
  edges: StoryEdge[];
  frames: Frame[];
}

// --- images (ComfyUI) -------------------------------------------------------------

export interface ComfyConfig {
  url: string;
  /** Krea 2 turbo graph: separate UNET / CLIP / VAE loaders (as in KINETIK's rulebook-pdf). */
  unet: string;
  clip: string;
  clipType: string;
  vae: string;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

export const DEFAULT_COMFY: ComfyConfig = {
  url: 'http://127.0.0.1:8188',
  unet: 'krea2TurboOfficialComfy_krea2TurboInt8.safetensors',
  clip: 'qwen3vl_4b_fp8_scaled.safetensors',
  clipType: 'krea2',
  vae: 'qwen_image_vae.safetensors',
  steps: 8,
  cfg: 1,
  sampler: 'euler',
  scheduler: 'simple',
};

export interface StyleConfig {
  /** Appended to every image prompt (the campaign's look). */
  suffix: string;
  negative: string;
  /** Appended to map render prompts instead of `suffix` (maps need a plan view, not cinematic lighting). */
  mapSuffix: string;
}

export const DEFAULT_STYLE: StyleConfig = {
  suffix: 'painterly dark-fantasy illustration, moody cinematic lighting, rich detail, muted colour palette',
  negative: 'text, watermark, signature, blurry, low quality, deformed, extra fingers',
  mapSuffix: 'hand-painted tabletop RPG battle map, seen from directly above, orthographic top-down view, detailed textures, no characters, no text, no grid lines',
};

/** How battle maps are painted. quick = one img2img pass from the plan (props in the model input);
 *  staged = two steps: the empty terrain first (the GM accepts or regenerates), then every prop group inpainted into its place. */
export type MapPaintMode = 'quick' | 'staged';
export const MAP_PAINT_MODES: Record<MapPaintMode, { label: string; short: string }> = {
  quick: { label: 'Quick (1 step)', short: 'quick' },
  staged: { label: 'Precise (2 steps)', short: 'precise' },
};

export type ImageKind = 'portrait' | 'scene' | 'item' | 'handout' | 'banner' | 'square';

/** Sizes are multiples of 16 (latent grid). */
export const IMAGE_KINDS: Record<ImageKind, { label: string; w: number; h: number; hint: string }> = {
  portrait: { label: 'Portrait', w: 832, h: 1216, hint: 'character or creature, upper body, facing the viewer' },
  scene:    { label: 'Scene',    w: 1344, h: 768, hint: 'wide establishing shot of a place or moment' },
  item:     { label: 'Item',     w: 1024, h: 1024, hint: 'single object, centred, simple backdrop' },
  handout:  { label: 'Handout',  w: 1024, h: 1456, hint: 'in-world document or poster, portrait page' },
  banner:   { label: 'Banner',   w: 1600, h: 704, hint: 'ultra-wide header image' },
  square:   { label: 'Square',   w: 1024, h: 1024, hint: 'general purpose' },
};

export interface ImageJob {
  id: string;
  nodeId: string;
  kind: ImageKind | 'map';
  prompt: string;
  seed: number;
  w: number;
  h: number;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  progress: number;
  /** what a long multi-image job is doing right now, e.g. "Painting props 7/19" */
  phase?: string;
  file?: string;
  error?: string;
  actor: Actor;
  at: string;
}

export interface CampaignMeta {
  name: string;
  language: string;
  createdAt: string;
  comfy?: Partial<ComfyConfig>;
  style?: Partial<StyleConfig>;
  backup?: Partial<BackupSettings>;
  /** live = AI edits stand until you undo them; review = they wait for your Accept / Reject after the AI is done */
  aiMode?: 'live' | 'review';
  /** how much the AI adds on its own initiative (1 = exactly what was asked … 5 = inventive); see AI_CREATIVITY. Default 3. */
  aiCreativity?: AiCreativity;
  /** A practice campaign for the welcome tour: its AI and image maker are scripted stand-ins (nothing needs to be set up) until the tour is left. */
  tutorial?: { on: boolean };
}

export type AiCreativity = 1 | 2 | 3 | 4 | 5;
export const AI_CREATIVITY: { level: AiCreativity; name: string; hint: string }[] = [
  { level: 1, name: 'exact', hint: 'Does exactly what you asked and nothing more.' },
  { level: 2, name: 'exact + idea', hint: 'Does exactly what you asked, then suggests one creative idea in its summary — answer “yes” to have it done.' },
  { level: 3, name: 'balanced', hint: 'Moderately creative: fills in sensible detail and small supporting pieces.' },
  { level: 4, name: 'balanced + ideas', hint: 'Like balanced, and also offers several creative ideas in its summary to pick from.' },
  { level: 5, name: 'inventive', hint: 'Takes initiative: adds supporting nodes, complications and foreshadowing on its own (additions only), and pitches bolder ideas.' },
];

/** Safety copies of the campaign folder (see server/src/backup.ts). */
export interface BackupSettings {
  /** take snapshots by itself while you work (only when something changed) */
  auto: boolean;
  everyMinutes: number;
  /** how many automatic snapshots to keep (manual ones are never removed automatically) */
  keepAuto: number;
  /** a folder (e.g. inside Dropbox / Syncthing) that every snapshot is also copied to */
  mirrorDir: string;
  /** also commit the campaign to a local git repository on every snapshot */
  git: boolean;
}

export const BACKUP_DEFAULTS: BackupSettings = { auto: true, everyMinutes: 30, keepAuto: 20, mirrorDir: '', git: false };

export interface SnapshotInfo {
  id: string;
  createdAt: string;
  kind: 'auto' | 'manual' | 'pre-restore';
  label: string;
  bytes: number;
  /** false = light snapshot (text, graph, maps, books); images are not in it and stay as they are on restore */
  withImages: boolean;
}

export interface CampaignState {
  meta: CampaignMeta;
  nodes: Record<string, StoryNode>;
  graph: GraphFile;
}

/** Visual identity per node type (shared so the AI can reason about it too). */
export const NODE_TYPE_INFO: Record<NodeType, { label: string; group: 'story' | 'world' | 'helper'; color: string; icon: string }> = {
  scene:      { label: 'Scene',       group: 'story',  color: '#7aa2ff', icon: '◈' },
  encounter:  { label: 'Encounter',   group: 'story',  color: '#ff7a7a', icon: '⚔' },
  event:      { label: 'Event',       group: 'story',  color: '#ffb454', icon: '⚡' },
  clue:       { label: 'Clue/Secret', group: 'story',  color: '#b89cff', icon: '◉' },
  decision:   { label: 'Decision',    group: 'story',  color: '#5fd4c4', icon: '⑂' },
  pc:         { label: 'Player character', group: 'world', color: '#5fb8ff', icon: '♞' },
  npc:        { label: 'NPC',         group: 'world',  color: '#f2a1c8', icon: '☺' },
  enemy:      { label: 'Enemy',       group: 'story',  color: '#ff5d73', icon: '☠' },
  location:   { label: 'Location',    group: 'world',  color: '#8fd36b', icon: '⌂' },
  faction:    { label: 'Faction',     group: 'world',  color: '#e0c36a', icon: '⚑' },
  item:       { label: 'Item',        group: 'world',  color: '#6ac0e0', icon: '✦' },
  lore:       { label: 'Lore',        group: 'world',  color: '#a3a8b8', icon: '❡' },
  handout:    { label: 'Handout',     group: 'helper', color: '#e8d9a8', icon: '✉' },
  annotation: { label: 'Annotation',  group: 'helper', color: '#ffe066', icon: '✎' },
  clock:      { label: 'Clock',       group: 'helper', color: '#ff9966', icon: '◔' },
  table:      { label: 'Random table',group: 'helper', color: '#9ad0ff', icon: '⚄' },
};

export const EDGE_KIND_INFO: Record<EdgeKind, { label: string; color: string; dash?: string; help: string }> = {
  'leads-to': {
    label: 'leads to', color: '#8b93a7',
    help: 'Story flow: from here the players can go on to there — one scene, place or beat following another.',
  },
  conditional: {
    label: 'if …', color: '#ffb454', dash: '6 4',
    help: 'Only if something happens: write the condition on the label (e.g. “if they search the docks”).',
  },
  reveals: {
    label: 'reveals', color: '#b89cff', dash: '2 4',
    help: 'Finding this gives away that: a clue that points to a place, an NPC who exposes a secret.',
  },
  'belongs-to': {
    label: 'belongs to', color: '#5fd4c4', dash: '10 3 2 3',
    help: 'Membership or location: an NPC who is in a place, an item that belongs to someone, a faction that holds a site.',
  },
  foreshadows: {
    label: 'foreshadows', color: '#ff7a9c', dash: '1 5',
    help: 'A hint that this will matter later: a rumour, omen or detail that pays off at the target.',
  },
  bridge: {
    label: 'bridge', color: '#7fe0a0', dash: '8 4',
    help: 'A way back onto the main story, added when off-script players are guided to rejoin it.',
  },
};

// ---------------------------------------------------------------------------
// Change events (drive the animations in the UI and the activity timeline)
// ---------------------------------------------------------------------------

export interface FieldDiff {
  field: string;
  from: unknown;
  to: unknown;
}

export type ChangeEvent =
  | { type: 'node.created'; node: StoryNode; placement: Placement | null }
  | { type: 'node.updated'; id: string; diffs: FieldDiff[] }
  | { type: 'node.trashed'; id: string }
  | { type: 'node.restored'; id: string; placement: Placement | null }
  | { type: 'node.placed'; id: string; from: 'pool'; placement: Placement }
  | { type: 'node.pooled'; id: string; from: Placement }
  | { type: 'node.moved'; id: string; from: Placement; to: Placement }
  | { type: 'edge.created'; edge: StoryEdge }
  | { type: 'edge.updated'; edge: StoryEdge; before: StoryEdge }
  | { type: 'edge.rewired'; edge: StoryEdge; before: StoryEdge }
  | { type: 'edge.deleted'; edge: StoryEdge }
  /** canvases or frames changed (the full lists, so the view just replaces them) */
  | { type: 'graph.meta'; canvases: Canvas[]; frames: Frame[] }
  | { type: 'graph.reloaded' };

/** AI changes the GM has not accepted yet (review mode). They are already applied — Reject takes them back. */
export interface Proposal {
  id: string;
  actor: Actor;
  at: string;
  /** what the GM asked (first words of the chat message) */
  title: string;
  steps: string[];
  nodes: string[];
  edges: string[];
  /** nodes the AI created in this proposal */
  newNodes: string[];
  linked: number;
}

export interface Batch {
  id: string;
  seq: number;
  at: string;
  actor: Actor;
  label: string;
  /** Review mode: the AI turn this change belongs to (see Proposal). */
  proposal?: string;
  /** Present when this batch is the undo/redo of another one. */
  undoOf?: string;
  events: ChangeEvent[];
}

// ---------------------------------------------------------------------------
// WebSocket protocol between server and web UI
// ---------------------------------------------------------------------------

export type Backend = 'claude' | 'agy';

export interface ChatMsg {
  id: string;
  at: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  backend: Backend;
  text: string;
  /** Set when the message belongs to a per-node thread. */
  nodeId?: string;
  /** Tool-call cards. */
  tool?: { name: string; summary: string; status: 'running' | 'ok' | 'error' };
  streaming?: boolean;
  /** Written by the welcome tour's scripted stand-in, not by a real AI. */
  demo?: boolean;
}

export interface ChatStatus {
  busy: boolean;
  backend?: Backend;
  nodeId?: string;
  demo?: boolean;
}

export type ServerMsg =
  | { t: 'hello'; state: CampaignState; history: Batch[]; canUndo: boolean; canRedo: boolean; chat: ChatMsg[]; chatStatus: ChatStatus; jobs: ImageJob[]; vtt: import('./vtt.js').VttStatus; proposals: Proposal[]; /** a different campaign was opened: reset the view */ switched?: boolean }
  | { t: 'chat'; msg: ChatMsg }
  | { t: 'chat.status'; status: ChatStatus }
  | { t: 'proposals'; list: Proposal[] }
  | { t: 'image.job'; job: ImageJob }
  | { t: 'map'; map: MapDoc; actor: Actor }
  /** the AI asks the GM's view to show a canvas (and a node on it); ignored when the GM turned "follow the AI" off */
  | { t: 'view'; canvas: string; nodeId?: string; actor: Actor }
  | { t: 'vtt'; status: import('./vtt.js').VttStatus }
  | { t: 'batch'; batch: Batch; canUndo: boolean; canRedo: boolean }
  | { t: 'reload'; state: CampaignState }
  | { t: 'presence'; actor: Actor; nodeId: string | null; note?: string };

export interface CommandResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'node';
}

export * from './mapdata.js';
export * from './maps.js';
export * from './mapgroups.js';
export * from './vtt.js';
export * from './sheet.js';
export * from './story.js';
export * from './wiki.js';
export * from './tables.js';
export * from './search.js';
export * from './sounds.js';
export * from './tutorial.js';
