import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintStory, portalTarget } from '@pnp/shared';
import { runCommand } from '../src/commands.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;
const scene = (id: string, canvas: string, extra: object = {}) => run('create_node', { id, type: 'scene', title: id, summary: `${id}.`, place: 'canvas', canvas, ...extra });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-canvas-'));
  store = new Store(new Persistence(dir));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('canvases', () => {
  it('renames a canvas without breaking anything that points at it', () => {
    run('create_canvas', { name: 'Act II' });
    scene('a1', 'act-ii');
    expect(run('rename_canvas', { id: 'act-ii', name: 'The Crossing' })).toEqual({ id: 'act-ii', name: 'The Crossing' });
    expect(store.state.graph.canvases.map((c) => c.name)).toEqual(['Main story', 'The Crossing']);
    expect(store.state.graph.placements.a1.canvas).toBe('act-ii');
    expect(() => run('rename_canvas', { id: 'nope', name: 'x' })).toThrow(/not found/);
  });

  it('delete: nodes go to the pool by default, or move onto another canvas below what is there; one undo brings it all back', () => {
    run('create_canvas', { name: 'Side quest' });
    scene('m1', 'main', { x: 0, y: 0 });
    scene('s1', 'side-quest', { x: 40, y: 100 });
    scene('s2', 'side-quest', { x: 40, y: 300 });
    run('create_frame', { title: 'The cave', nodeIds: ['s1', 's2'] });

    const r = run('delete_canvas', { id: 'side-quest' });
    expect(r).toMatchObject({ nodes: 2, nodesWent: 'pool', frames: 1 });
    expect(store.state.graph.canvases.map((c) => c.id)).toEqual(['main']);
    expect(store.state.graph.placements.s1).toBeUndefined();
    expect(store.state.nodes.s1.trashed).toBe(false); // in the pool, not lost
    expect(store.state.graph.frames).toHaveLength(0);

    store.undo();
    expect(store.state.graph.canvases.map((c) => c.id)).toEqual(['main', 'side-quest']);
    expect(store.state.graph.placements.s2.canvas).toBe('side-quest');
    expect(store.state.graph.frames).toHaveLength(1);

    const m = run('delete_canvas', { id: 'side-quest', moveTo: 'main' });
    expect(m).toMatchObject({ nodesWent: 'main', frames: 1 });
    expect(store.state.graph.placements.s1.canvas).toBe('main');
    expect(store.state.graph.placements.s1.y).toBeGreaterThan(store.state.graph.placements.m1.y + 150); // below main's own node
    expect(store.state.graph.placements.s2.y - store.state.graph.placements.s1.y).toBe(200);          // the group keeps its shape
    expect(store.state.graph.frames[0].canvas).toBe('main');
  });

  it('refuses to delete the last canvas or to move into itself', () => {
    expect(() => run('delete_canvas', { id: 'main' })).toThrow(/last canvas/);
    run('create_canvas', { name: 'B' });
    expect(() => run('delete_canvas', { id: 'b', moveTo: 'b' })).toThrow(/moveTo/);
  });

  it('show_canvas changes nothing in the campaign but tells the view where to go', () => {
    run('create_canvas', { name: 'Act II' });
    scene('a1', 'act-ii');
    const seen: unknown[] = [];
    store.onView((v) => seen.push(v));
    const before = JSON.stringify(store.state.graph);
    const steps = store.history.length;
    expect(run('show_canvas', { id: 'main' })).toMatchObject({ canvas: 'main' });
    expect(run('show_canvas', { id: 'main', nodeId: 'a1' })).toMatchObject({ canvas: 'act-ii' }); // the node's own canvas wins
    expect(seen).toEqual([{ canvas: 'main', nodeId: undefined, actor: 'claude' }, { canvas: 'act-ii', nodeId: 'a1', actor: 'claude' }]);
    expect(JSON.stringify(store.state.graph)).toBe(before);
    expect(store.history.length).toBe(steps); // no batch, no undo step
    expect(() => run('show_canvas', { id: 'nope' })).toThrow(/not found/);
  });
});

