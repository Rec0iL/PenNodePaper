import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintStory } from '@pnp/shared';
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

  it('a connection is the only way between canvases: there is no portal node (any more)', () => {
    twoActs();
    expect(() => run('create_node', { type: 'portal', title: 'Door' })).toThrow();
    expect(() => run('create_portal', { toCanvas: 'act-ii' })).toThrow(/Unknown command/);
  });

  it('deleting a canvas keeps the connections that lead there: they are cross-canvas ones again, or plain ones after moveTo', () => {
    twoActs();
    const e = run('link', { from: 'hook', to: 'arrive' }).edgeId;
    run('delete_canvas', { id: 'act-ii' }); // arrive goes to the pool
    const edge = () => run('get_graph').edges.find((x: any) => x.id === e);
    expect(edge()).toMatchObject({ from: 'hook', to: 'arrive' });
    expect(edge()).not.toHaveProperty('crossCanvas'); // one end is in the pool: nothing to jump to
    store.undo();
    expect(edge()).toMatchObject({ crossCanvas: 'main → act-ii' });
    run('delete_canvas', { id: 'act-ii', moveTo: 'main' });
    expect(edge()).not.toHaveProperty('crossCanvas'); // both ends on the main canvas now
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

describe('the active canvas', () => {
  it('knows where the GM is looking, falls back sensibly, and new things land there', () => {
    run('create_canvas', { name: 'Act II' });
    scene('a1', 'act-ii');
    expect(run('get_active_canvas')).toMatchObject({ canvas: { id: 'main' }, known: false, selectedNode: null, nodesOnIt: 0 }); // no GM view yet: the first canvas

    store.setView({ canvas: 'act-ii', nodeId: 'a1' });
    expect(run('get_active_canvas')).toMatchObject({ canvas: { id: 'act-ii', name: 'Act II' }, known: true, nodesOnIt: 1, selectedNode: { id: 'a1', title: 'a1', type: 'scene' } });

    // anything created without a canvas goes where the GM is
    const n = run('create_node', { type: 'scene', title: 'Here', id: 'here', place: 'canvas' }).id;
    expect(store.state.graph.placements[n].canvas).toBe('act-ii');
    run('create_node', { type: 'scene', title: 'Pooled', id: 'pooled' });
    run('place_on_canvas', { id: 'pooled' });
    expect(store.state.graph.placements.pooled.canvas).toBe('act-ii');
    run('create_node', { type: 'scene', title: 'Elsewhere', id: 'elsewhere', place: 'canvas', canvas: 'main' }); // an explicit canvas still wins
    expect(store.state.graph.placements.elsewhere.canvas).toBe('main');
    expect(run('create_frame', { title: 'Frame' }).id).toBeTruthy();
    expect(store.state.graph.frames[0].canvas).toBe('act-ii');

    // an unknown canvas is ignored; a deleted one falls back to the first; a trashed selection is not reported
    store.setView({ canvas: 'nope' });
    expect(run('get_active_canvas').canvas.id).toBe('act-ii');
    run('delete_canvas', { id: 'act-ii', moveTo: 'main' });
    expect(run('get_active_canvas')).toMatchObject({ canvas: { id: 'main' }, known: false });
    store.setView({ canvas: 'main', nodeId: 'a1' });
    run('delete_node', { id: 'a1' });
    expect(run('get_active_canvas').selectedNode).toBeNull();
  });
});

describe('jump marker positions', () => {
  it('remembers where the GM dragged a marker, per canvas, with undo; the AI cannot move markers', () => {
    run('create_canvas', { name: 'Act II' });
    scene('hook', 'main'); scene('arrive', 'act-ii');
    const e = run('link', { from: 'hook', to: 'arrive' }).edgeId;
    const edge = () => store.state.graph.edges.find((x) => x.id === e)!;
    expect(edge().markers).toBeUndefined();

    runCommand(store, 'move_edge_marker', { edgeId: e, canvas: 'main', x: 412.4, y: 90.6 }, 'user');
    runCommand(store, 'move_edge_marker', { edgeId: e, canvas: 'act-ii', x: 10, y: 20 }, 'user');
    expect(edge().markers).toEqual({ main: { x: 412, y: 91 }, 'act-ii': { x: 10, y: 20 } }); // one position per canvas, rounded
    run('relink', { edgeId: e, label: 'sail' }); // other edits keep the positions
    expect(edge().markers).toEqual({ main: { x: 412, y: 91 }, 'act-ii': { x: 10, y: 20 } });

    runCommand(store, 'move_edge_marker', { edgeId: e, canvas: 'main', reset: true }, 'user');
    expect(edge().markers).toEqual({ 'act-ii': { x: 10, y: 20 } });
    runCommand(store, 'move_edge_marker', { edgeId: e, canvas: 'act-ii', reset: true }, 'user');
    expect(edge().markers).toBeUndefined();
    store.undo();
    expect(edge().markers).toEqual({ 'act-ii': { x: 10, y: 20 } });

    expect(() => runCommand(store, 'move_edge_marker', { edgeId: e, canvas: 'nope', x: 1, y: 1 }, 'user')).toThrow(/not found/);
    expect(() => runCommand(store, 'move_edge_marker', { edgeId: e, canvas: 'main' }, 'user')).toThrow(/x and y/);
    expect(() => runCommand(store, 'move_edge_marker', { edgeId: e, canvas: 'main', x: 1, y: 1 }, 'claude')).toThrow(/GM only/);
  });
});
