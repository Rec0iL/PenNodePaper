import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ImageBackend } from '@pnp/shared';
import { spawnCli } from './cli.js';
import { sniffImage } from './imagefile.js';

// ---------------------------------------------------------------------------
// EXPERIMENTAL: pictures painted by an AI's own image tool (agy, Codex) instead of the local ComfyUI.
// agy works like the "agy" engine of Illuminator: it is told to use its image tool and nothing else (no commands, no
// files), and the picture is taken from its conversation folder (~/.gemini/antigravity-cli/brain/<conversation id>/)
// or from the path it answers with; a used-up quota shows in its cli.log. Codex runs in a scratch folder with the
// instruction to save the picture there (not tried against a real Codex). The caller scales what comes back.
// ---------------------------------------------------------------------------

export interface CliPaintRequest {
  backend: Exclude<ImageBackend, 'comfy'>;
  prompt: string;
  negative?: string;
  w: number;
  h: number;
  /** a picture to start from (a sketch, a map's plan) and how closely to follow it */
  reference?: Buffer;
  referenceNote?: string;
  model?: string;
  signal?: AbortSignal;
}

/** Runs one CLI and resolves when it ends; injectable for tests. */
export type CliRun = (bin: string, args: string[], opts: { cwd: string; input?: string; signal?: AbortSignal; timeoutMs: number }) => Promise<{ code: number | null; out: string; err: string }>;

const realRun: CliRun = (bin, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawnCli(bin, args, { cwd: opts.cwd, stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], env: process.env });
    if (opts.input !== undefined) {
      child.stdin!.on('error', () => {});
      child.stdin!.end(opts.input);
    }
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs);
    const abort = () => child.kill('SIGTERM');
    opts.signal?.addEventListener('abort', abort, { once: true });
    child.stdout!.on('data', (d: Buffer) => (out = (out + d.toString('utf8')).slice(-200_000)));
    child.stderr!.on('data', (d: Buffer) => (err = (err + d.toString('utf8')).slice(-20_000)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start "${bin}": ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
      resolve({ code, out, err });
    });
  });

/** Where Codex may keep the pictures it makes, besides the scratch folder. */
export function cliPictureDirs(): string[] {
  return [process.env.CODEX_HOME || path.join(os.homedir(), '.codex')];
}

/** The newest PNG / JPEG / WebP under these folders that was written after `since` (a bounded walk). */
export function newestPicture(dirs: string[], since: number): string | null {
  let best: { p: string; t: number } | null = null;
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 7 || seen > 50_000) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      seen++;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        walk(p, depth + 1);
      } else if (e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)) {
        try {
          const t = fs.statSync(p).mtimeMs;
          if (t >= since && (!best || t > best.t)) best = { p, t };
        } catch { /* gone */ }
      }
    }
  };
  for (const d of dirs) walk(d, 0);
  return (best as { p: string; t: number } | null)?.p ?? null;
}

const RATIOS: [string, number, string][] = [['1:1', 1, 'square 1:1'], ['16:9', 16 / 9, 'wide landscape 16:9'], ['9:16', 9 / 16, 'tall portrait 9:16'], ['4:3', 4 / 3, 'landscape 4:3'], ['3:4', 3 / 4, 'portrait 3:4']];
/** The aspect ratio an image tool knows that is closest to w:h, in words. */
export const ratioWords = (w: number, h: number) => RATIOS.reduce((a, b) => (Math.abs(b[1] - w / h) < Math.abs(a[1] - w / h) ? b : a))[2];

// "image generation tool" alone is not enough: an MCP server that has a generate_image tool of its own (comfy-mcp) would be taken instead
const RULES = 'Use your built-in image-generator subagent (invoke_subagent) for this, nothing else: do not use call_mcp_tool or any MCP server (not comfy-mcp), do not run commands, do not create or edit other files. Reply with the path of the resulting image file only.';
/** What agy is told (Illuminator's wording, which works headless). */
export function agyPrompt(r: CliPaintRequest, refName: string | null): string {
  const avoid = r.negative ? ` Do not include: ${r.negative.replace(/\b(worst quality|low quality|lowres|jpeg artifacts|masterpiece|best quality),?\s*/gi, '').trim().replace(/,$/, '')}.` : '';
  if (refName) return `Edit the image ${refName} in the current directory as follows: ${r.referenceNote ?? 'keep its composition and layout, paint it as finished art'}. The result should show: ${r.prompt}.${avoid} Keep its ${ratioWords(r.w, r.h)} aspect ratio.\n${RULES}`;
  return `Generate one image, ${ratioWords(r.w, r.h)} aspect ratio, from this prompt (use it as written):\n${r.prompt}.${avoid}\n${RULES}`;
}

export function codexPrompt(r: CliPaintRequest, out: string, ref: string | null): string {
  return [
    'Make exactly ONE picture with your built-in image generation tool (not a script, not an SVG, not code that draws).',
    `What it shows: ${r.prompt}`,
    ...(r.negative ? [`Avoid: ${r.negative}`] : []),
    `Aspect ratio: ${ratioWords(r.w, r.h)}.`,
    ...(ref ? [`Start from the attached picture: ${r.referenceNote ?? 'keep its composition and layout, paint it as finished art'}.`] : []),
    `Save the finished picture as ${out} (PNG or JPEG). If your image tool saves it somewhere else, copy it to that path.`,
    'Do not ask questions; when the file is saved, answer with the single word DONE.',
  ].join('\n');
}

