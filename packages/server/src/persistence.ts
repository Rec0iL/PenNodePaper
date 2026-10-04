import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { CampaignMeta, CampaignState, GraphFile, StoryNode } from '@pnp/shared';
import { NODE_STATUSES, NODE_TYPES } from '@pnp/shared';

const READ_ALOUD_MARK = '<!-- read-aloud -->';

const hash = (s: string) => createHash('sha1').update(s).digest('hex');

export function emptyGraph(): GraphFile {
  return {
    version: 1,
    canvases: [{ id: 'main', name: 'Main story' }],
    placements: {},
    edges: [],
    frames: [],
  };
}

export function serializeNode(n: StoryNode): string {
  const fm = {
    id: n.id,
    type: n.type,
    title: n.title,
    summary: n.summary,
    status: n.status,
    tags: n.tags,
    poolHint: n.poolHint || undefined,
    fields: Object.keys(n.fields).length ? n.fields : undefined,
    images: n.images.length ? n.images : undefined,
    trashed: n.trashed || undefined,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
  let out = `---\n${YAML.stringify(fm).trimEnd()}\n---\n\n${n.body.trim()}\n`;
  if (n.readAloud.trim()) out += `\n${READ_ALOUD_MARK}\n${n.readAloud.trim()}\n`;
  return out;
}

export function parseNode(raw: string, fallbackId: string): StoryNode | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  let fm: Record<string, unknown>;
  try {
    fm = (YAML.parse(m[1]) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rest = m[2];
  const idx = rest.indexOf(READ_ALOUD_MARK);
  const body = (idx >= 0 ? rest.slice(0, idx) : rest).trim();
  const readAloud = idx >= 0 ? rest.slice(idx + READ_ALOUD_MARK.length).trim() : '';
  // older campaigns had a separate "map" node type: a map is now an attachment of a location
  const type = fm.type === 'map' ? 'location' : NODE_TYPES.includes(fm.type as never) ? (fm.type as StoryNode['type']) : 'scene';
  const status = NODE_STATUSES.includes(fm.status as never) ? (fm.status as StoryNode['status']) : 'untouched';
  const now = new Date().toISOString();
  return {
    id: typeof fm.id === 'string' && fm.id ? fm.id : fallbackId,
    type,
    title: String(fm.title ?? fallbackId),
    summary: String(fm.summary ?? ''),
    body,
    readAloud,
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    status,
    fields: fm.fields && typeof fm.fields === 'object' ? (fm.fields as Record<string, unknown>) : {},
    images: Array.isArray(fm.images) ? fm.images.map(String) : [],
    poolHint: String(fm.poolHint ?? ''),
    trashed: fm.trashed === true,
    createdAt: String(fm.createdAt ?? now),
    updatedAt: String(fm.updatedAt ?? now),
  };
}

export class Persistence {
  /** path -> content hash of what *we* last wrote (to ignore our own watcher events). */
  private selfWrites = new Map<string, string>();

  constructor(readonly dir: string) {
    fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });
  }

  get nodesDir() {
    return path.join(this.dir, 'nodes');
  }
  get graphPath() {
    return path.join(this.dir, 'graph.json');
  }
  get metaPath() {
    return path.join(this.dir, 'campaign.json');
  }
  nodePath(id: string) {
    return path.join(this.nodesDir, `${id}.md`);
  }

  load(): CampaignState {
    let meta: CampaignMeta = { name: path.basename(this.dir), language: 'de', createdAt: new Date().toISOString() };
    if (fs.existsSync(this.metaPath)) {
      try {
        meta = { ...meta, ...JSON.parse(fs.readFileSync(this.metaPath, 'utf8')) };
      } catch { /* keep default */ }
    } else {
      this.writeAtomic(this.metaPath, JSON.stringify(meta, null, 2));
    }
    let graph = emptyGraph();
    if (fs.existsSync(this.graphPath)) {
      try {
        graph = { ...emptyGraph(), ...JSON.parse(fs.readFileSync(this.graphPath, 'utf8')) };
      } catch { /* keep empty */ }
    }
    const nodes: Record<string, StoryNode> = {};
    for (const f of fs.readdirSync(this.nodesDir)) {
      if (!f.endsWith('.md')) continue;
      const id = f.slice(0, -3);
      const n = parseNode(fs.readFileSync(path.join(this.nodesDir, f), 'utf8'), id);
      if (n) nodes[n.id] = n;
    }
    // heal: placements/edges that point to missing nodes
    for (const id of Object.keys(graph.placements)) if (!nodes[id] || nodes[id].trashed) delete graph.placements[id];
    graph.edges = graph.edges.filter((e) => nodes[e.from] && nodes[e.to]);
    return { meta, nodes, graph };
  }

  writeMeta(meta: CampaignMeta) {
    this.writeAtomic(this.metaPath, JSON.stringify(meta, null, 2));
  }

  writeNode(n: StoryNode) {
    this.writeAtomic(this.nodePath(n.id), serializeNode(n));
  }

  removeNode(id: string) {
    const p = this.nodePath(id);
    this.selfWrites.set(p, '__deleted__');
    fs.rmSync(p, { force: true });
  }

  writeGraph(g: GraphFile) {
    this.writeAtomic(this.graphPath, JSON.stringify(g, null, 2));
  }

  private writeAtomic(file: string, content: string) {
    this.selfWrites.set(file, hash(content));
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
  }

  /** True if this file content is what we ourselves just wrote. */
  isSelfWrite(file: string, content: string | null): boolean {
    const mark = this.selfWrites.get(file);
    if (mark === undefined) return false;
    if (content === null) return mark === '__deleted__';
    return mark === hash(content);
  }
}
