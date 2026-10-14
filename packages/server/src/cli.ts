import { spawn, spawnSync, type ChildProcess, type SpawnOptions, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Starting the AI command-line programs (claude, agy, codex).
//
// On Windows `spawn('codex')` finds `codex.exe` but not `codex.cmd`, and `.cmd` is what npm installs for a global package
// (and Node refuses to run a .cmd without a shell at all). Going through cmd.exe would break the prompts (quotes, line
// breaks, `&`), so the npm launcher is read instead: it only starts `node <script>` — which is started directly.
// ---------------------------------------------------------------------------

export interface Launch {
  command: string;
  args: string[];
}

/** What an npm `.cmd` launcher starts: the script (or program) after `"%dp0%\…"`, relative to the launcher's folder. */
export function shimTarget(text: string): string | null {
  let target: string | null = null;
  // npm 7+: "%dp0%\node_modules\pkg\bin\x.js" %*   — older npm: "%~dp0\node_modules\pkg\bin\x.js" %*
  for (const m of text.matchAll(/"(?:%dp0%|%~dp0)\\?([^"%]+\.(?:c?js|mjs|exe))"\s+%\*/gi)) target = m[1];
  return target;
}

export interface Env {
  platform: NodeJS.Platform;
  path: string;
  pathExt: string;
  nodeExe: string;
  exists: (p: string) => boolean;
  read: (p: string) => string;
}

const realEnv = (): Env => ({
  platform: process.platform,
  path: process.env.PATH ?? process.env.Path ?? '',
  pathExt: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
  nodeExe: process.execPath,
  exists: (p) => fs.existsSync(p),
  read: (p) => fs.readFileSync(p, 'utf8'),
});

const SAFE = /^[\w@%+=:,./\\-]*$/;

/** How to start `bin args…` on this system. Anywhere but Windows that is just the program itself. */
export function resolveCli(bin: string, args: string[], env: Env = realEnv()): Launch {
  if (env.platform !== 'win32') return { command: bin, args };
  const w = path.win32;
  const exts = env.pathExt.split(';').filter(Boolean).map((e) => e.toLowerCase());
  const dirs = w.isAbsolute(bin) || /[\\/]/.test(bin) ? [''] : env.path.split(';').filter(Boolean);
  for (const dir of dirs) {
    for (const ext of ['', ...exts]) {
      const p = dir ? w.join(dir, bin + ext) : bin + ext;
      const e = w.extname(p).toLowerCase();
      if (!exts.includes(e) || !env.exists(p)) continue; // the extensionless file npm also writes is a sh script
      if (e === '.exe' || e === '.com') return { command: p, args };
      // .cmd / .bat
      const target = e === '.cmd' ? shimTarget(env.read(p)) : null;
      if (target) {
        const full = w.resolve(w.dirname(p), target);
        return /\.exe$/i.test(full) ? { command: full, args } : { command: env.nodeExe, args: [full, ...args] };
      }
      if (args.every((a) => SAFE.test(a))) return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/c', p, ...args] };
      throw new Error(`"${bin}" is started through ${w.basename(p)}, which cannot take this request safely. Install the program's native version or tell us which launcher it is.`);
    }
  }
  return { command: bin, args };
}

export function spawnCli(bin: string, args: string[], opts: SpawnOptions): ChildProcess {
  const l = resolveCli(bin, args);
  return spawn(l.command, l.args, { windowsHide: true, ...opts });
}

export function spawnCliSync(bin: string, args: string[], opts: { encoding: 'utf8'; timeout?: number }): SpawnSyncReturns<string> {
  try {
    const l = resolveCli(bin, args);
    return spawnSync(l.command, l.args, { windowsHide: true, ...opts });
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)), status: null, signal: null, output: [], pid: 0, stdout: '', stderr: '' } as SpawnSyncReturns<string>;
  }
}
