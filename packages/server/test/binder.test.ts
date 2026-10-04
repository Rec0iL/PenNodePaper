import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { binderHtml, mdToHtml, storyMapSvg, storyOrder } from '../src/binder.js';
import { runCommand } from '../src/commands.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;
const node = (id: string, type: string, title: string, extra: object = {}) => ({ command: 'create_node', args: { id, type, title, summary: `${title}.`, place: 'canvas', ...extra } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-binder-'));
  store = new Store(new Persistence(dir));
  run('batch', { ops: [
    node('arrival', 'scene', 'Arrival <in> fog', { readAloud: 'Fog rolls over the pier.', body: '**Secret:** the ferryman is a cultist.\n\n- hook one\n- hook two' }),
    node('tavern', 'location', 'The Rusty Anchor'),
    node('brawl', 'encounter', 'Tavern brawl'),
    node('brenn', 'npc', 'Brenn', { place: 'pool', body: 'GM-only: Brenn knows the cult.', fields: { sheet: { hp: 7 } } }),
    node('weather', 'table', 'Harbour weather', { place: 'pool', fields: { entries: ['Fog', '3× Rain'] } }),
    node('later', 'scene', 'A later scene', { place: 'pool' }),
    { command: 'link', args: { from: 'arrival', to: 'brawl', kind: 'leads-to', label: 'if they drink' } },
    { command: 'link', args: { from: 'brenn', to: 'tavern', kind: 'belongs-to' } },
  ] });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('GM binder', () => {
  it('turns the markdown subset into safe HTML', () => {
    const h = mdToHtml('# Title\n\nSome **bold** and *it* <script>x</script>\n\n- a\n- b\n\n> quote');
    expect(h).toContain('<h4>Title</h4>');
    expect(h).toContain('<b>bold</b>');
    expect(h).toContain('<i>it</i>');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('<li>a</li>');
    expect(h).toContain('<blockquote>quote</blockquote>');
  });

  it('puts the story in reading order, the read-aloud in a box, and keeps GM notes out on request', () => {
    expect(storyOrder(store.state).map((n) => n.id)).toEqual(['arrival', 'brawl']);
    const html = binderHtml(store);
    expect(html).toContain('Arrival &lt;in&gt; fog');
    expect(html).toContain('class="aloud"');
    expect(html).toContain('the ferryman is a cultist');
    expect(html).toContain('Brenn knows the cult');
    expect(html).toContain('if they drink');
    expect(html).toContain('Harbour weather');
    expect(html).toContain('d4'); // 1 + 3 faces
    expect(html).toContain('A later scene'); // prepared material
    const clean = binderHtml(store, { notes: false });
    expect(clean).not.toContain('the ferryman is a cultist');
    expect(clean).not.toContain('Brenn knows the cult');
    expect(clean).toContain('Fog rolls over the pier.');
  });

  it('every connection names the chapter of its target and carries a page reference; missing targets say so', () => {
    const html = binderHtml(store);
    expect(html).toMatch(/Tavern brawl<\/a>[^]*?· The story, <a class="pg" href="#n-brawl">/);
    expect(html).toMatch(/The Rusty Anchor<\/a>[^]*?· Places, <a class="pg" href="#n-tavern">/);
    expect(html).toContain('target-counter(attr(href), page)');
    const partial = binderHtml(store, { sections: ['people'] });
    expect(partial).toContain('The Rusty Anchor');
    expect(partial).not.toContain('href="#n-tavern"'); // places are not in this binder: no dead link
    expect(partial).toContain('not in this binder');
  });

  it('sections can be chosen, and the story map is an svg with the nodes', () => {
    const only = binderHtml(store, { sections: ['tables'] });
    expect(only).toContain('Harbour weather');
    expect(only).not.toContain('Fog rolls over');
    const svg = storyMapSvg(store.state, store.state.graph.canvases[0].id);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Tavern brawl');
    expect(svg).toContain('if they drink');
    expect(svg).not.toContain('paint-order'); // WeasyPrint ignores it: labels used to vanish
  });

  const hasWeasy = spawnSync('weasyprint', ['--version']).status === 0;
  it.skipIf(!hasWeasy)('writes a real PDF through export_binder', () => {
    const r = run('export_binder', {});
    const buf = fs.readFileSync(path.join(store.exportsDir, r.file));
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(5000);
  }, 60000);
});
