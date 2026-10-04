import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importArchive } from '../src/backup.js';
import { runCommand } from '../src/commands.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

let root: string;
let dir: string;
let store: Store;
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-bak-'));
  dir = path.join(root, 'camp');
  store = new Store(new Persistence(dir));
  run('create_node', { id: 'a', type: 'scene', title: 'Arrival', summary: 'Fog.', place: 'canvas' });
  fs.writeFileSync(path.join(dir, 'images', 'pic.png'), 'png-bytes');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('snapshots', () => {
  it('a snapshot is listed with its kind; light ones leave out images, full ones keep them', () => {
    const light = store.backups.create({ kind: 'auto' });
    const full = store.backups.create({ kind: 'manual', label: 'Before the heist!' });
    const list = store.backups.list();
    expect(list.map((s) => s.id).sort()).toEqual([light.id, full.id].sort());
    expect(light).toMatchObject({ kind: 'auto', withImages: false });
    expect(full).toMatchObject({ kind: 'manual', withImages: true, label: 'before the heist' });
    const tar = (id: string) => require('node:child_process').spawnSync('tar', ['-tzf', store.backups.pathOf(id)], { encoding: 'utf8' }).stdout as string;
    expect(tar(light.id)).not.toContain('images/pic.png');
    expect(tar(full.id)).toContain('images/pic.png');
  });

  it('restore puts the old state back (nodes, graph) and keeps a safety snapshot of what was there', () => {
    const snap = store.backups.create({ kind: 'manual', label: 'good state' });
    run('create_node', { id: 'b', type: 'npc', title: 'Brenn', place: 'canvas' });
    run('update_node', { id: 'a', title: 'Changed' });
    expect(Object.keys(store.state.nodes).sort()).toEqual(['a', 'b']);
    const { safety } = store.backups.restore(snap.id);
    expect(safety.kind).toBe('pre-restore');
    const again = new Store(new Persistence(dir));
    expect(Object.keys(again.state.nodes)).toEqual(['a']);
    expect(again.state.nodes.a.title).toBe('Arrival');
    expect(fs.existsSync(path.join(dir, 'nodes', 'b.md'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'images', 'pic.png'), 'utf8')).toBe('png-bytes');
    // the safety snapshot can bring the later state back
    store.backups.restore(safety.id);
    expect(Object.keys(new Store(new Persistence(dir)).state.nodes).sort()).toEqual(['a', 'b']);
  });

  it('keeps only the newest automatic snapshots; manual ones stay', async () => {
    store.state.meta.backup = { keepAuto: 2 };
    store.backups.create({ kind: 'manual', label: 'keep me' });
    for (let i = 0; i < 4; i++) {
      store.backups.create({ kind: 'auto' });
      await new Promise((r) => setTimeout(r, 1100)); // names carry the second
    }
    const kinds = store.backups.list().map((s) => s.kind);
    expect(kinds.filter((k) => k === 'auto')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'manual')).toHaveLength(1);
  }, 15000);

  it('copies every snapshot into the mirror folder', () => {
    const mirror = path.join(root, 'cloud');
    store.state.meta.backup = { mirrorDir: mirror };
    const s = store.backups.create({ kind: 'manual' });
    expect(fs.readdirSync(path.join(mirror, 'camp'))).toEqual([s.id + '.tar.gz']);
  });

  it('exports the campaign as one archive and opens it as a new campaign elsewhere', () => {
    const file = store.backups.exportArchive(path.join(root, 'exports'));
    const camps = path.join(root, 'camps2');
    const copy = importArchive(file, camps, path.basename(file));
    const loaded = new Store(new Persistence(copy));
    expect(Object.keys(loaded.state.nodes)).toEqual(['a']);
    expect(fs.existsSync(path.join(copy, 'images', 'pic.png'))).toBe(true);
    expect(() => importArchive(path.join(root, 'camp', 'graph.json'), camps, 'x')).toThrow(/not a PenNodePaper/);
  });

  it('commits to a local git repository when asked, without committing snapshots', () => {
    store.state.meta.backup = { git: true };
    store.backups.create({ kind: 'manual', label: 'one' });
    run('update_node', { id: 'a', title: 'Second' });
    store.backups.create({ kind: 'manual', label: 'two' });
    const g = store.backups.gitInfo();
    expect(g).toMatchObject({ repo: true, commits: 2 });
    expect(require('node:child_process').spawnSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).stdout).not.toContain('snapshots/');
  });
});

describe('snapshot names', () => {
  it('an unlabelled snapshot has no label (not a slug fallback)', () => {
    expect(store.backups.create({ kind: 'auto' }).label).toBe('');
  });
});
