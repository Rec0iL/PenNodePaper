import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import {
  BRIDGE_PROTOCOL, imageSize, renderSvg, pickRole, validateSheet,
  type BridgeFromVtt, type BridgeToVtt, type StoryNode, type CharacterRole, type UpfCharacter, type UpfHandout, type UpfImage, type UpfPush, type UpfScene,
  type UpfTrack, type VttProfile, type VttStatus,
} from '@pnp/shared';
import { toPng } from './maps.js';
import type { Store } from './store.js';

// ---------------------------------------------------------------------------
// VTT bridge: a VTT's GM page connects to /bridge, announces its capability
// profile (cached to vtts/<id>.vtt.json for offline use), and then accepts UPF
// pushes. Everything pushable is one fixed format (UPF); VTTs adapt to it.
// ---------------------------------------------------------------------------

export class VttHub {
  private ws: WebSocket | null = null;
  private profile: VttProfile | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private listeners = new Set<(s: VttStatus) => void>();
  /** Called with the full party whenever the VTT reports it (on connect, on request, or by itself when it changes). */
  onParty?: (profile: VttProfile, characters: UpfCharacter[]) => void;

  constructor(private dir: string, private campaign: () => string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Drop the live connection (the VTT reconnects by itself — used when another campaign is opened). */
  disconnect() {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Campaign changed')); }
    this.pending.clear();
    try { this.ws?.close(1001, 'campaign changed'); } catch { /* already gone */ }
    this.ws = null;
  }

  onStatus(fn: (s: VttStatus) => void) {
    this.listeners.add(fn);
  }

  /** Cached profiles, most recently connected first. */
  cachedProfiles(): VttProfile[] {
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dir);
    } catch {
      return []; // folder not there (yet / any more)
    }
    return files
      .filter((f) => f.endsWith('.vtt.json'))
      .flatMap((f) => {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as { profile: VttProfile; seenAt?: string };
          return [{ profile: j.profile, seenAt: j.seenAt ?? '' }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.seenAt.localeCompare(a.seenAt))
      .map((x) => x.profile);
  }

  status(): VttStatus {
    const cached = this.cachedProfiles();
    if (this.ws && this.profile) return { connected: true, profile: this.profile, source: 'live', cached };
    const last = cached[0] ?? null; // most recently written first (see cache())
    return { connected: false, profile: last, source: last ? 'cached' : 'none', cached };
  }

  private emit() {
    const s = this.status();
    for (const l of this.listeners) l(s);
  }

  private cache(profile: VttProfile) {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, `${profile.id.replace(/[^a-z0-9_-]/gi, '_')}.vtt.json`);
    fs.writeFileSync(file, JSON.stringify({ profile, seenAt: new Date().toISOString() }, null, 2));
  }

  /** Called for every accepted bridge websocket. */
  accept(ws: WebSocket) {
    ws.on('message', (data) => {
      let m: BridgeFromVtt;
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      if (m.t === 'hello') {
        if (m.protocol !== BRIDGE_PROTOCOL) {
          ws.close(1008, `unsupported bridge protocol ${m.protocol} (this app speaks ${BRIDGE_PROTOCOL})`);
          return;
        }
        if (this.ws && this.ws !== ws) this.ws.close(1000, 'replaced by a newer connection');
        this.ws = ws;
        this.profile = m.profile;
        this.cache(m.profile);
        this.send(ws, { t: 'welcome', protocol: BRIDGE_PROTOCOL, app: 'pennodepaper', campaign: this.campaign() });
        this.emit();
        if (m.profile.provides?.party) void this.fetchParty().catch(() => {}); // pick up the players' characters right away
      } else if (m.t === 'party') {
        if (this.ws === ws && this.profile && Array.isArray(m.characters)) this.onParty?.(this.profile, m.characters);
      } else if (m.t === 'result') {
        const p = this.pending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        if (m.ok) p.resolve(m.data);
        else p.reject(new Error(m.error || 'The VTT refused the request'));
      }
    });
    ws.on('close', () => {
      if (this.ws === ws) {
        this.ws = null;
        this.profile = null;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('The VTT disconnected'));
          this.pending.delete(id);
        }
        this.emit();
      }
    });
    ws.on('error', () => {});
  }

  private send(ws: WebSocket, msg: BridgeToVtt) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private call<T>(build: (id: string) => BridgeToVtt, timeoutMs = 15000): Promise<T> {
    const ws = this.ws;
    if (!ws || !this.profile) return Promise.reject(new Error('No VTT is connected. Open the VTT’s GM page and enable the PenNodePaper link.'));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The VTT did not answer in time.'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send(ws, build(id));
    });
  }

  push(p: UpfPush): Promise<unknown> {
    const prof = this.profile;
    if (prof && !(p.kind in prof.push)) return Promise.reject(new Error(`${prof.name} can't receive "${p.kind}" pushes (see get_vtt_capabilities).`));
    return this.call((id) => ({ t: 'push', id, ...p }));
  }

  /** Ask the VTT for its players' characters now (re-sync). */
  async fetchParty(): Promise<UpfCharacter[]> {
    if (!this.profile?.provides?.party) throw new Error(`${this.profile?.name ?? 'The VTT'} doesn't report its players' characters.`);
    const chars = (await this.call<UpfCharacter[]>((id) => ({ t: 'request', id, what: 'party' }))) ?? [];
    this.onParty?.(this.profile, chars);
    return chars;
  }

  async tracks(): Promise<UpfTrack[]> {
    if (this.profile && !this.profile.requests?.includes('tracks')) throw new Error(`${this.profile.name} doesn't expose its track list.`);
    return (await this.call<UpfTrack[]>((id) => ({ t: 'request', id, what: 'tracks' }))) ?? [];
  }
}

