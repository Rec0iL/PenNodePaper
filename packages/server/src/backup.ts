// Backup & sync for one campaign folder:
//  * snapshots   — tar.gz copies in snapshots/ (automatic while you work, manual, and one before every restore)
//  * restore     — put a snapshot back (a safety snapshot is taken first)
//  * mirror      — every snapshot is also copied to a folder of your choice (Dropbox, Syncthing, a USB stick…)
//  * archive     — the whole campaign as one file, to move it to another machine (and open it there)
//  * git         — optional: commit the campaign to a local git repository with every snapshot
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BACKUP_DEFAULTS, slugify, type BackupSettings, type SnapshotInfo } from '@pnp/shared';

/** Things that belong to a campaign (everything else in the folder is ignored). images/ is handled separately. */
const CONTENT = ['campaign.json', 'graph.json', 'nodes', 'maps', 'rulebooks', 'worldbooks', 'imports', 'vtts', 'chat.json'];
const EXT = '.tar.gz';

const run = (cmd: string, args: string[], cwd?: string) => spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const stamp = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');

export class Backups {
  constructor(
    private dir: string,
    private settings: () => Partial<BackupSettings> | undefined,
  ) {}

  get config(): BackupSettings {
    return { ...BACKUP_DEFAULTS, ...(this.settings() ?? {}) };
  }
  get snapDir() {
    return path.join(this.dir, 'snapshots');
  }