/** Where agy keeps its conversations and its log (overridable for tests). */
export interface AgyPlaces {
  brain: string;
  log: string;
  /** how long to wait for the picture after agy returned, and how often to look */
  waitMs: number;
  pollMs: number;
}
const AGY_HOME = path.join(os.homedir(), '.gemini', 'antigravity-cli');
const realPlaces: AgyPlaces = { brain: path.join(AGY_HOME, 'brain'), log: path.join(AGY_HOME, 'cli.log'), waitMs: 120_000, pollMs: 2000 };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const logSize = (f: string) => {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
};
/** agy writes a used-up quota into its log: say when it comes back. */
function checkQuota(log: string, offset: number) {
  let text = '';
  try {
    const fd = fs.openSync(log, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const from = offset <= size ? offset : 0;
      const buf = Buffer.alloc(Math.min(size - from, 2_000_000));
      fs.readSync(fd, buf, 0, buf.length, from);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return;
  }
  if (!text.includes('QUOTA_EXHAUSTED')) return;
  const ts = [...text.matchAll(/"quotaResetTimeStamp":\s*"([^"]+)"/g)].at(-1)?.[1];
  const at = ts ? new Date(ts) : null;
  const when = at && !Number.isNaN(at.getTime()) ? ` It comes back at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '';
  throw new Error(`agy's picture quota is used up.${when} Until then switch to ComfyUI in Settings → Image generation.`);
}
const pictures = (dir: string): Map<string, number> => {
  const out = new Map<string, number>();
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)) out.set(path.join(dir, e.name), fs.statSync(path.join(dir, e.name)).size);
  } catch { /* no folder (yet) */ }
  return out;
};

async function paintWithAgy(r: CliPaintRequest, run: CliRun, places: AgyPlaces): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-paint-'));
  try {
    const refName = r.reference ? 'image.png' : null;
    if (r.reference) fs.writeFileSync(path.join(dir, 'image.png'), r.reference);
    const offset = logSize(places.log);
    const res = await run('agy', ['-p', agyPrompt(r, refName), '--output-format', 'json', '--print-timeout', '300s', ...(r.model ? ['--model', r.model] : [])], { cwd: dir, signal: r.signal, timeoutMs: 6 * 60_000 });
    if (r.signal?.aborted) throw new Error('cancelled');
    checkQuota(places.log, offset);
    const start = res.out.indexOf('{');
    let data: { status?: string; conversation_id?: string; response?: string; error?: string } = {};
    try {
      data = JSON.parse(res.out.slice(start));
    } catch {
      throw new Error(`agy gave no answer: ${(res.err || res.out).trim().slice(-300) || `exit code ${res.code}`}`);
    }
    if (data.status !== 'SUCCESS') throw new Error(`agy: ${String(data.error || data.response || data.status).slice(0, 300)}`);
    // the path it answered with, else a new picture in its conversation folder (the image subagent may still be writing: wait until it holds still)
    const said = /(\/[^\s"'`]+\.(?:png|jpe?g|webp))/i.exec(data.response ?? '')?.[1];
    if (said && fs.existsSync(said) && sniffImage(fs.readFileSync(said))) return fs.readFileSync(said);
    const folder = path.join(places.brain, String(data.conversation_id ?? ''));
    let last = new Map<string, number>();
    for (const until = Date.now() + places.waitMs; Date.now() < until; ) {
      if (r.signal?.aborted) throw new Error('cancelled');
      const now = pictures(folder);
      const newest = [...now.keys()].sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
      if (newest && now.get(newest)! > 0 && last.get(newest) === now.get(newest)) {
        const bytes = fs.readFileSync(newest);
        if (sniffImage(bytes)) return bytes;
      }
      last = now;
      checkQuota(places.log, offset);
      await sleep(places.pollMs);
    }
    throw new Error(`agy made no picture. It said: ${(data.response ?? '').replace(/\s+/g, ' ').slice(0, 280) || '(nothing)'} — if this keeps happening, switch to ComfyUI in Settings → Image generation.`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function paintWithCodex(r: CliPaintRequest, run: CliRun): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-paint-'));
  const out = path.join(dir, 'out.png');
  const start = Date.now() - 1000;
  try {
    let ref: string | null = null;
    if (r.reference) {
      ref = path.join(dir, 'reference.png');
      fs.writeFileSync(ref, r.reference);
    }
    const res = await run('codex', ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-c', 'approval_policy="never"', '-C', dir, ...(ref ? ['-i', ref] : []), ...(r.model ? ['-m', r.model] : []), '-'], { cwd: dir, input: codexPrompt(r, out, ref), signal: r.signal, timeoutMs: 8 * 60_000 });
    if (r.signal?.aborted) throw new Error('cancelled');
    const found = fs.existsSync(out) ? out : newestPicture([dir, ...cliPictureDirs()], start);
    const bytes = found && found !== ref ? fs.readFileSync(found) : null;
    if (!bytes || !sniffImage(bytes)) {
      const said = (res.out.trim() || res.err.trim()).replace(/\s+/g, ' ').slice(-280);
      throw new Error(`Codex made no picture${res.code ? ` (exit code ${res.code})` : ''}. Its own image tool may not be available on this account or version — switch back to ComfyUI in Settings → Image generation.${said ? ` It said: ${said}` : ''}`);
    }
    return bytes;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Paint one picture with agy or Codex. Returns the picture's bytes (any size: the caller scales it). */
export function cliPaint(r: CliPaintRequest, run: CliRun = realRun, places: AgyPlaces = realPlaces): Promise<Buffer> {
  return r.backend === 'codex' ? paintWithCodex(r, run) : paintWithAgy(r, run, places);
}
