import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/commands.js';
import { extractText, Imports } from '../src/imports.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-imp-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('imported notes', () => {
  it('stores text, lists it and reads it back in line-aligned chunks until next is null', () => {
    const imp = new Imports(path.join(dir, 'imports'));
    const text = Array.from({ length: 400 }, (_, i) => `Line ${i}: the harbour at night`).join('\n');
    const info = imp.save('Session Notes.md', text);
    expect(info.name).toBe('session-notes');
    expect(imp.list().map((i) => i.name)).toEqual(['session-notes']);
    let off = 0;
    let got = '';
    for (let n = 0; n < 50; n++) {
      const c = imp.read('Session Notes.md', off, 3000);
      expect(c.text.endsWith('\n') || c.next === null).toBe(true);
      got += c.text;
      if (c.next === null) break;
      off = c.next;
    }
    expect(got.trim()).toBe(text);
    expect(() => imp.read('nope')).toThrow(/No import/);
    expect(() => imp.save('empty', '  \n')).toThrow(/no text/);
    imp.remove('session-notes');
    expect(imp.list()).toEqual([]);
  });

  it('reads markdown/text as is and refuses unknown formats', () => {
    expect(extractText(Buffer.from('# Titel\nText'), 'a.md')).toBe('# Titel\nText');
    expect(() => extractText(Buffer.from('x'), 'a.xyz')).toThrow(/Cannot read/);
  });

  it('the AI tools list and read imports through the command layer', () => {
    const store = new Store(new Persistence(dir));
    store.imports.save('notes.txt', 'Brenn the barkeep hides a secret.');
    expect(runCommand(store, 'list_imports', {}, 'claude')).toMatchObject([{ name: 'notes' }]);
    expect(runCommand(store, 'read_import', { name: 'notes' }, 'claude')).toMatchObject({ next: null, text: expect.stringContaining('Brenn') });
  });
});