// ------------------------------- UPF builders ------------------------------------------

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export function readImage(dir: string, file: string): UpfImage {
  const p = path.join(dir, path.basename(file));
  if (!fs.existsSync(p)) throw new Error(`Image file "${file}" not found`);
  return { name: path.basename(file), mime: MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', b64: fs.readFileSync(p).toString('base64') };
}

const node = (store: Store, id: string): StoryNode => {
  const n = store.state.nodes[id];
  if (!n || n.trashed) throw new Error(`Node "${id}" not found`);
  return n;
};

/** Width/height of a PNG, JPEG or WebP file (enough header parsing, no dependency). */
export function imageDimensions(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const k = buf.toString('ascii', 12, 16);
    if (k === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (k === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
    if (k === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/** Map render files of a node (they are listed among its images, but are not illustrations). */
function renderFiles(store: Store, n: StoryNode): Set<string> {
  const id = typeof n.fields.mapId === 'string' ? n.fields.mapId : '';
  if (!id) return new Set();
  try { return new Set(store.maps.get(id).renders); } catch { return new Set(); }
}

/** The images of a node that are pictures (not painted map renders) — what can be shown as a handout or backdrop. */
export function illustrationsOf(store: Store, n: StoryNode): string[] {
  const maps = renderFiles(store, n);
  return n.images.filter((f) => !maps.has(f));
}

/** Player-facing: an image of the node (default: its cover illustration), else the read-aloud text (or summary). GM notes are never sent. */
export function handoutFromNode(store: Store, imagesDir: string, nodeId: string, opts: { to?: string; reveal?: boolean; image?: string } = {}): UpfHandout {
  const { to, reveal } = opts;
  const n = node(store, nodeId);
  const text = (n.readAloud.trim() || n.summary.trim() || '').trim();
  if (opts.image && !n.images.includes(opts.image)) throw new Error(`“${n.title}” has no image "${opts.image}". Images: ${n.images.join(', ') || '(none)'}`);
  const file = opts.image ?? illustrationsOf(store, n)[0] ?? n.images[0];
  if (file) return { id: opts.image ? `${n.id}:${file}` : n.id, title: n.title, kind: 'image', image: readImage(imagesDir, file), text: text || undefined, to, reveal };
  if (!text) throw new Error(`“${n.title}” has no read-aloud text, summary or image to hand out.`);
  return { id: n.id, title: n.title, kind: 'text', text, to, reveal };
}

/** Player start markers are only sent when the VTT asks for them (profile.push.scene.playerStarts) or the caller insists. */
export const wantsPlayerStarts = (profile: VttProfile | null | undefined, force?: boolean) => force ?? profile?.push.scene?.playerStarts ?? false;

/** An illustration of a place shown on the map screen as a backdrop: no tokens, no visible grid. */
export function sceneFromImage(store: Store, imagesDir: string, nodeId: string, file: string | undefined, opts: { activate?: boolean } = {}): UpfScene {
  const n = node(store, nodeId);
  const f = file ?? illustrationsOf(store, n)[0] ?? n.images[0];
  if (!f) throw new Error(`“${n.title}” has no image to show.`);
  if (!n.images.includes(f)) throw new Error(`“${n.title}” has no image "${f}". Images: ${n.images.join(', ')}`);
  const image = readImage(imagesDir, f);
  const dim = imageDimensions(Buffer.from(image.b64, 'base64')) ?? { w: 1344, h: 768 };
  return {
    id: `${n.id}:${f}`, name: n.title, image, width: dim.w, height: dim.h,
    grid: { type: 'square', size: Math.max(16, Math.round(Math.min(dim.w, dim.h) / 20)), offsetX: 0, offsetY: 0, unitsPerCell: 1, unit: 'ft', hidden: true },
    tokens: [], activate: opts.activate,
  };
}

export function sceneFromMap(store: Store, imagesDir: string, mapId: string, opts: { image?: 'painted' | 'plan'; activate?: boolean; players?: boolean } = {}): UpfScene {
  const m = store.maps.get(mapId);
  const { w, h, cell } = imageSize(m);
  const want = opts.image ?? (m.renders.length ? 'painted' : 'plan');
  let image: UpfImage;
  if (want === 'painted') {
    const file = m.renders.at(-1);
    if (!file) throw new Error(`Map "${m.name}" has no painted render yet — render_map first, or push the plan image.`);
    image = readImage(imagesDir, file);
  } else {
    image = { name: `${m.id}-plan.png`, mime: 'image/png', b64: toPng(renderSvg(m, 'preview')).toString('base64') };
  }
  const size = cell || Math.round(Math.min(w, h) / 20);
  return {
    id: m.id,
    name: m.name,
    image, width: w, height: h,
    grid: { type: m.grid.type, size, offsetX: 0, offsetY: 0, unitsPerCell: m.grid.unit, unit: 'ft' },
    tokens: m.tokens.filter((t) => t.kind !== 'pc' || opts.players).map((t) => ({ x: t.x, y: t.y, kind: t.kind, label: t.label })),
    activate: opts.activate,
  };
}

/** A square, top-biased crop of an image at `max` px (faces stay in frame) — small enough to push and to store in a VTT. */
export function portraitImage(dir: string, file: string, max = 256): UpfImage {
  const src = readImage(dir, file);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${max}" height="${max}"><image href="data:${src.mime};base64,${src.b64}" width="${max}" height="${max}" preserveAspectRatio="xMidYMin slice"/></svg>`;
  return { name: `${path.basename(file, path.extname(file))}-portrait.png`, mime: 'image/png', b64: toPng(svg).toString('base64') };
}

const RESERVED_FIELDS = new Set(['role', 'preset', 'sheet', 'mapId']);

/** The sheet stored on a node. Nodes written before sheets existed keep loose fields (tier, level, …): treat those as the sheet. */
export function sheetOf(n: StoryNode): Record<string, unknown> {
  const s = n.fields.sheet;
  if (s && typeof s === 'object' && !Array.isArray(s)) return { ...(s as Record<string, unknown>) };
  return Object.fromEntries(Object.entries(n.fields).filter(([k]) => !RESERVED_FIELDS.has(k)));
}

/** Which of the VTT's roles describes this node. Throws with guidance the AI/GM can act on. */
export function roleFor(profile: VttProfile | null, n: StoryNode, explicit?: string): CharacterRole {
  if (!profile) throw new Error('No VTT profile is known yet — connect the VTT once so PenNodePaper can learn its character sheets.');
  const roles = profile.characters?.roles;
  if (!roles?.length) throw new Error(`${profile.name} hasn't described its characters (no sheet structure in its profile).`);
  const role = pickRole(roles, n.type, explicit ?? n.fields.role);
  if (explicit && role?.id !== explicit) throw new Error(`${profile.name} has no character role "${explicit}". Roles: ${roles.map((r) => r.id).join(', ')}.`);
  return role!;
}

export function characterFromNode(store: Store, imagesDir: string, nodeId: string, profile: VttProfile | null, roleId?: string): { character: UpfCharacter; warnings: string[] } {
  const n = node(store, nodeId);
  const role = roleFor(profile, n, roleId);
  const preset = typeof n.fields.preset === 'string' ? n.fields.preset : undefined;
  const check = validateSheet(role, sheetOf(n), { preset });
  if (check.errors.length) throw new Error(`“${n.title}” doesn't fit the ${profile!.name} "${role.label}" sheet: ${check.errors.join('; ')}`);
  return {
    warnings: check.warnings,
    character: {
      id: n.id, role: role.id, name: n.title, preset, sheet: check.sheet,
      notes: [n.summary, n.body].map((x) => x.trim()).filter(Boolean).join('\n\n') || undefined,
      portrait: role.portrait !== false && n.images[0] ? portraitImage(imagesDir, n.images[0]) : undefined,
    },
  };
}

// ------------------------------- file export ----------------------------------------------

export interface UpfBundle {
  upf: 1;
  app: 'pennodepaper';
  campaign: string;
  exportedAt: string;
  handouts: UpfHandout[];
  scenes: UpfScene[];
  characters: UpfCharacter[];
}

export function buildBundle(store: Store, imagesDir: string, sel: { handouts?: string[]; maps?: string[]; characters?: string[] }, profile?: VttProfile | null, opts: { includePlayers?: boolean } = {}): UpfBundle {
  return {
    upf: 1, app: 'pennodepaper', campaign: store.state.meta.name, exportedAt: new Date().toISOString(),
    handouts: (sel.handouts ?? []).map((id) => handoutFromNode(store, imagesDir, id)),
    scenes: (sel.maps ?? []).map((id) => sceneFromMap(store, imagesDir, id, { players: wantsPlayerStarts(profile, opts.includePlayers) })),
    characters: (sel.characters ?? []).map((id) => characterFromNode(store, imagesDir, id, profile ?? null).character),
  };
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** SHA-256 of the raw bytes, first 16 bytes as hex: the KINETIK VTT's asset hash. */
const kinetikHash = (b64: string) => createHash('sha256').update(Buffer.from(b64, 'base64')).digest().subarray(0, 16).toString('hex');

/**
 * A fresh, valid KINETIK VTT session file (load it on the GM start screen). The VTT's importer
 * replaces the whole session, so this is a *new* session containing the exported scenes and handouts.
 */
const KINETIK_TIERS = ['goon', 'schlaeger', 'elite', 'boss', 'nemesis'];
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** An "enemy" sheet (KINETIK's own field keys, as the VTT declares them) -> a combat NPC of the KINETIK VTT. */
function kinetikNpc(c: UpfCharacter) {
  const sh = c.sheet;
  const type = KINETIK_TIERS.includes(String(sh.tier)) ? String(sh.tier) : 'goon';
  const goon = type === 'goon';
  const schutz = goon ? 0 : num(sh.schutz, 0);
  const wk = goon ? 0 : num(sh.wk, 0);
  const energie = num(sh.energie, 6);
  return {
    id: c.id, name: c.name, type, level: num(sh.level, 0), bonus: num(sh.bonus, 0),
    schutz, schutzMax: schutz, wk, wkMax: wk, energie, energieMax: energie, injuries: {},
    count: goon ? Math.max(1, num(sh.count, 1)) : 1, hits: 0,
    tags: Array.isArray(sh.tags) ? sh.tags.map(String) : [], note: String(sh.note ?? '').replace(/\s*\n+\s*/g, ' — ').slice(0, 400),
    hidden: false, poisons: [],
    moves: Array.isArray(sh.moves) ? sh.moves : [], src: `pnp:${c.id}`,
    img: c.portrait ? `data:${c.portrait.mime};base64,${c.portrait.b64}` : undefined,
  };
}

export function kinetikSession(b: UpfBundle) {
  const assets: Record<string, { name: string; mime: string; b64: string }> = {};
  const add = (img: UpfImage) => {
    const h = kinetikHash(img.b64);
    assets[h] = { name: img.name, mime: img.mime, b64: img.b64 };
    return h;
  };
  const uid = () => randomBytes(5).toString('hex');
  const scenes = b.scenes.map((s) => ({
    id: s.id, name: s.name, asset: add(s.image), width: s.width, height: s.height, rev: 1,
    grid: { show: true, size: s.grid.size, ox: s.grid.offsetX, oy: s.grid.offsetY, color: '#00e5ff', opacity: 0.35, unit: s.grid.unit, unitsPerCell: s.grid.unitsPerCell },
    fog: { enabled: false, ops: [] },
    tokens: s.tokens.map((t) => ({
      id: uid(), name: t.label ?? (t.kind === 'pc' ? 'Spieler' : 'Gegner'),
      x: Math.round((t.x + 0.5) * s.grid.size), y: Math.round((t.y + 0.5) * s.grid.size), size: 1,
      color: { pc: '#00e5ff', npc: '#3ddc97', enemy: '#ff4d6d' }[t.kind], kind: t.kind === 'pc' ? 'pc' : 'npc', hidden: false,
    })),
  }));
  const handouts = b.handouts.map((h) => ({ id: h.id, title: h.title, kind: h.kind, ...(h.kind === 'image' && h.image ? { hash: add(h.image) } : { text: h.text ?? '' }), ts: Date.now() }));
  return {
    kinetik: 'session', version: 1, exportedAt: new Date().toISOString(),
    session: {
      code: Array.from(randomBytes(6), (x) => ROOM_ALPHABET[x % ROOM_ALPHABET.length]).join(''),
      password: '', players: [], gmNotes: `Exported from PenNodePaper: ${b.campaign}`, created: Date.now(),
      scenes, activeScene: scenes[0]?.id ?? null, tracks: [], handouts,
      combat: { npcs: b.characters.filter((c) => c.role === 'enemy').map(kinetikNpc) },
      state: { gmName: '', visibility: 'party', notes: '', rounds: 0, music: {}, combat: null },
    },
    assets,
  };
}
