import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Rulebooks, parseBook } from '../src/rulebook.js';

const MD = `Intro text before any heading.

# Regelwerk

## Kampf

Allgemeines zum Kampf.

### Initiative

Die Initiative bestimmt die Reihenfolge. Würfle 2W6 plus Reflex.

### Nahkampfangriff

Ein Nahkampfangriff nutzt Stärke. Schaden = Waffenwert.

\`\`\`
# not a heading inside a fence
\`\`\`

## Magie

Zauber kosten Energie.

## Kampf

Zweites Kapitel gleichen Namens.
`;

let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-rb-'))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('rulebook', () => {
  it('splits by headings, ignores fenced code, keeps unique ids', () => {
    const b = parseBook('kin', MD);
    const ids = b.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('kin#preface');
    expect(ids).toContain('kin#kampf/initiative');
    expect(b.sections.find((s) => s.title === 'Nahkampfangriff')!.text).toContain('# not a heading inside a fence');
    expect(b.sections.filter((s) => s.title === 'Kampf')).toHaveLength(2);
  });

  it('searches with compound words and ranks title hits first', () => {
    const r = new Rulebooks(dir);
    r.add('kin', MD);
    const hits = r.search('Kampf Initiative');
    expect(hits[0].id).toBe('kin#kampf/initiative');
    // substring match finds compounds: "kampf" in "Nahkampfangriff"
    expect(r.search('kampf').map((h) => h.id)).toContain('kin#kampf/nahkampfangriff');
    expect(r.search('xyzzy')).toEqual([]);
  });

  it('returns a section with its children and persists across reload', () => {
    const r = new Rulebooks(dir);
    r.add('kin', MD);
    const again = new Rulebooks(dir);
    const s = again.section('kin#kampf');
    expect(s.text).toContain('Allgemeines zum Kampf');
    expect(s.text).toContain('Würfle 2W6');
    expect(s.children.map((c) => c.title)).toEqual(['Initiative', 'Nahkampfangriff']);
    expect(again.section('initiative').id).toBe('kin#kampf/initiative'); // fuzzy lookup
    expect(() => again.section('nope#nothing')).toThrow();
  });

  it('digest round-trips', () => {
    const r = new Rulebooks(dir);
    expect(r.digest).toBe('');
    r.setDigest('Core: 2d6 + attribute.');
    expect(r.digest).toBe('Core: 2d6 + attribute.');
    expect(r.list()).toEqual([]); // the digest is not a rulebook
  });
});
