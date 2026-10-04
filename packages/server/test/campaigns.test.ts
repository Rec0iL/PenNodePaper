import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, describeCampaign, listCampaigns, looksLikeCampaign } from '../src/campaigns.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-camps-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('campaign folders', () => {
  it('creates a uniquely named empty campaign that loads and shows its title', () => {
    const a = createCampaign(root, 'Die Nebelküste');
    const b = createCampaign(root, 'Die Nebelküste');
    expect(path.basename(a)).not.toBe(path.basename(b));
    expect(looksLikeCampaign(a)).toBe(true);
    const store = new Store(new Persistence(a));
    expect(store.state.meta.name).toBe('Die Nebelküste');
    expect(Object.keys(store.state.nodes)).toEqual([]);
    expect(() => createCampaign(root, '  ')).toThrow(/name/);
  });

  it('lists the campaigns in the folder (with title and node count) and ignores other folders', () => {
    const a = createCampaign(root, 'Alpha');
    const store = new Store(new Persistence(a));
    store.transact('user', 'n', (tx) => tx.putNode({ id: 'x', type: 'scene', title: 'X', summary: '', body: '', readAloud: '', tags: [], status: 'untouched', fields: {}, images: [], poolHint: '', trashed: false, createdAt: '', updatedAt: '' }));
    fs.mkdirSync(path.join(root, 'random-folder'));
    const list = listCampaigns(root, a);
    expect(list.all.map((c) => c.name)).toEqual(['Alpha']);
    expect(list.all[0]).toMatchObject({ nodes: 1, current: true });
    expect(describeCampaign(a).name).toBe('Alpha');
  });
});

describe('branching', () => {
  it('a branch is a full independent copy under a new name', async () => {
    const { importArchive } = await import('../src/backup.js');
    const a = createCampaign(root, 'Main line');
    const store = new Store(new Persistence(a));
    store.transact('user', 'n', (tx) => tx.putNode({ id: 'x', type: 'scene', title: 'X', summary: '', body: '', readAloud: '', tags: [], status: 'untouched', fields: {}, images: [], poolHint: '', trashed: false, createdAt: '', updatedAt: '' }));
    fs.writeFileSync(path.join(a, 'images', 'pic.png'), 'bytes');
    const archive = store.backups.exportArchive(path.join(root, 'tmp'));
    const b = importArchive(archive, root, 'What if');
    const copy = new Store(new Persistence(b));
    copy.transact('user', 'rename', (tx) => tx.putNode({ ...tx.requireNode('x'), title: 'X in the other timeline' }));
    expect(new Store(new Persistence(a)).state.nodes.x.title).toBe('X');
    expect(copy.state.nodes.x.title).toBe('X in the other timeline');
    expect(fs.existsSync(path.join(b, 'images', 'pic.png'))).toBe(true);
    expect(b).not.toBe(a);
  });
});
