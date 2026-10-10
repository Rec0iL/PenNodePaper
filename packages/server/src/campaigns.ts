// Which campaigns exist, which were used recently, and creating new ones. The running server holds ONE campaign
// at a time (index.ts swaps it); this module only deals with folders and the remembered list.
import fs from 'node:fs';
import path from 'node:path';
import { slugify } from '@pnp/shared';
import { Persistence } from './persistence.js';
import { loadSaved, saveConfig, type RecentCampaign } from './config.js';

export interface CampaignInfo {
  dir: string;
  name: string;
  /** folder modification (latest change to nodes or graph) */
  modifiedAt: string;
  nodes: number;
  current?: boolean;
}

export interface CampaignList {
  current: CampaignInfo;
  recent: (CampaignInfo & { openedAt: string })[];
  all: CampaignInfo[];
  campaignsDir: string;
}

/** A folder counts as a campaign if it has the campaign files PenNodePaper writes. */
export const looksLikeCampaign = (dir: string) =>
  fs.existsSync(path.join(dir, 'graph.json')) || fs.existsSync(path.join(dir, 'campaign.json')) || fs.existsSync(path.join(dir, 'nodes'));

export function describeCampaign(dir: string): CampaignInfo {
  let name = path.basename(dir);
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'campaign.json'), 'utf8')) as { name?: string };
    if (typeof m.name === 'string' && m.name.trim()) name = m.name.trim();
  } catch { /* folder name */ }
  let nodes = 0;
  let mtime = 0;
  try {
    nodes = fs.readdirSync(path.join(dir, 'nodes')).filter((f) => f.endsWith('.md')).length;
    mtime = Math.max(fs.statSync(path.join(dir, 'graph.json')).mtimeMs, fs.statSync(path.join(dir, 'nodes')).mtimeMs);
  } catch {
    try { mtime = fs.statSync(dir).mtimeMs; } catch { /* gone */ }
  }
  return { dir, name, modifiedAt: mtime ? new Date(mtime).toISOString() : '', nodes };
}

export function listCampaigns(campaignsDir: string, currentDir: string): CampaignList {
  let all: CampaignInfo[] = [];
  try {
    all = fs
      .readdirSync(campaignsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => path.join(campaignsDir, d.name))
      .filter(looksLikeCampaign)
      .map(describeCampaign);
  } catch { /* no folder yet */ }
  const cur = path.resolve(currentDir);
  const mark = (c: CampaignInfo) => ({ ...c, current: path.resolve(c.dir) === cur || undefined });
  const recent = (loadSaved().recent ?? [])
    .filter((r) => r.dir && fs.existsSync(r.dir) && path.resolve(r.dir) !== cur)
    .slice(0, 8)
    .map((r: RecentCampaign) => ({ ...mark(describeCampaign(r.dir)), openedAt: r.openedAt }));
  return { current: mark(describeCampaign(cur)) as CampaignInfo, recent, all: all.map(mark).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)), campaignsDir };
}

/** Remember that a campaign was opened (becomes the one the server starts with next time). */
export function rememberCampaign(dir: string) {
  const abs = path.resolve(dir);
  const recent = [{ dir: abs, openedAt: new Date().toISOString() }, ...(loadSaved().recent ?? []).filter((r) => path.resolve(r.dir) !== abs)].slice(0, 12);
  saveConfig({ lastCampaign: abs, recent });
}

/** Take a campaign out of the remembered lists (it is gone, or no longer wanted there). */
export function forgetCampaign(dir: string) {
  const abs = path.resolve(dir);
  const saved = loadSaved();
  const recent = (saved.recent ?? []).filter((r) => path.resolve(r.dir) !== abs);
  saveConfig({ recent, ...(saved.lastCampaign && path.resolve(saved.lastCampaign) === abs ? { lastCampaign: '' } : {}) });
}

/** A new, empty campaign folder named after `name` (unique within `campaignsDir`). */
export function createCampaign(campaignsDir: string, name: string, language = 'de'): string {
  const title = name.trim();
  if (!title) throw new Error('Give the campaign a name.');
  const base = slugify(title) || 'campaign';
  let dir = path.join(campaignsDir, base);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(campaignsDir, `${base}-${i}`);
  const p = new Persistence(dir);
  p.writeMeta({ name: title, language, createdAt: new Date().toISOString() });
  return dir;
}
