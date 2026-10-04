import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { knowledgeBlock } from '../src/chat.js';
import { runCommand } from '../src/commands.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;

// a deliberately large world: 60 regions x ~700 chars
const big = () => {
  let md = '# Aethermoor\n\nA drowned continent ruled by tide-priests.\n\n';
  for (let i = 0; i < 60; i++)
    md += `## Region ${i}\n\nThe region of Veldrath-${i} lies beyond the salt marsh. ${'Its people trade amber and whisper old oaths. '.repeat(14)}\n\n### Ruler ${i}\n\nLord Orsolin-${i} keeps the lighthouse key.\n\n`;
  md += '## Forbidden Archive\n\nThe Archive hides the Drowned Crown, which can silence the tides.\n';
  return md;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-w-'));
  store = new Store(new Persistence(dir));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('world books (library files next to the rulebooks)', () => {
  it('lives in worldbooks/ as plain markdown and survives a reload', () => {
    store.world.add('Aethermoor', big());
    store.world.setSummary('aethermoor', 'Drowned continent, tide-priests.');
    expect(fs.existsSync(path.join(dir, 'worldbooks', 'aethermoor.md'))).toBe(true);
    const again = new Store(new Persistence(dir));
    expect(again.world.list()[0]).toMatchObject({ name: 'aethermoor' });
    expect(again.world.summary('aethermoor')).toContain('tide-priests');
    expect(again.rulebooks.list()).toEqual([]); // separate from rulebooks
  });

  it('gives the AI a compact digest even when the book is massive', () => {
    store.world.add('aethermoor', big());
    store.world.setSummary('aethermoor', 'Drowned continent ruled by tide-priests; Archive holds the Drowned Crown.');
    expect(store.world.list()[0].chars).toBeGreaterThan(40000);
    const block = knowledgeBlock(store);
    expect(block.length).toBeLessThan(1500);
    expect(block).toContain('tide-priests');
    expect(block).toContain('Forbidden Archive'); // end of the book stays visible in the outline
    expect(block).toContain('search_world');
  });

  it('finds facts deep inside the text and reads a single section', () => {
    store.world.add('aethermoor', big());
    const hits = run('search_world', { query: 'Drowned Crown tides' });
    expect(hits[0].title).toContain('Forbidden Archive');
    expect(run('get_world_section', { id: hits[0].id }).text).toContain('silence the tides');
    expect(run('search_world', { query: 'Orsolin-37', book: 'aethermoor' })[0].title).toContain('Ruler 37');
    const list = run('list_world_chapters', { depth: 2 });
    expect(list.books[0].name).toBe('aethermoor');
    expect(list.chapters.length).toBeGreaterThan(50);
  });

  it('write_world replaces/appends, backs up, re-indexes and tracks the summary', () => {
    run('write_world', { book: 'lore', text: '# Lore\n\nalpha text\n', summary: 'Alpha.' });
    expect(run('search_world', { query: 'zebra' })).toEqual([]);
    const r = run('write_world', { book: 'lore', mode: 'append', text: '## Fauna\n\nstriped zebra herds\n' });
    expect(r.summary).toBe('kept');
    expect(run('search_world', { query: 'zebra' })[0].title).toContain('Fauna');
    expect(store.world.text('lore')).toContain('alpha text'); // append kept the old text
    expect(fs.readdirSync(path.join(dir, 'worldbooks', '.bak')).length).toBe(1);
    run('set_world_summary', { book: 'lore', summary: 'Alpha plus fauna.' });
    expect(store.world.summary('lore')).toBe('Alpha plus fauna.');
    expect(() => run('set_world_summary', { book: 'nope', summary: 'x' })).toThrow();
    store.world.remove('lore');
    expect(run('search_world', { query: 'zebra' })).toEqual([]);
  });

  it('autosave backups are throttled, explicit writes always back up, and backups are pruned', () => {
    const bak = () => fs.readdirSync(path.join(dir, 'worldbooks', '.bak')).length;
    store.world.add('lore', '# L\n\nv1\n', { backup: 'throttled' });
    expect(fs.existsSync(path.join(dir, 'worldbooks', '.bak'))).toBe(false); // nothing to back up yet
    store.world.add('lore', '# L\n\nv2\n', { backup: 'throttled' });
    expect(bak()).toBe(1);
    for (let i = 3; i < 12; i++) store.world.add('lore', `# L\n\nv${i}\n`, { backup: 'throttled' }); // keystroke-rate autosaves
    expect(bak()).toBe(1); // still just the one
    store.world.add('lore', '# L\n\nAI rewrite\n'); // explicit write -> always backs up
    expect(bak()).toBe(2);
    store.world.add('lore', '# L\n\nAI rewrite\n'); // identical content -> no new backup
    expect(bak()).toBe(2);
  });

  it('rulebook tools work and the digest persists', () => {
    store.rulebooks.add('kin', '# Regeln\n\n## Würfe\n\nWürfle 2W6.\n');
    expect(run('search_rules', { query: 'würfel würfe' })[0].id).toBe('kin#wurfe');
    expect(run('get_section', { id: 'kin#wurfe' }).text).toContain('2W6');
    run('set_rules_digest', { text: 'Core: 2W6.' });
    expect(store.rulebooks.digest).toBe('Core: 2W6.');
  });
});