describe('portals', () => {
  function twoActs() {
    run('create_canvas', { name: 'Act II' });
    scene('hook', 'main'); scene('finale', 'main');
    scene('arrive', 'act-ii'); scene('twist', 'act-ii');
    run('link', { from: 'arrive', to: 'twist' });
  }

  it('a portal hangs off a node, leads to another canvas and carries the story flow across', () => {
    twoActs();
    const r = run('create_portal', { toCanvas: 'act-ii', toNodeId: 'arrive', from: 'hook', summary: 'Sail for Tortuga' });
    expect(r).toMatchObject({ canvas: 'main', leadsTo: 'act-ii', arrivesAt: 'arrive' });
    const p = store.state.nodes[r.id];
    expect(p).toMatchObject({ type: 'portal', title: '→ Act II', fields: { canvas: 'act-ii', nodeId: 'arrive' } });
    expect(store.state.graph.placements[r.id].canvas).toBe('main');
    const kinds = store.state.graph.edges.map((e) => `${e.from}>${e.to}:${e.kind}`);
    expect(kinds).toContain(`hook>${r.id}:leads-to`);
    expect(kinds).toContain(`${r.id}>arrive:bridge`);
    expect(portalTarget(store.state, p)).toMatchObject({ canvas: { id: 'act-ii' }, node: { id: 'arrive' } });
    // act II is not an unreachable separate chain, and the portal is not a dead end
    const codes = lintStory(store.state).map((i) => `${i.code}:${i.nodeId}`);
    expect(codes).not.toContain('separate-chain:arrive');
    expect(codes).not.toContain(`dead-end:${r.id}`);
  });

  it('side quest: a portal out and one back into the main line', () => {
    twoActs();
    const out = run('create_portal', { toCanvas: 'act-ii', toNodeId: 'arrive', from: 'hook', title: 'Follow the smugglers' });
    const back = run('create_portal', { toCanvas: 'main', toNodeId: 'finale', from: 'twist', title: 'Back to the harbour' });
    expect(store.state.graph.placements[back.id].canvas).toBe('act-ii');
    expect(store.state.graph.edges.some((e) => e.from === back.id && e.to === 'finale' && e.kind === 'bridge')).toBe(true);
    expect(store.state.nodes[out.id].title).toBe('Follow the smugglers');
  });

  it('validates its target and refuses nonsense', () => {
    twoActs();
    expect(() => run('create_portal', { toCanvas: 'nope' })).toThrow(/not found/);
    expect(() => run('create_portal', { toCanvas: 'act-ii', toNodeId: 'hook' })).toThrow(/not on canvas/);
    expect(() => run('create_portal', { toCanvas: 'main', from: 'hook' })).toThrow(/same canvas/);
    run('create_node', { id: 'pooled', type: 'scene', title: 'Pooled' });
    expect(() => run('create_portal', { toCanvas: 'act-ii', from: 'pooled' })).toThrow(/in the pool/);
  });

  it('is one undo step, and the linter flags a portal whose canvas is deleted (moveTo re-points it instead)', () => {
    twoActs();
    const r = run('create_portal', { toCanvas: 'act-ii', toNodeId: 'arrive', from: 'hook' });
    expect(store.state.graph.edges.length).toBe(3);
    store.undo();
    expect(store.state.nodes[r.id]).toBeUndefined();
    expect(store.state.graph.edges.length).toBe(1);
    store.redo();

    run('create_canvas', { name: 'Elsewhere' });
    run('delete_canvas', { id: 'act-ii', moveTo: 'elsewhere' });
    expect(store.state.nodes[r.id].fields.canvas).toBe('elsewhere');
    expect(lintStory(store.state).some((i) => i.code === 'portal-target' && i.nodeId === r.id)).toBe(false);

    run('delete_canvas', { id: 'elsewhere' });
    expect(store.state.nodes[r.id].fields.canvas).toBeUndefined();
    expect(lintStory(store.state).some((i) => i.code === 'portal-target' && i.nodeId === r.id && i.level === 'warn')).toBe(true);
  });

  it('batches with the other commands (new canvas + portal in one step)', () => {
    scene('hook', 'main');
    run('batch', { ops: [
      { command: 'create_canvas', args: { name: 'Act II', id: 'act2' } },
      { command: 'create_node', args: { id: 'arrive', type: 'scene', title: 'Arrive', place: 'canvas', canvas: 'act2' } },
      { command: 'create_portal', args: { toCanvas: 'act2', toNodeId: 'arrive', from: 'hook' } },
    ] });
    expect(Object.values(store.state.nodes).filter((n) => n.type === 'portal')).toHaveLength(1);
  });
});

describe('connections between canvases', () => {
  function twoActs() {
    run('create_canvas', { name: 'Act II' });
    scene('hook', 'main'); scene('arrive', 'act-ii'); scene('twist', 'act-ii');
    run('link', { from: 'arrive', to: 'twist' });
  }

  it('link works across canvases, both ways, and get_graph flags those edges for the AI', () => {
    twoActs();
    const out = run('link', { from: 'hook', to: 'arrive', label: 'if they take the ship' });
    const back = run('link', { from: 'twist', to: 'hook', kind: 'conditional' });
    const edges = run('get_graph').edges;
    expect(edges.find((e: any) => e.id === out.edgeId)).toMatchObject({ from: 'hook', to: 'arrive', crossCanvas: 'main → act-ii', label: 'if they take the ship' });
    expect(edges.find((e: any) => e.id === back.edgeId)).toMatchObject({ crossCanvas: 'act-ii → main', kind: 'conditional' });
    expect(edges.find((e: any) => e.from === 'arrive' && e.to === 'twist')).not.toHaveProperty('crossCanvas');
  });

  it('the story logic sees across: act II is not a separate chain, and the played path continues over the edge', () => {
    twoActs();
    run('link', { from: 'hook', to: 'arrive' });
    expect(lintStory(store.state).some((i) => i.code === 'separate-chain')).toBe(false);
    run('mark_played', { nodeId: 'hook' });
    run('mark_played', { nodeId: 'arrive', after: 'hook' });
    expect(run('story_status').here).toEqual([{ id: 'arrive', title: 'arrive' }]);
  });

  it('moving a node to another canvas turns its edges into cross-canvas ones without touching them; undo restores', () => {
    twoActs();
    scene('mid', 'main');
    run('link', { from: 'hook', to: 'mid' });
    expect(run('get_graph').edges.find((e: any) => e.to === 'mid')).not.toHaveProperty('crossCanvas');
    run('move_node', { id: 'mid', x: 100, y: 100, canvas: 'act-ii' });
    expect(run('get_graph').edges.find((e: any) => e.to === 'mid')).toMatchObject({ crossCanvas: 'main → act-ii' });
    store.undo();
    expect(run('get_graph').edges.find((e: any) => e.to === 'mid')).not.toHaveProperty('crossCanvas');
  });
});
