import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newAccessCode, newSecret } from './lan.js';
import type { MapPaintMode } from '@pnp/shared';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface RecentCampaign { dir: string; openedAt: string }

export interface AppConfig {
  port: number;
  /** LAN mode: listen on the network and ask other devices for the access code (PNP_LAN=1 turns it on for one run). */
  lan: boolean;
  lanCode: string;
  lanSecret: string;
  /** Bearer token required by the MCP endpoint (agy / Claude connect with it). */
  token: string;
  campaignsDir: string;
  campaign: string;
}

const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'pennodepaper');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

type Saved = Partial<AppConfig> & { lastCampaign?: string; recent?: RecentCampaign[]; mapPaintMode?: MapPaintMode };

export function loadSaved(): Saved {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Saved;
  } catch {
    return {};
  }
}

/** Merge into the user's config file (token, port, last campaign, recent campaigns). */
export function saveConfig(patch: Saved) {
  const next = { ...loadSaved(), ...patch };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function loadConfig(): AppConfig {
  const saved = loadSaved();
  const token = saved.token ?? randomBytes(24).toString('hex');
  const cfg: AppConfig = {
    port: Number(process.env.PNP_PORT ?? saved.port ?? 4317),
    lan: process.env.PNP_LAN ? process.env.PNP_LAN === '1' : !!saved.lan,
    lanCode: saved.lanCode ?? newAccessCode(),
    lanSecret: saved.lanSecret ?? newSecret(),
    token,
    campaignsDir: process.env.PNP_CAMPAIGNS_DIR ?? saved.campaignsDir ?? path.join(REPO_ROOT, 'campaigns'),
    campaign: process.env.PNP_CAMPAIGN ?? saved.campaign ?? 'demo',
  };
  if (!saved.token) saveConfig({ port: cfg.port, token: cfg.token });
  if (!saved.lanCode || !saved.lanSecret) saveConfig({ lanCode: cfg.lanCode, lanSecret: cfg.lanSecret });
  return cfg;
}

/** How battle maps are painted: a setting of this computer (it depends on how fast the machine is), shared by all campaigns. */
export function loadMapPaintMode(): MapPaintMode {
  return loadSaved().mapPaintMode === 'staged' ? 'staged' : 'quick';
}

export const CONFIG_PATH = CONFIG_FILE;
