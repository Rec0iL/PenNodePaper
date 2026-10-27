import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mapIdsOf } from '@pnp/shared';
import { runCommand } from '../src/commands.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'user') as any;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-clip-'));
  store = new Store(new Persistence(dir));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('pasting copied nodes', () => {
  it('makes new nodes in the old layout with the connections among them, its own map copies and no played history; one undo removes it all', () => {
    run('create_node', { id: 'inn', type: 'location', title: 'Inn', summary: 'An inn.', place: 'canvas', x: 0, y: 0, fields: { visits: [{ group: 'party', seq: 1 }] } });
    run('create_map', { name: 'Inn floor', nodeId: 'inn' });
    run('create_node', { id: 'host', type: 'npc', title: 'Host', summary: 'Runs it.', place: 'canvas', x: 300, y: 40 });
    run('link', { from: 'host', to: 'inn', kind: 'belongs-to' });
    const inn = store.state.nodes.inn;
    const r = run('paste_nodes', {
      x: 1000, y: 500,
      nodes: [
        { key: 'a', dx: 0, dy: 0, node: { ...inn, images: ['not-here.png'] } },
        { key: 'b', dx: 300, dy: 40, node: store.state.nodes.host },
      ],
      edges: [{ from: 'b', to: 'a', kind: 'belongs-to' }, { from: 'b', to: 'zzz', kind: 'leads-to' }],
    });
    const [a, b] = r.ids;
    expect(a).not.toBe('inn');
    expect(store.state.graph.placements[a]).toMatchObject({ x: 1000, y: 500 });
    expect(store.state.graph.placements[b]).toMatchObject({ x: 1300, y: 540 });
    expect(store.state.graph.edges.filter((e) => e.from === b && e.to === a)).toHaveLength(1);
    expect(r.edges).toBe(1);
    const copy = store.state.nodes[a];
    expect(copy.images).toEqual([]);
    expect(copy.fields.visits).toBeUndefined();
    expect(copy.status).toBe('untouched');
    const [orig] = mapIdsOf(inn);
    const [mine] = mapIdsOf(copy);
    expect(mine).toBeTruthy();
    expect(mine).not.toBe(orig);
    expect(store.maps.get(mine).name).toBe('Inn floor');
    store.undo();
    expect(store.state.nodes[a]).toBeUndefined();
    expect(store.state.nodes.inn).toBeTruthy();
  });

  it('is for the GM only', () => {
    expect(() => runCommand(store, 'paste_nodes', { nodes: [{ key: 'a', dx: 0, dy: 0, node: { type: 'scene', title: 'x' } }] }, 'claude')).toThrow(/GM only/);
  });
});
