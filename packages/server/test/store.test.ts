import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Batch } from '@pnp/shared';
import { runCommand } from '../src/commands.js';
import { Persistence, parseNode, serializeNode } from '../src/persistence.js';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;
const last = (): Batch => store.history[store.history.length - 1];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-'));
  store = new Store(new Persistence(dir));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('commands + events', () => {
  it('creates into the pool by default, then places on canvas', () => {
    const { id } = run('create_node', { type: 'scene', title: 'Tavern' });
    expect(store.state.graph.placements[id]).toBeUndefined();
    expect(last().events[0]).toMatchObject({ type: 'node.created', placement: null });

    run('place_on_canvas', { id, x: 100, y: 50 });
    expect(last().events).toEqual([{ type: 'node.placed', id, from: 'pool', placement: { canvas: 'main', x: 100, y: 50 } }]);

    run('move_to_pool', { id });
    expect(last().events[0]).toMatchObject({ type: 'node.pooled', id });
    expect(store.state.graph.placements[id]).toBeUndefined();
  });

  it('emits field diffs on update', () => {
    const { id } = run('create_node', { type: 'npc', title: 'Garrick' });
    run('update_node', { id, summary: 'A smith', fields: { tier: 'boss' } });
    const ev = last().events[0] as any;
    expect(ev.type).toBe('node.updated');
    expect(ev.diffs.map((d: any) => d.field).sort()).toEqual(['fields', 'summary']);
  });

  it('relink emits edge.rewired', () => {
    const a = run('create_node', { type: 'scene', title: 'A', place: 'canvas' }).id;
    const b = run('create_node', { type: 'scene', title: 'B', place: 'canvas' }).id;
    const c = run('create_node', { type: 'scene', title: 'C', place: 'canvas' }).id;
    const { edgeId } = run('link', { from: a, to: b });
    run('relink', { edgeId, to: c });
    expect(last().events[0]).toMatchObject({ type: 'edge.rewired', edge: { to: c }, before: { to: b } });
  });

  it('delete is a soft delete that undo fully restores (edges + placement)', () => {
    const a = run('create_node', { type: 'scene', title: 'A', place: 'canvas', x: 0, y: 0 }).id;
    const b = run('create_node', { type: 'scene', title: 'B', place: 'canvas', x: 400, y: 0, linkFrom: a }).id;
    expect(store.state.graph.edges).toHaveLength(1);
    run('delete_node', { id: b });
    expect(store.state.nodes[b].trashed).toBe(true);
    expect(store.state.graph.edges).toHaveLength(0);
    expect(store.state.graph.placements[b]).toBeUndefined();
    expect(last().events.map((e) => e.type)).toContain('node.trashed');

    store.undo();
    expect(store.state.nodes[b].trashed).toBe(false);
    expect(store.state.graph.edges).toHaveLength(1);
    expect(store.state.graph.placements[b]).toMatchObject({ x: 400, y: 0 });
    expect(last().undoOf).toBeTruthy();
    expect(last().events.map((e) => e.type)).toContain('node.restored');

    store.redo();
    expect(store.state.nodes[b].trashed).toBe(true);
  });

  it('batch is one undo step and can reference ids given up front', () => {
    run('batch', {
      ops: [
        { command: 'create_node', args: { id: 'x1', type: 'scene', title: 'X', place: 'canvas' } },
        { command: 'create_node', args: { id: 'y1', type: 'scene', title: 'Y', place: 'canvas', nearNodeId: 'x1' } },
        { command: 'link', args: { from: 'x1', to: 'y1' } },
      ],
    });
    expect(Object.keys(store.state.nodes)).toEqual(['x1', 'y1']);
    expect(store.state.graph.edges).toHaveLength(1);
    store.undo();
    expect(Object.keys(store.state.nodes)).toEqual([]);
    expect(store.state.graph.edges).toHaveLength(0);
  });

  it('rolls back a failing transaction completely', () => {
    expect(() =>
      run('batch', {
        ops: [
          { command: 'create_node', args: { id: 'ok', type: 'scene', title: 'ok' } },
          { command: 'link', args: { from: 'ok', to: 'missing' } },
        ],
      }),
    ).toThrow();
    expect(Object.keys(store.state.nodes)).toEqual([]);
    expect(store.history).toHaveLength(0);
  });

  it('auto-positions without overlapping', () => {
    const a = run('create_node', { type: 'scene', title: 'A', place: 'canvas' }).id;
    const b = run('create_node', { type: 'scene', title: 'B', place: 'canvas', nearNodeId: a }).id;
    const c = run('create_node', { type: 'scene', title: 'C', place: 'canvas', nearNodeId: a }).id;
    const pos = [a, b, c].map((id) => store.state.graph.placements[id]);
    for (let i = 0; i < pos.length; i++)
      for (let j = i + 1; j < pos.length; j++)
        expect(Math.abs(pos[i].x - pos[j].x) >= 280 || Math.abs(pos[i].y - pos[j].y) >= 150).toBe(true);
  });
});

describe('no-op edits', () => {
  it('do not create batches or undo steps', () => {
    const { id } = run('create_node', { type: 'scene', title: 'A', summary: 'same' });
    const n = store.history.length;
    run('update_node', { id, summary: 'same', title: 'A' });
    const b = run('create_node', { type: 'scene', title: 'B' }).id;
    const { edgeId } = run('link', { from: id, to: b, label: 'x' });
    const m = store.history.length;
    run('relink', { edgeId, label: 'x' });
    expect(store.history.length).toBe(m);
    expect(n).toBe(1);
    run('create_canvas', { name: 'Act II' }); // canvas ops have no events but are real changes
    expect(store.history.length).toBe(m + 1);
    expect(store.state.graph.canvases).toHaveLength(2);
  });
});

describe('persistence', () => {
  it('round-trips a node through markdown', () => {
    const { id } = run('create_node', {
      type: 'npc', title: 'Orla', summary: 's', body: '# Notes\n- a', readAloud: 'Hello there.', tags: ['x'], fields: { tier: 'goon' }, poolHint: 'anytime',
    });
    const raw = fs.readFileSync(path.join(dir, 'nodes', `${id}.md`), 'utf8');
    expect(raw).toContain('<!-- read-aloud -->');
    const parsed = parseNode(raw, id)!;
    expect(parsed).toEqual(store.state.nodes[id]);
    expect(serializeNode(parsed)).toBe(raw);
  });

  it('reloads the whole campaign from disk', () => {
    const a = run('create_node', { type: 'scene', title: 'A', place: 'canvas', x: 10, y: 20 }).id;
    const b = run('create_node', { type: 'scene', title: 'B', linkFrom: a }).id;
    const again = new Store(new Persistence(dir));
    expect(again.state.nodes[a].title).toBe('A');
    expect(again.state.graph.placements[a]).toMatchObject({ x: 10, y: 20 });
    expect(again.state.graph.placements[b]).toBeUndefined();
    expect(again.state.graph.edges).toHaveLength(1);
  });
});
