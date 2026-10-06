import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { binderHtml, binderParts, mdToHtml, storyMapSvg, storyOrder } from '../src/binder.js';
import { newMap, renderSvg, toPng } from '../src/maps.js';
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

  describe('table prints', () => {
    /** a handout with a picture, a handout with only text, a place with two pictures and a battle map */
    function printable() {
      fs.mkdirSync(store.imagesDir, { recursive: true });
      const wide = toPng(renderSvg(newMap('w', 'w', 'battle', 12, 6), 'preview'), 600); // landscape
      const tall = toPng(renderSvg(newMap('t', 't', 'battle', 6, 12), 'preview'), 600); // portrait
      fs.writeFileSync(path.join(store.imagesDir, 'letter.png'), tall);
      fs.writeFileSync(path.join(store.imagesDir, 'harbour.png'), wide);
      fs.writeFileSync(path.join(store.imagesDir, 'harbour-night.png'), wide);
      run('batch', { ops: [node('letter', 'handout', 'The torn letter', { place: 'pool' }), node('rumour', 'handout', 'A rumour', { place: 'pool', readAloud: 'They say the bell tolls twelve.' })] });
      store.state.nodes.letter.images = ['letter.png'];
      store.state.nodes.tavern.images = ['harbour.png', 'harbour-night.png'];
      run('create_map', { name: 'Cellar', kind: 'battle', nodeId: 'tavern', cols: 8, rows: 6, unit: 5 });
    }
    const pageCount = (html: string) => (html.match(/<section[^>]*class="print/g) ?? []).length;

    it('prints every handout, map and place picture on a page of its own, the copies one after the other', () => {
      printable();
      const { html, prints } = binderParts(store, { mode: 'prints', copies: { handouts: 3, maps: 2, places: 1 } });
      expect(prints).toEqual({ handouts: 2, maps: 1, places: 2, pages: 2 * 3 + 1 * 2 + 2 * 1 });
      expect(pageCount(html)).toBe(10);
      expect(html.match(/images\/letter\.png/g)).toHaveLength(3);                // three copies of the letter...
      expect(html.indexOf('images/letter.png')).toBeLessThan(html.indexOf('The torn letter') + 1e9);
      const firstThree = html.split('<section class="print').slice(1, 4).join('');
      expect(firstThree.match(/letter\.png/g)).toHaveLength(3);                    // ...one after the other (a stack to hand out)
      expect(html).toContain('<h3>A rumour</h3>');                                   // a handout without picture is printed as text
      expect(html).toContain('They say the bell tolls twelve.');
      expect(html).toContain('Cellar · 1 square = 5 ft');
      expect(html).toContain('class="print land"');                                  // a wide picture gets a landscape page
      expect(html).toMatch(/<section class="print">\s*<img src="images\/letter\.png"/);  // a tall one stays portrait
      expect(html).not.toContain('class="cover"');                                   // prints only: no cover, no contents
      expect(html).not.toContain('Arrival &lt;in&gt; fog');
    });

    it('a kind with no copies is left out; zero everywhere says what is missing', () => {
      printable();
      const onlyMaps = binderParts(store, { mode: 'prints', copies: { maps: 1 } });
      expect(onlyMaps.prints).toEqual({ handouts: 0, maps: 1, places: 0, pages: 1 });
      expect(onlyMaps.html).not.toContain('letter.png');
      const none = binderParts(store, { mode: 'prints', copies: { handouts: 0 } });
      expect(none.prints!.pages).toBe(0);
      expect(none.html).toContain('Nothing to print');
      expect(binderParts(store, { mode: 'prints', copies: { handouts: 999 } }).prints!.pages).toBe(2 * 30); // capped at 30 copies
    });

    it('"both" puts the prints at the end of the binder with a contents entry; the plain binder has none', () => {
      printable();
      const both = binderParts(store, { mode: 'both', copies: { handouts: 2 } });
      expect(both.html).toContain('class="cover"');
      expect(both.html).toContain('Arrival &lt;in&gt; fog');
      expect(both.html).toContain('Table prints (to hand out)');
      expect(both.html).toContain('id="tableprints"');
      expect(both.html.lastIndexOf('class="print')).toBeGreaterThan(both.html.indexOf('The story'));
      const plain = binderParts(store, { copies: { handouts: 2 } }); // copies alone change nothing without a mode
      expect(plain.prints).toBeNull();
      expect(plain.html).not.toContain('class="print');
    });
  });

  const hasWeasy = spawnSync('weasyprint', ['--version']).status === 0;
  it.skipIf(!hasWeasy)('writes a real PDF through export_binder', () => {
    const r = run('export_binder', {});
    const buf = fs.readFileSync(path.join(store.exportsDir, r.file));
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(5000);
  }, 60000);

  it.skipIf(!hasWeasy)('a prints-only PDF has exactly the pages asked for', () => {
    fs.mkdirSync(store.imagesDir, { recursive: true });
    run('batch', { ops: [node('a', 'handout', 'Note A', { place: 'pool', readAloud: 'Text A' }), node('b', 'handout', 'Note B', { place: 'pool', readAloud: 'Text B' })] });
    const r = run('export_binder', { mode: 'prints', copies: { handouts: 3 } });
    const buf = fs.readFileSync(path.join(store.exportsDir, r.file));
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(r.prints).toEqual({ handouts: 2, maps: 0, places: 0, pages: 6 });
    const info = spawnSync('pdfinfo', [path.join(store.exportsDir, r.file)], { encoding: 'utf8' });
    if (info.status === 0) expect(Number(/Pages:\s+(\d+)/.exec(info.stdout)?.[1])).toBe(6); // checked when poppler's pdfinfo is installed
    expect(r.file).toContain('table-prints');
  }, 60000);
});
