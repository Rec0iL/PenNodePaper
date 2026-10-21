import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FAST_HINT, MODEL_FAMILIES, detectFamily, guessFamilyFromName, recommendedSettings, type FamilyKey, type ModelSettings } from '@pnp/shared';

// ---------------------------------------------------------------------------
// The image models ComfyUI offers, with the family each one belongs to (see shared/src/comfymodels.ts). ComfyUI's API
// lists only file names, so the family is read from the file itself: a .safetensors file starts with a JSON header that
// names every tensor, and the names tell Krea 2 from SD 1.5 from SDXL whatever the file is called. That needs ComfyUI's
// `models` folder on this computer; without it the file name is the only hint, and the GM picks the model type by hand.
// Ported from illuminator (rpdf/models.py).
// ---------------------------------------------------------------------------

export interface ModelEntry {
  /** the file name as ComfyUI lists it (what goes into the loader) */
  name: string;
  /** which loader finds it: a diffusion model (UNETLoader) or a full checkpoint (CheckpointLoaderSimple) */
  loader: 'unet' | 'checkpoint';
  family: FamilyKey;
  /** header = read from the file, name = guessed from its name, none = no idea */
  detected: 'header' | 'name' | 'none';
  usable: boolean;
  /** a distilled / turbo / lightning variant (fewer steps) */
  fast: boolean;
  /** what choosing it sets; null = it cannot make pictures */
  settings: ModelSettings | null;
  /** a bare diffusion model that only lies in checkpoints/: ComfyUI's diffusion-model loader does not look there */
  needsLink?: boolean;
}

const MAX_HEADER = 100_000_000;

/** The tensor names of a .safetensors file (its header only: the weights are not read). */
export function readHeaderKeys(file: string): string[] {
  const fd = fs.openSync(file, 'r');
  try {
    const len = Buffer.alloc(8);
    if (fs.readSync(fd, len, 0, 8, 0) < 8) throw new Error('too short');
    const n = Number(len.readBigUInt64LE());
    if (!Number.isFinite(n) || n <= 0 || n > MAX_HEADER) throw new Error('not a safetensors header');
    const buf = Buffer.alloc(n);
    if (fs.readSync(fd, buf, 0, n, 8) < n) throw new Error('header cut off');
    return Object.keys(JSON.parse(buf.toString('utf8')) as Record<string, unknown>).filter((k) => k !== '__metadata__');
  } finally {
    fs.closeSync(fd);
  }
}

const isModelsDir = (d: string) => !!d && ['checkpoints', 'diffusion_models'].some((s) => fs.existsSync(path.join(d, s)));

/** Where comfy-cli (which Pinokio and many installs use) keeps its workspace. */
function comfyCliWorkspace(home: string, env: NodeJS.ProcessEnv): string {
  const files = [
    path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'comfy-cli', 'config.ini'),
    path.join(home, 'Library', 'Application Support', 'comfy-cli', 'config.ini'),
    ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'comfy-cli', 'config.ini')] : []),
  ];
  for (const f of files) {
    try {
      const m = /^\s*default_workspace\s*=\s*(.+?)\s*$/m.exec(fs.readFileSync(f, 'utf8'));
      if (m) return m[1];
    } catch { /* not there */ }
  }
  return '';
}

/**
 * ComfyUI's `models` folder: the one the GM named, else where the common installs keep it (comfy-cli, ComfyUI Desktop, Pinokio,
 * a plain checkout in the home folder). '' = not found. The folder is only of use when ComfyUI runs on this computer.
 */
