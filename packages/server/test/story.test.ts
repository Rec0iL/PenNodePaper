import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintStory, trailEdges } from '@pnp/shared';
import { runCommand } from '../src/commands.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;
const node = (id: string, type: string, title: string, extra: object = {}) => ({ command: 'create_node', args: { id, type, title, summary: `${title}.`, place: 'canvas', ...extra } });
const link = (from: string, to: string, kind = 'leads-to', label = '') => ({ command: 'link', args: { from, to, kind, label } });

/** arrival ─┬─ ledger(clue) ──┐
 *           │      └─ rumour(clue) ─reveals→ cove
 *           └─ warehouse ─────┴─ cove ─ cult.        tavern waits in the pool. */
function scenario() {
  run('batch', { ops: [
    node('arrival', 'scene', 'Arrival'), node('ledger', 'clue', 'The ledger'), node('warehouse', 'scene', 'Warehouse'),
    node('cove', 'encounter', 'Smugglers’ cove'), node('cult', 'event', 'The bell tolls'), node('rumour', 'clue', 'A rumour'),
    { command: 'create_node', args: { id: 'tavern', type: 'location', title: 'The Rusty Anchor', summary: 'A tavern.', poolHint: 'when they want a drink' } },
    link('arrival', 'ledger'), link('arrival', 'warehouse', 'conditional', 'if they search the docks'), link('ledger', 'cove'), link('warehouse', 'cove'),
    link('cove', 'cult'), link('ledger', 'rumour'), link('rumour', 'cove', 'reveals'),
  ] });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-story-'));
  store = new Store(new Persistence(dir));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('played path', () => {
  it('moves "you are here" along, one active node at a time', () => {
    scenario();
    run('mark_played', { nodeId: 'arrival' });
    expect(run('story_status').here).toEqual([{ id: 'arrival', title: 'Arrival' }]);
    run('mark_played', { nodeId: 'warehouse', after: 'arrival' });
    expect(store.state.nodes.arrival.status).toBe('done'); // the previous node is finished automatically
    expect(store.state.nodes.warehouse.status).toBe('active');
    expect(run('story_status').played.map((p: any) => `${p.seq}:${p.id}`)).toEqual(['1:arrival', '2:warehouse']);
  });

  it('an improvised pool node that is visited joins the story map, placed next to where the players came from', () => {
    scenario();
    run('mark_played', { nodeId: 'arrival' });
    const r = run('mark_played', { nodeId: 'tavern', after: 'arrival' });
    expect(r).toMatchObject({ status: 'active', placed: true, linkedFrom: 'arrival', seq: 2 });
    const p = store.state.graph.placements.tavern;
    expect(p).toBeDefined();
    expect(store.state.graph.edges.some((e) => e.from === 'arrival' && e.to === 'tavern' && e.kind === 'leads-to')).toBe(true);
    expect(run('story_status').played.map((x: any) => x.id)).toEqual(['arrival', 'tavern']);
    // it is one undo step: the tavern goes back to the pool and the link disappears
    store.undo();
    expect(store.state.graph.placements.tavern).toBeUndefined();
    expect(store.state.graph.edges.some((e) => e.to === 'tavern')).toBe(false);
    expect(store.state.nodes.arrival.status).toBe('active');
  });

  it('skipping records no path position', () => {
    scenario();
    run('mark_played', { nodeId: 'ledger', status: 'skipped' });
    expect(store.state.nodes.ledger).toMatchObject({ status: 'skipped' });
    expect(run('story_status').played).toEqual([]);
    expect(run('story_status').skippedPast.map((x: any) => [x.id, x.explicit])).toEqual([['ledger', true]]);
  });
});

describe('a party that splits up', () => {
  it('each group has its own position and trail; a node stays active while any group is on it', () => {
    scenario();
    run('mark_played', { nodeId: 'arrival' });
    run('mark_played', { nodeId: 'arrival', status: 'done' }); // the party leaves the harbour…
    run('mark_played', { nodeId: 'ledger', group: 'Anna', after: 'arrival' }); // …Anna follows the ledger
    run('mark_played', { nodeId: 'warehouse', group: 'Ben', after: 'arrival' }); // …Ben searches the warehouse
    const st = run('story_status');
    expect(st.groups.map((g: any) => [g.group, g.here.map((h: any) => h.id)])).toEqual([['party', []], ['Anna', ['ledger']], ['Ben', ['warehouse']]]);
    expect(st.here.map((h: any) => h.id).sort()).toEqual(['ledger', 'warehouse']); // two heres at once
    expect(store.state.nodes.ledger.status).toBe('active');
    expect(store.state.nodes.warehouse.status).toBe('active');
    expect(st.groups.find((g: any) => g.group === 'Anna').path.map((p: any) => p.id)).toEqual(['ledger']);
    // moving one group does not disturb the other
    run('mark_played', { nodeId: 'cove', group: 'Ben', after: 'warehouse' });
    expect(store.state.nodes.warehouse.status).toBe('done');
    expect(store.state.nodes.ledger.status).toBe('active'); // Anna is still there
  });

  it('shows where the groups can come together again, and rejoining is just both marking the same node', () => {
    scenario();
    run('mark_played', { nodeId: 'arrival', status: 'done' });
    run('mark_played', { nodeId: 'ledger', group: 'Anna', after: 'arrival' });
    run('mark_played', { nodeId: 'warehouse', group: 'Ben', after: 'arrival' });
    const st = run('story_status');
    expect(st.meetingPoints).toEqual([{ id: 'cove', title: 'Smugglers’ cove', groups: ['Anna', 'Ben'] }]); // both roads lead to the cove
    expect(st.frontier[0]).toMatchObject({ id: 'cove', converges: true, groups: ['Anna', 'Ben'] });
    run('mark_played', { nodeId: 'cove', group: 'Anna' });
    run('mark_played', { nodeId: 'cove', group: 'Ben' });
    expect(store.state.nodes.cove.status).toBe('active');
    run('mark_played', { nodeId: 'cult', group: 'Anna', after: 'cove' });
    expect(store.state.nodes.cove.status).toBe('active'); // Ben is still at the cove
    expect(run('story_status').groups.find((g: any) => g.group === 'Ben').here.map((h: any) => h.id)).toEqual(['cove']);
    // the arrival fork counts as fully taken (one group each way); only the ledger's rumour road was left
    expect(run('story_status').untaken.map((u: any) => `${u.fromTitle}→${u.toTitle}`)).toEqual(['The ledger→A rumour']);
  });

  it('draws each group\'s trail, with a split-off group continuing from where the party branched', () => {
    scenario();
    run('mark_played', { nodeId: 'arrival', status: 'done' });
    run('mark_played', { nodeId: 'ledger', group: 'Anna', after: 'arrival' });
    run('mark_played', { nodeId: 'warehouse', group: 'Ben', after: 'arrival' });
    run('mark_played', { nodeId: 'cove', group: 'Ben' });
    const edge = (a: string, b: string) => store.state.graph.edges.find((e) => e.from === a && e.to === b)!.id;
    const t = trailEdges(store.state);
    expect(t.get(edge('arrival', 'ledger'))).toBe('Anna');
    expect(t.get(edge('arrival', 'warehouse'))).toBe('Ben');
    expect(t.get(edge('warehouse', 'cove'))).toBe('Ben');
    expect(t.has(edge('ledger', 'cove'))).toBe(false); // Anna hasn't gone that way
  });

  it('old single-party tracking (playedSeq only) is read as one party', () => {
    scenario();
    store.transact('user', 'legacy', (tx) => {
      tx.putNode({ ...tx.requireNode('arrival'), status: 'done', fields: { playedSeq: 1 } });
      tx.putNode({ ...tx.requireNode('ledger'), status: 'active', fields: { playedSeq: 2 } });
    });
    const st = run('story_status');
    expect(st.groups).toEqual([{ group: 'party', members: [], here: [{ id: 'ledger', title: 'The ledger' }], path: expect.any(Array) }]);
    run('mark_played', { nodeId: 'cove', after: 'ledger' });
    expect(store.state.nodes.ledger.status).toBe('done');
    expect(run('story_status').played.map((p: any) => p.id)).toEqual(['arrival', 'ledger', 'cove']);
  });
});

describe('detours', () => {
  it('a dead-end detour still shows where the main line can be re-entered, and the location steps aside when the next node starts', () => {
    scenario();
    run('mark_played', { nodeId: 'arrival', status: 'done' });
    run('mark_played', { nodeId: 'tavern', after: 'arrival' }); // a pool location: joins the map
    run('create_node', { type: 'encounter', title: 'Tavern brawl', summary: 'Sailors fight.', place: 'canvas', id: 'brawl' });
    run('mark_played', { nodeId: 'brawl', after: 'tavern' });
    expect(store.state.nodes.tavern.status).toBe('done'); // not two "here" nodes
    expect(run('story_status').here).toEqual([{ id: 'brawl', title: 'Tavern brawl' }]);
    const fr = run('story_status').frontier;
    // the brawl leads nowhere, yet the plan still has ways back in; the cove (where two paths meet) comes first
    expect(fr.length).toBeGreaterThan(0);
    expect(fr[0]).toMatchObject({ id: 'cove', converges: true, fromHere: false });
    expect(fr.map((x: any) => x.id)).toEqual(expect.arrayContaining(['ledger', 'warehouse']));
  });
});

describe('reconverge report: "how do we get back, what did they miss?"', () => {
  it('after taking the warehouse road: ledger was bypassed, the fork is listed, the rumour is unknown, cove is where paths meet', () => {
    scenario();
    run('mark_played', { nodeId: 'arrival' });
    run('mark_played', { nodeId: 'warehouse', after: 'arrival' });
    let st = run('story_status');
    // not yet "skipped past": nothing beyond it has been played
    expect(st.skippedPast).toEqual([]);
    expect(st.untaken).toEqual([{ from: 'arrival', fromTitle: 'Arrival', to: 'ledger', toTitle: 'The ledger', label: '' }]);
    expect(st.frontier[0]).toMatchObject({ id: 'cove', hops: 1, converges: true }); // two planned paths meet here: the natural merge point
    expect(st.frontier.map((f: any) => f.id)).toContain('cult');
    run('mark_played', { nodeId: 'cove', after: 'warehouse' });
    st = run('story_status');
    expect(st.skippedPast.map((x: any) => x.id)).toEqual(['ledger']); // now it was truly bypassed
    // the players don't know either clue; the rumour would have opened the cove for them
    expect(st.unrevealed.map((u: any) => [u.id, u.opens])).toEqual([['ledger', []], ['rumour', ['Smugglers’ cove']]]);
    expect(st.frontier.map((f: any) => f.id)).toEqual(['cult']);
  });

  it('what the players learned is tracked and never listed as missing', () => {
    scenario();
    expect(run('story_status').unrevealed.map((u: any) => u.id).sort()).toEqual(['ledger', 'rumour']);
    run('set_known', { nodeId: 'rumour', known: true });
    expect(run('story_status').unrevealed.map((u: any) => u.id)).toEqual(['ledger']);
    run('mark_played', { nodeId: 'ledger', status: 'done' });
    expect(run('story_status').unrevealed).toEqual([]); // having played the clue = knowing it
  });
});

describe('linter', () => {
  const codes = () => lintStory(store.state).map((i) => `${i.code}:${i.nodeId ?? ''}`);

  it('a well-formed story has no warnings', () => {
    scenario();
    expect(lintStory(store.state).filter((i) => i.level === 'warn')).toEqual([]);
  });

  it('finds decisions without branches, unfindable clues, thin key nodes, dead ends and separate chains', () => {
    scenario();
    run('batch', { ops: [
      node('fork', 'decision', 'Left or right?'), link('cult', 'fork'), node('left', 'scene', 'Left door'), link('fork', 'left'),
      node('lost-clue', 'clue', 'Lost clue'), node('island', 'scene', 'Island scene'), node('island2', 'scene', 'Island next'), link('island', 'island2'),
      { command: 'update_node', args: { id: 'cove', tags: ['key'] } },
    ] });
    const c = codes();
    expect(c).toContain('decision-branches:fork');   // one way forward only
    expect(c).toContain('clue-unreachable:lost-clue'); // nothing leads to it
    expect(c).not.toContain('three-clues:cove');      // cove has three ways in (ledger, warehouse, rumour): fine
    expect(c).toContain('separate-chain:island');     // a second chain nobody can enter
    expect(c).toContain('dead-end:island2');
  });

  it('the three-clue rule counts distinct ways in', () => {
    scenario();
    run('update_node', { id: 'cove', tags: ['key'] });
    expect(codes()).not.toContain('three-clues:cove'); // warehouse, ledger, rumour = three
    run('unlink', { from: 'rumour', to: 'cove' });
    expect(codes()).toContain('three-clues:cove'); // now only two
  });

  it('flags a full clock, an empty summary and an unlinked mention', () => {
    scenario();
    run('create_node', { type: 'clock', title: 'The cult’s ritual', summary: 'Ticks while the players dawdle.', fields: { segments: 4, filled: 3, consequence: 'The tide stops.' }, place: 'canvas' });
    const id = store.history.length ? Object.keys(store.state.nodes).find((k) => k.startsWith('the-cult')) : undefined;
    expect(id).toBeTruthy();
    expect(codes()).not.toContain(`clock-full:${id}`);
    expect(run('advance_clock', { nodeId: id })).toMatchObject({ filled: 4, full: true, consequence: 'The tide stops.' });
    expect(store.state.nodes[id!].status).toBe('active'); // due now
    expect(codes()).toContain(`clock-full:${id}`);
    expect(run('advance_clock', { nodeId: id, by: -3 })).toMatchObject({ filled: 1, full: false });
    expect(() => run('advance_clock', { nodeId: 'arrival' })).toThrow(/not a clock/);
    // an unlinked mention
    run('update_node', { id: 'arrival', body: 'Everyone in the harbour whispers about the Warehouse.' });
    run('unlink', { from: 'arrival', to: 'warehouse' });
    expect(codes()).toContain('unlinked-mention:arrival');
  });
});

describe('splitting the party by characters (move_players)', () => {
  const pc = (id: string, title: string) => ({ command: 'create_node', args: { id, type: 'pc', title, summary: '', place: 'pool' } });
  const setup = () => {
    scenario();
    run('batch', { ops: [pc('pc-a', 'Anna Roth'), pc('pc-b', 'Ben Kuhn'), pc('pc-c', 'Cho Lin'), pc('pc-d', 'Dana Voss')] });
    run('mark_played', { nodeId: 'arrival' });
  };
  const groupOf = (id: string) => store.state.nodes[id].fields.group;

  it('two players go one way, two the other — each keeps its own marker and trail', () => {
    setup();
    const a = run('move_players', { characters: ['Anna', 'pc-b'], nodeId: 'ledger' });
    expect(a.group).toBe('Anna & Ben');
    expect(groupOf('pc-a')).toBe('Anna & Ben');
    expect(groupOf('pc-c')).toBe('Cho & Dana');
    const b = run('move_players', { characters: ['Cho', 'Dana'], nodeId: 'warehouse' });
    expect(b.group).toBe('Cho & Dana');
    const st = run('story_status');
    expect(st.groups.map((g: any) => g.group).sort()).toEqual(['Anna & Ben', 'Cho & Dana']);
    expect(st.groups.find((g: any) => g.group === 'Anna & Ben').members).toEqual(['Anna Roth', 'Ben Kuhn']);
    expect(st.here.map((h: any) => h.id).sort()).toEqual(['ledger', 'warehouse']);
  });

  it('everybody meeting again becomes the plain "party"', () => {
    setup();
    run('move_players', { characters: ['Anna', 'Ben'], nodeId: 'ledger' });
    run('move_players', { characters: ['Cho', 'Dana'], nodeId: 'warehouse' });
    run('move_players', { characters: ['Anna', 'Ben'], nodeId: 'cove' });
    const r = run('move_players', { characters: ['Cho', 'Dana'], nodeId: 'cove' });
    expect(r.group).toBe('party');
    expect(groupOf('pc-a')).toBeUndefined();
    expect(run('story_status').here.map((h: any) => h.id)).toEqual(['cove']);
  });

  it('moving one player out of a pair leaves the other behind under a new name; one undo step', () => {
    setup();
    run('move_players', { characters: ['Anna', 'Ben'], nodeId: 'ledger' });
    run('move_players', { characters: ['Ben'], nodeId: 'warehouse' });
    expect(groupOf('pc-a')).toBe('Anna');
    expect(groupOf('pc-b')).toBe('Ben');
    const here = run('story_status').here.map((h: any) => h.id).sort();
    expect(here).toEqual(['arrival', 'ledger', 'warehouse']); // Cho & Dana wait at the arrival
    store.undo();
    expect(groupOf('pc-b')).toBe('Anna & Ben');
  });

  it('rejects unknown characters', () => {
    setup();
    expect(() => run('move_players', { characters: ['Zed'], nodeId: 'ledger' })).toThrow(/No player character/);
  });
});

describe('table status and unmarked connections', () => {
  it('active is only a marker (several at once, nobody moves); untouched forgets the visit', () => {
    scenario();
    run('mark_played', { nodeId: 'arrival' });
    run('set_status', { nodeId: 'ledger', status: 'active' });
    run('set_status', { nodeId: 'cult', status: 'active' });
    expect(store.state.nodes.ledger.status).toBe('active');
    expect(store.state.nodes.cult.status).toBe('active');
    expect(run('story_status').here.map((h: any) => h.id)).toEqual(['arrival']);
    run('set_status', { nodeId: 'arrival', status: 'untouched' });
    expect(store.state.nodes.arrival.status).toBe('untouched');
    expect(run('story_status').played.map((p: any) => p.id)).not.toContain('arrival');
    run('set_status', { nodeId: 'ledger', status: 'done' });
    expect(run('story_status').played.map((p: any) => p.id)).toContain('ledger');
  });

  it('a connection can be unmarked on the played path (and marked again)', () => {
    scenario();
    run('mark_played', { nodeId: 'arrival' });
    run('mark_played', { nodeId: 'ledger', after: 'arrival' });
    const edge = store.state.graph.edges.find((e) => e.from === 'arrival' && e.to === 'ledger')!;
    const trail = () => trailEdges({ meta: store.state.meta, nodes: store.state.nodes, graph: store.state.graph } as any);
    expect(trail().has(edge.id)).toBe(true);
    run('relink', { edgeId: edge.id, noTrail: true });
    expect(trail().has(edge.id)).toBe(false);
    run('relink', { edgeId: edge.id, noTrail: false });
    expect(trail().has(edge.id)).toBe(true);
    expect(store.state.graph.edges.find((e) => e.id === edge.id)!.noTrail).toBeUndefined();
  });
});

describe('players at several nodes at once (set_here)', () => {
  it('marks all of them here, settles the old place, and still allows moving on', () => {
    scenario();
    run('mark_played', { nodeId: 'arrival' });
    run('set_here', { nodeIds: ['ledger', 'warehouse'] });
    expect(run('story_status').here.map((h: any) => h.id).sort()).toEqual(['ledger', 'warehouse']);
    expect(store.state.nodes.arrival.status).toBe('done');
    run('set_here', { nodeIds: ['warehouse', 'tavern'] });
    expect(run('story_status').here.map((h: any) => h.id).sort()).toEqual(['tavern', 'warehouse']);
    expect(store.state.graph.placements.tavern).toBeDefined();
    store.undo();
    expect(run('story_status').here.map((h: any) => h.id).sort()).toEqual(['ledger', 'warehouse']);
  });
});

describe('player wiki (spoiler-safe)', () => {
  it('lists only what the players experienced or learned, with player-facing text only', () => {
    scenario();
    run('batch', { ops: [
      { command: 'create_node', args: { id: 'brenn', type: 'npc', title: 'Brenn', summary: 'GM: Brenn is a cultist.', readAloud: 'A broad man polishes a glass.', body: 'SECRET: Brenn is a cultist.', place: 'pool' } },
      { command: 'update_node', args: { id: 'arrival', readAloud: 'Fog rolls over Greywater.', body: 'GM: the fog is magical' } },
    ] });
    run('mark_played', { nodeId: 'arrival' });
    run('mark_played', { nodeId: 'ledger', after: 'arrival' });
    run('set_known', { nodeId: 'ledger', known: true });
    const w = run('player_wiki');
    expect(w.story.map((e: any) => e.title)).toEqual(['Arrival']); // the ledger is a clue: it is listed under "learned"
    expect(w.learned.map((e: any) => e.title)).toEqual(['The ledger']);
    expect(w.people).toEqual([]); // Brenn was never met
    expect(w.markdown).toContain('Fog rolls over Greywater.');
    expect(w.markdown).not.toMatch(/SECRET|magical|cove|warehouse/i);
    run('set_known', { nodeId: 'brenn', known: true });
    const again = run('player_wiki');
    expect(again.people.map((e: any) => e.title)).toEqual(['Brenn']);
    expect(again.markdown).toContain('A broad man polishes a glass.');
    expect(again.markdown).not.toContain('cultist'); // neither the summary nor the notes
  });

  it('shows which part of a split party experienced a story step, and exports a markdown file', () => {
    scenario();
    run('batch', { ops: [{ command: 'create_node', args: { id: 'pc-a', type: 'pc', title: 'Anna', place: 'pool' } }, { command: 'create_node', args: { id: 'pc-b', type: 'pc', title: 'Ben', place: 'pool' } }] });
    run('mark_played', { nodeId: 'arrival' });
    run('move_players', { characters: ['Anna'], nodeId: 'ledger' });
    run('move_players', { characters: ['Ben'], nodeId: 'warehouse' });
    const w = run('player_wiki');
    expect(w.story.find((e: any) => e.id === 'warehouse').group).toBe('Ben');
    const r = run('export_player_wiki', {});
    expect(fs.readFileSync(path.join(store.exportsDir, r.file), 'utf8')).toContain('## The story so far');
  });
});

describe('random tables', () => {
  const mk = () => run('create_node', { id: 'weather', type: 'table', title: 'Harbour weather', place: 'canvas' });

  it('weights make entries more likely; the die is the number of faces; a seed reproduces a roll', () => {
    mk();
    const r = run('set_table', { nodeId: 'weather', entries: ['Fog', '3× Rain', 'Clear'] });
    expect(r).toMatchObject({ entries: 3, die: 'd5' });
    expect(store.state.nodes.weather.fields.entries).toEqual(['Fog', '3× Rain', 'Clear']);
    const a = run('roll_table', { nodeId: 'weather', times: 4, seed: 7 });
    const b = run('roll_table', { nodeId: 'weather', times: 4, seed: 7 });
    expect(a.results).toEqual(b.results);
    expect(a.results.every((x: any) => x.roll >= 1 && x.roll <= 5)).toBe(true);
    let rain = 0;
    for (let i = 0; i < 300; i++) if (run('roll_table', { nodeId: 'weather', seed: i }).results[0].result === 'Rain') rain++;
    expect(rain).toBeGreaterThan(130); // 3 of 5 faces
    expect(store.state.nodes.weather.fields.last).toBeTruthy();
    expect((store.state.nodes.weather.fields.history as unknown[]).length).toBeLessThanOrEqual(12);
  });

  it('append adds entries, only table nodes can be filled, empty tables cannot be rolled', () => {
    mk();
    expect(() => run('roll_table', { nodeId: 'weather' })).toThrow(/no entries/);
    run('set_table', { nodeId: 'weather', entries: ['A', 'B'] });
    run('set_table', { nodeId: 'weather', entries: ['C'], append: true });
    expect(store.state.nodes.weather.fields.entries).toEqual(['A', 'B', 'C']);
    expect(() => run('set_table', { nodeId: 'arrival', entries: ['x'] })).toThrow();
  });
});

describe('frames', () => {
  it('a frame fits around nodes, moves them with it, and undo restores everything', () => {
    scenario();
    const before = { ...store.state.graph.placements };
    const f = run('create_frame', { title: 'Harbour', nodeIds: ['arrival', 'ledger'] });
    expect(f.id).toBe('frame-harbour');
    const frame = store.state.graph.frames[0];
    for (const id of ['arrival', 'ledger']) {
      const p = store.state.graph.placements[id];
      expect(p.x).toBeGreaterThan(frame.x);
      expect(p.x + 280).toBeLessThan(frame.x + frame.w);
    }
    const r = run('move_frame', { id: f.id, dx: 100, dy: -50 });
    expect(r.moved.sort()).toEqual(expect.arrayContaining(['arrival', 'ledger']));
    expect(store.state.graph.placements.arrival.x).toBe(before.arrival.x + 100);
    expect(store.state.graph.frames[0].x).toBe(frame.x + 100);
    expect(store.state.graph.placements.cult.x).toBe(before.cult.x); // outside: stayed
    store.undo();
    expect(store.state.graph.placements.arrival.x).toBe(before.arrival.x);
    expect(store.state.graph.frames[0].x).toBe(frame.x);
    store.undo();
    expect(store.state.graph.frames).toEqual([]);
  });

  it('tells the view (graph.meta event), rejects pool nodes and unknown frames, can rename and delete', () => {
    scenario();
    let events: any[] = [];
    store.subscribe((b) => (events = b.events));
    run('create_frame', { title: 'Act I', x: 0, y: 0, w: 600, h: 300, color: '#ff7a9c' });
    expect(events.find((e) => e.type === 'graph.meta').frames[0]).toMatchObject({ title: 'Act I', color: '#ff7a9c' });
    run('update_frame', { id: 'frame-act-i', title: 'Act One' });
    expect(store.state.graph.frames[0].title).toBe('Act One');
    expect(() => run('create_frame', { title: 'x', nodeIds: ['tavern'] })).toThrow(/pool/);
    expect(() => run('move_frame', { id: 'nope', dx: 1, dy: 1 })).toThrow(/No frame/);
    run('delete_frame', { id: 'frame-act-i' });
    expect(store.state.graph.frames).toEqual([]);
    run('create_canvas', { name: 'Act II' });
    expect(events.some((e) => e.type === 'graph.meta' && e.canvases.length === 2)).toBe(true);
  });
});
