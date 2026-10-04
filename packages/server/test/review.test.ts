import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/commands.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
const as = (actor: 'user' | 'claude', name: string, args: unknown = {}) => runCommand(store, name, args, actor) as any;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-review-'));
  store = new Store(new Persistence(dir));
  store.state.meta.aiMode = 'review';
  as('user', 'create_node', { id: 'a', type: 'scene', title: 'Arrival', summary: 'Fog.', place: 'canvas' });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('review mode', () => {
  it('AI changes apply at once but wait as one proposal per chat turn; the GM\'s own edits never do', () => {
    expect(store.proposals()).toEqual([]);
    store.beginTurn('Add a tavern near the arrival');
    as('claude', 'create_node', { id: 'tavern', type: 'location', title: 'Tavern', place: 'canvas', nearNodeId: 'a' });
    as('claude', 'link', { from: 'a', to: 'tavern', kind: 'leads-to' });
    store.endTurn();
    expect(store.state.nodes.tavern).toBeDefined(); // already applied: later AI steps can build on it
    const [p] = store.proposals();
    expect(store.proposals()).toHaveLength(1);
    expect(p).toMatchObject({ actor: 'claude', title: 'Add a tavern near the arrival', newNodes: ['tavern'], linked: 1 });
    expect(p.steps).toHaveLength(2);
    expect(p.nodes).toEqual(expect.arrayContaining(['tavern', 'a']));
    store.beginTurn('Another request');
    as('claude', 'update_node', { id: 'a', title: 'Arrival at dawn' });
    store.endTurn();
    expect(store.proposals()).toHaveLength(2);
  });

  it('accept keeps the changes; reject takes exactly that turn back (newest step first)', () => {
    store.beginTurn('first');
    as('claude', 'create_node', { id: 'x', type: 'npc', title: 'X', place: 'canvas' });
    store.endTurn();
    store.beginTurn('second');
    as('claude', 'create_node', { id: 'y', type: 'npc', title: 'Y', place: 'canvas' });
    as('claude', 'link', { from: 'x', to: 'y', kind: 'belongs-to' });
    store.endTurn();
    const [p1, p2] = store.proposals();
    expect(store.rejectProposal(p2.id)).toBe(1);
    expect(store.state.nodes.y).toBeUndefined();
    expect(store.state.graph.edges.some((e) => e.to === 'y')).toBe(false);
    expect(store.state.nodes.x).toBeDefined();
    expect(store.acceptProposal(p1.id)).toBe(1);
    expect(store.proposals()).toEqual([]);
    expect(store.state.nodes.x).toBeDefined();
  });

  it('refuses to reject when you changed the same thing afterwards', () => {
    store.beginTurn('rename');
    as('claude', 'update_node', { id: 'a', title: 'AI title' });
    store.endTurn();
    as('user', 'update_node', { id: 'a', summary: 'my own edit' });
    const [p] = store.proposals();
    expect(() => store.rejectProposal(p.id)).toThrow(/changed some of the same things/);
    expect(store.state.nodes.a.title).toBe('AI title');
    expect(store.acceptProposal()).toBe(1);
  });

  it('live mode makes no proposals, and the AI cannot accept or reject its own changes', () => {
    store.state.meta.aiMode = 'live';
    as('claude', 'update_node', { id: 'a', title: 'live edit' });
    expect(store.proposals()).toEqual([]);
    store.state.meta.aiMode = 'review';
    as('claude', 'update_node', { id: 'a', title: 'review edit' });
    expect(() => as('claude', 'accept_proposal')).toThrow(/GM only/);
    expect(store.proposals()).toHaveLength(1);
  });
});