export function findModelsDir(saved = '', home = os.homedir(), env: NodeJS.ProcessEnv = process.env): string {
  const ws = comfyCliWorkspace(home, env);
  const candidates = [
    saved,
    env.COMFYUI_MODELS_DIR ?? '',
    ws && path.join(ws, 'models'),
    path.join(home, 'ComfyUI', 'models'),
    path.join(home, 'Documents', 'ComfyUI', 'models'),
    path.join(home, 'comfy', 'ComfyUI', 'models'),
    path.join(home, 'pinokio', 'api', 'comfy.git', 'app', 'models'),
    ...(process.platform === 'win32' ? ['C:\\pinokio\\api\\comfy.git\\app\\models', 'C:\\ComfyUI\\models', 'C:\\ComfyUI_windows_portable\\ComfyUI\\models'] : []),
  ];
  return candidates.find((d) => d && isModelsDir(d)) ?? '';
}

/** Does this ComfyUI URL point at this computer (so its files are ours to read)? */
export const isLocalUrl = (url: string): boolean => {
  try {
    return ['127.0.0.1', 'localhost', '[::1]', '::1', '0.0.0.0'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

const headerFamily = new Map<string, FamilyKey>(); // path + size + mtime -> family, so a folder of big files is read once

function familyOfFile(file: string, name: string): FamilyKey | null {
  try {
    const st = fs.statSync(file);
    const key = `${fs.realpathSync(file)}|${st.size}|${st.mtimeMs}`;
    let f = headerFamily.get(key);
    if (!f) {
      f = detectFamily(readHeaderKeys(file), name);
      headerFamily.set(key, f);
    }
    return f;
  } catch {
    return null;
  }
}

/** A full checkpoint (SD 1.5, SDXL, Flux with encoders) is loaded as a checkpoint; Krea 2 and Anima are bare diffusion models. */
const BARE: FamilyKey[] = ['krea2', 'anima'];
const FULL: FamilyKey[] = ['sdxl', 'sd15', 'flux_ckpt'];

/**
 * Every model ComfyUI offers, with its family. `modelsDir` '' = the files cannot be read (names are all there is).
 * Usable models first, then by name; a diffusion model that only lies in checkpoints/ comes with `needsLink`.
 */
export function scanModels(modelsDir: string, lists: { unet: string[]; checkpoint: string[] }): ModelEntry[] {
  const out: ModelEntry[] = [];
  const seen = new Set<string>();
  const entry = (name: string, loader: ModelEntry['loader'], family: FamilyKey, detected: ModelEntry['detected'], needsLink?: boolean): ModelEntry => ({
    name, loader, family, detected,
    usable: MODEL_FAMILIES[family].usable !== false,
    fast: FAST_HINT.test(name),
    settings: recommendedSettings(family, name),
    ...(needsLink ? { needsLink } : {}),
  });
  const classify = (name: string, folder: string, loader: ModelEntry['loader']): { family: FamilyKey; detected: ModelEntry['detected'] } => {
    const file = modelsDir ? path.join(modelsDir, folder, name) : '';
    const f = file && /\.safetensors$/i.test(name) && fs.existsSync(file) ? familyOfFile(file, name) : null;
    if (f && f !== 'unknown') return { family: f, detected: 'header' };
    const g = guessFamilyFromName(name, loader);
    return g !== 'unknown' ? { family: g, detected: 'name' } : { family: 'unknown', detected: 'none' };
  };
  const add = (e: ModelEntry) => {
    const k = `${e.name}|${e.loader}`;
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  };
  for (const name of lists.unet) {
    const { family, detected } = classify(name, 'diffusion_models', 'unet');
    if (FULL.includes(family)) continue; // a whole checkpoint in diffusion_models/ would not load there: it is listed from checkpoints/
    add(entry(name, 'unet', family, detected));
  }
  const unet = new Set(lists.unet);
  for (const name of lists.checkpoint) {
    const { family, detected } = classify(name, 'checkpoints', 'checkpoint');
    if (BARE.includes(family)) { if (!unet.has(name)) add(entry(name, 'unet', family, detected, true)); continue; }
    add(entry(name, 'checkpoint', family, detected));
  }
  return out.sort((a, b) => Number(!a.usable) - Number(!b.usable) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
