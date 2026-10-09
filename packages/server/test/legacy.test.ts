import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { replacePortals } from '../src/legacy.js';
import { Persistence, isLegacyPortal } from '../src/persistence.js';
import { Store } from '../src/store.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-legacy-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const nodeFile = (id: string, type: string, extra = '') => `---\nid: ${id}\ntype: ${type}\ntitle: ${id}\nsummary: ${id}.\nstatus: untouched\ntags: []\n${extra}createdAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n\nNotes for ${id}.\n`;

/** hook ─leads-to "sail"→ [portal door] ─bridge→ arrive (on another canvas), plus an ordinary hook → market */
function legacyCampaign() {
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  for (const [id, type] of [['hook', 'scene'], ['market', 'scene'], ['arrive', 'scene']]) fs.writeFileSync(path.join(dir, 'nodes', `${id}.md`), nodeFile(id, type));
  fs.writeFileSync(path.join(dir, 'nodes', 'door.md'), nodeFile('door', 'portal', 'fields:\n  canvas: act2\n  nodeId: arrive\n'));
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify({
    version: 1,
    canvases: [{ id: 'main', name: 'Main' }, { id: 'act2', name: 'Act II' }],
    placements: { hook: { canvas: 'main', x: 0, y: 0 }, market: { canvas: 'main', x: 300, y: 0 }, door: { canvas: 'main', x: 600, y: 0 }, arrive: { canvas: 'act2', x: 0, y: 0 } },
    edges: [
      { id: 'e1', from: 'hook', to: 'market', kind: 'leads-to', label: '' },
      { id: 'e2', from: 'hook', to: 'door', kind: 'conditional', label: 'sail' },
      { id: 'e3', from: 'door', to: 'arrive', kind: 'bridge', label: '' },
    ],
    frames: [],
  }));
}

describe('portal nodes from older campaigns', () => {
  it('are recognised by the frontmatter type, not by text elsewhere', () => {
    expect(isLegacyPortal(nodeFile('x', 'portal'))).toBe(true);
    expect(isLegacyPortal(nodeFile('x', 'scene'))).toBe(false);
    expect(isLegacyPortal(nodeFile('x', 'scene', 'fields:\n  type: portal\n'))).toBe(false); // an indented field called type
    expect(isLegacyPortal(`${nodeFile('x', 'scene')}\ntype: portal\n`)).toBe(false);          // a line in the body
  });

  it('become the connection they stood for when the campaign is opened: what led in now leads to where it arrived', () => {
    legacyCampaign();
    const state = new Store(new Persistence(dir)).state;
    expect(state.nodes.door).toBeUndefined();
    expect(state.graph.placements.door).toBeUndefined();
    const direct = state.graph.edges.find((e) => e.from === 'hook' && e.to === 'arrive');
    expect(direct).toMatchObject({ kind: 'conditional', label: 'sail' }); // same kind and wording as the way in
    expect(state.graph.edges.some((e) => e.from === 'door' || e.to === 'door')).toBe(false);
    expect(state.graph.edges.find((e) => e.id === 'e1')).toBeTruthy();    // the ordinary connection is untouched
    // saved: a second load changes nothing
    expect(fs.existsSync(path.join(dir, 'nodes', 'door.md'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'nodes', '.legacy-portals', 'door.md'))).toBe(true);
    const again = new Persistence(dir).load();
    expect(again.graph.edges.filter((e) => e.from === 'hook' && e.to === 'arrive')).toHaveLength(1);
    expect(Object.keys(again.nodes).sort()).toEqual(['arrive', 'hook', 'market']);
  });

  it('chains of portals, portals without a target and duplicates are handled', () => {
    const node = (id: string) => ({ id } as never);
    const s = {
      nodes: { a: node('a'), b: node('b'), p1: node('p1'), p2: node('p2'), p3: node('p3') },
      graph: {
        version: 1 as const, canvases: [], placements: { p1: { canvas: 'm', x: 0, y: 0 } }, frames: [],
        edges: [
          { id: '1', from: 'a', to: 'p1', kind: 'leads-to' as const, label: 'go' }, { id: '2', from: 'p1', to: 'p2', kind: 'bridge' as const, label: '' },
          { id: '3', from: 'p2', to: 'b', kind: 'bridge' as const, label: '' },                                  // a -> p1 -> p2 -> b
          { id: '4', from: 'a', to: 'p3', kind: 'leads-to' as const, label: '' },                                // a -> p3 (no way out)
          { id: '5', from: 'a', to: 'b', kind: 'leads-to' as const, label: 'already there' },                   // the direct connection exists already
        ],
      },
    };
    const r = replacePortals(s as never, ['p1', 'p2', 'p3']);
    expect(r.removed).toEqual(['p1', 'p2', 'p3']);
    expect(Object.keys(s.nodes)).toEqual(['a', 'b']);
    expect(s.graph.edges.map((e) => `${e.from}>${e.to}:${e.label}`)).toEqual(['a>b:already there']); // no second a>b, no loose ends
  });
});