  list(): SnapshotInfo[] {
    let files: string[] = [];
    try { files = fs.readdirSync(this.snapDir).filter((f) => f.endsWith(EXT)); } catch { return []; }
    return files
      .flatMap((f): SnapshotInfo[] => {
        // 2026-10-04T16-51-00Z__manual__full__label.tar.gz
        const [when, kind, scope, ...rest] = f.slice(0, -EXT.length).split('__');
        if (!when || !['auto', 'manual', 'pre-restore'].includes(kind)) return [];
        const iso = when.replace(/T(\d\d)-(\d\d)-(\d\d)Z/, 'T$1:$2:$3Z');
        return [{ id: f.slice(0, -EXT.length), createdAt: iso, kind: kind as SnapshotInfo['kind'], label: rest.join('__').replace(/-/g, ' '), bytes: fs.statSync(path.join(this.snapDir, f)).size, withImages: scope === 'full' }];
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** The newest change in the campaign's own files (not in snapshots/exports) — to know whether a snapshot is due. */
  lastChange(): number {
    let m = 0;
    const visit = (p: string, depth: number) => {
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { return; }
      m = Math.max(m, st.mtimeMs);
      if (st.isDirectory() && depth < 2) for (const f of fs.readdirSync(p)) visit(path.join(p, f), depth + 1);
    };
    for (const c of CONTENT) visit(path.join(this.dir, c), 0);
    return m;
  }

  create(opts: { kind?: SnapshotInfo['kind']; label?: string; images?: boolean } = {}): SnapshotInfo {
    const kind = opts.kind ?? 'manual';
    const images = opts.images ?? kind === 'manual';
    fs.mkdirSync(this.snapDir, { recursive: true });
    const label = opts.label?.trim() ? slugify(opts.label).slice(0, 40) : '';
    const id = [stamp(), kind, images ? 'full' : 'light', label].filter((x, i) => i < 3 || x).join('__');
    const out = path.join(this.snapDir, id + EXT);
    const members = [...CONTENT, ...(images ? ['images'] : [])].filter((m) => fs.existsSync(path.join(this.dir, m)));
    const r = run('tar', ['-czf', out, '--exclude=images/.thumbs', '-C', this.dir, ...members]);
    if (r.status !== 0) {
      fs.rmSync(out, { force: true });
      throw new Error(`Could not write the snapshot (${r.stderr?.trim() || 'tar failed'}).`);
    }
    const info = this.list().find((s) => s.id === id)!;
    this.mirror(out);
    if (kind === 'auto') this.prune();
    if (this.config.git) this.gitCommit(`${kind} snapshot${opts.label ? `: ${opts.label}` : ''}`);
    return info;
  }

  remove(id: string) {
    const f = this.file(id);
    fs.rmSync(f, { force: true });
  }

  private file(id: string) {
    const safe = path.basename(id);
    const f = path.join(this.snapDir, safe + EXT);
    if (!fs.existsSync(f)) throw new Error(`No snapshot "${id}".`);
    return f;
  }

  pathOf(id: string) {
    return this.file(id);
  }

  /** Keep the newest `keepAuto` automatic snapshots (manual and pre-restore ones stay until you delete them). */
  prune() {
    const auto = this.list().filter((s) => s.kind === 'auto');
    for (const s of auto.slice(Math.max(1, this.config.keepAuto))) this.remove(s.id);
  }

  /** Put a snapshot back. The current state is saved first (kind "pre-restore"), so a restore can itself be undone. */
  restore(id: string): { safety: SnapshotInfo } {
    const f = this.file(id);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-restore-'));
    try {
      const x = run('tar', ['-xzf', f, '-C', tmp, '--no-same-owner']);
      if (x.status !== 0) throw new Error(`Could not read the snapshot (${x.stderr?.trim() || 'tar failed'}).`);
      if (!fs.existsSync(path.join(tmp, 'graph.json')) && !fs.existsSync(path.join(tmp, 'nodes'))) throw new Error('That archive does not contain a campaign.');
      const safety = this.create({ kind: 'pre-restore', label: `before restoring ${id.slice(0, 19)}`, images: false });
      for (const c of CONTENT) {
        if (!fs.existsSync(path.join(tmp, c))) continue;
        fs.rmSync(path.join(this.dir, c), { recursive: true, force: true });
        fs.cpSync(path.join(tmp, c), path.join(this.dir, c), { recursive: true });
      }
      if (fs.existsSync(path.join(tmp, 'images'))) fs.cpSync(path.join(tmp, 'images'), path.join(this.dir, 'images'), { recursive: true, force: false });
      return { safety };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** Copy a snapshot file into the mirror folder (if one is set). Failures never block the snapshot itself. */
  mirror(file: string): string | null {
    const dest = this.config.mirrorDir.trim();
    if (!dest) return null;
    try {
      const d = path.join(dest.replace(/^~(?=$|\/)/, os.homedir()), slugify(path.basename(this.dir)) || 'campaign');
      fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(file, path.join(d, path.basename(file)));
      return d;
    } catch {
      return null;
    }
  }

  /** The whole campaign (with images) as one file in `outDir`, to move it to another machine. */
  exportArchive(outDir: string): string {
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `${slugify(path.basename(this.dir)) || 'campaign'}-${stamp()}.pnp${EXT}`);
    const members = [...CONTENT, 'images'].filter((m) => fs.existsSync(path.join(this.dir, m)));
    const r = run('tar', ['-czf', out, '--exclude=images/.thumbs', '-C', this.dir, ...members]);
    if (r.status !== 0) throw new Error(`Could not write the archive (${r.stderr?.trim() || 'tar failed'}).`);
    return out;
  }

  // ---- git (optional) ----
  private git(args: string[]) {
    return run('git', ['-c', 'user.name=PenNodePaper', '-c', 'user.email=pennodepaper@localhost', ...args], this.dir);
  }
  /** Commit the campaign to a local repository (created on first use). Pushing is yours to do: `git remote add …` in the campaign folder. */
  gitCommit(message: string): { committed: boolean; note: string } {
    if (!fs.existsSync(path.join(this.dir, '.git'))) {
      const i = run('git', ['init', '-q'], this.dir);
      if (i.status !== 0) return { committed: false, note: 'git is not available' };
      fs.writeFileSync(path.join(this.dir, '.gitignore'), 'snapshots/\nexports/\nimages/.thumbs/\n');
    }
    this.git(['add', '-A']);
    const c = this.git(['commit', '-q', '-m', message]);
    if (c.status === 0) return { committed: true, note: 'committed' };
    return { committed: false, note: /nothing to commit/.test(c.stdout + c.stderr) ? 'nothing changed' : (c.stderr || c.stdout).trim() };
  }
  gitInfo(): { enabled: boolean; repo: boolean; commits: number; last: string; remotes: string[] } {
    const repo = fs.existsSync(path.join(this.dir, '.git'));
    if (!repo) return { enabled: this.config.git, repo, commits: 0, last: '', remotes: [] };
    const n = this.git(['rev-list', '--count', 'HEAD']);
    const last = this.git(['log', '-1', '--format=%cI %s']);
    const rem = this.git(['remote', '-v']);
    return {
      enabled: this.config.git, repo,
      commits: n.status === 0 ? Number(n.stdout.trim()) || 0 : 0,
      last: last.status === 0 ? last.stdout.trim() : '',
      remotes: [...new Set(rem.stdout.split('\n').map((l) => l.split(/\s+/)[0]).filter(Boolean))],
    };
  }
}

/** Unpack a campaign archive (.pnp.tar.gz or a snapshot) into a NEW folder; returns that folder. */
export function importArchive(file: string, campaignsDir: string, nameHint: string): string {
  const base = slugify(nameHint.replace(/\.pnp\.tar\.gz$|\.tar\.gz$/i, '').replace(/-\d{4}-\d\d-\d\dT.*$/, '')) || 'imported';
  let dir = path.join(campaignsDir, base);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(campaignsDir, `${base}-${i}`);
  fs.mkdirSync(dir, { recursive: true });
  const x = run('tar', ['-xzf', file, '-C', dir, '--no-same-owner']);
  if (x.status !== 0 || (!fs.existsSync(path.join(dir, 'graph.json')) && !fs.existsSync(path.join(dir, 'nodes')))) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('That file is not a PenNodePaper campaign archive.');
  }
  return dir;
}
