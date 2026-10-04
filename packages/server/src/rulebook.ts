import fs from 'node:fs';
import path from 'node:path';
import { slugify } from '@pnp/shared';

// ---------------------------------------------------------------------------
// Rulebooks: markdown files split by headings into an index the AI (and the GM)
// can query: list chapters, fetch one section, full-text search. The AI pulls
// only what it needs instead of carrying the whole book in context.
// ---------------------------------------------------------------------------

export interface Section {
  id: string; // "<book>#<path>"
  book: string;
  level: number;
  title: string;
  /** Heading trail, e.g. ["Kampf", "Initiative"]. */
  trail: string[];
  text: string; // body text of this section only (without sub-sections)
  parent?: string;
  children: string[];
}

export interface Book {
  name: string;
  chars: number;
  sections: Section[];
}

export interface SearchHit {
  id: string;
  title: string;
  trail: string[];
  snippet: string;
  score: number;
}

const DIGEST_FILE = '_digest.md';
const MAX_SECTION_CHARS = 14000;

export function parseBook(name: string, md: string): Book {
  const sections: Section[] = [];
  const used = new Set<string>();
  const stack: Section[] = [];
  let cur: Section = { id: `${name}#preface`, book: name, level: 0, title: 'Preface', trail: [], text: '', children: [] };
  let inFence = false;
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  // A lone H1 is just the document title: keep it out of the section ids (shorter for the AI).
  let h1s = 0;
  let fenced = false;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    else if (!fenced && /^#\s+\S/.test(l)) h1s++;
  }
  const skipRoot = h1s === 1;

  const flush = () => {
    cur.text = cur.text.trim();
    if (cur.text || cur.level > 0) sections.push(cur);
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (!m) {
      cur.text += `${line}\n`;
      continue;
    }
    flush();
    const level = m[1].length;
    const title = m[2].replace(/[*_`]/g, '').trim();
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    const trail = [...(parent?.trail ?? []), title];
    const idTrail = skipRoot && trail.length > 1 ? trail.slice(1) : trail;
    const base = `${name}#${idTrail.map((t) => slugify(t)).join('/')}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    cur = { id, book: name, level, title, trail, text: '', parent: parent?.id, children: [] };
    parent?.children.push(id);
    stack.push(cur);
  }
  flush();
  return { name, chars: md.length, sections };
}

const lc = (s: string) => s.toLocaleLowerCase('de');
const STOP = new Set(['der', 'die', 'das', 'und', 'oder', 'ein', 'eine', 'the', 'and', 'for', 'with', 'how', 'what', 'ist', 'wie', 'was', 'von', 'mit', 'bei', 'zum', 'zur', 'des', 'den', 'dem']);
const tokens = (q: string) => [...new Set(lc(q).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2 && !STOP.has(t)))];

function count(hay: string, needle: string): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Heading index + search over a set of parsed books (shared by rulebooks and world nodes). */
export class BookSet {
  protected books = new Map<string, Book>();
  protected byId = new Map<string, Section>();
  protected lowered = new Map<string, { title: string; text: string }>();

  protected clear() {
    this.books.clear();
    this.byId.clear();
    this.lowered.clear();
  }

  protected index(b: Book) {
    this.books.set(b.name, b);
    for (const s of b.sections) {
      this.byId.set(s.id, s);
      this.lowered.set(s.id, { title: lc(s.trail.join(' ')), text: lc(s.text) });
    }
  }

  book(name: string): Book | undefined {
    return this.books.get(name);
  }

  list() {
    return [...this.books.values()].map((b) => ({ name: b.name, sections: b.sections.length, chars: b.chars }));
  }

  get empty() {
    return this.books.size === 0;
  }

  /** Table of contents. depth = deepest heading level to include. */
  chapters(book?: string, depth = 2) {
    const out: { id: string; title: string; level: number; chars: number; children: number }[] = [];
    for (const b of this.books.values()) {
      if (book && b.name !== book) continue;
      for (const s of b.sections) {
        if (s.level === 0 || s.level > depth) continue;
        out.push({ id: s.id, title: s.trail.join(' › '), level: s.level, chars: this.subtreeChars(s), children: s.children.length });
      }
    }
    return out;
  }

  private subtreeChars(s: Section): number {
    return s.text.length + s.children.reduce((n, c) => n + (this.byId.get(c) ? this.subtreeChars(this.byId.get(c)!) : 0), 0);
  }

  /** Text of one section; includeChildren appends its sub-sections. */
  section(id: string, includeChildren = true): { id: string; title: string; text: string; truncated: boolean; children: { id: string; title: string }[] } {
    const s = this.byId.get(id) ?? this.fuzzy(id);
    if (!s) throw new Error(`No such section "${id}". Use search_rules or list_chapters to find ids.`);
    const parts: string[] = [];
    const walk = (x: Section) => {
      parts.push(`${'#'.repeat(Math.max(x.level, 1))} ${x.title}\n${x.text}`);
      if (includeChildren) for (const c of x.children) walk(this.byId.get(c)!);
    };
    walk(s);
    let text = parts.join('\n\n').trim();
    const truncated = text.length > MAX_SECTION_CHARS;
    if (truncated) text = `${text.slice(0, MAX_SECTION_CHARS)}\n…[truncated — fetch the sub-sections listed under "children" individually]`;
    return { id: s.id, title: s.trail.join(' › '), text, truncated, children: s.children.map((c) => ({ id: c, title: this.byId.get(c)!.title })) };
  }

  private fuzzy(id: string): Section | undefined {
    const key = lc(id);
    return [...this.byId.values()].find((s) => lc(s.id).endsWith(key) || lc(s.title) === key);
  }

  search(query: string, limit = 8, book?: string): SearchHit[] {
    const qs = tokens(query);
    if (!qs.length) return [];
    const total = this.byId.size || 1;
    const df = new Map(qs.map((t) => [t, 0]));
    for (const l of this.lowered.values()) for (const t of qs) if (l.title.includes(t) || l.text.includes(t)) df.set(t, df.get(t)! + 1);
    const hits: SearchHit[] = [];
    for (const s of this.byId.values()) {
      if (book && s.book !== book) continue;
      const l = this.lowered.get(s.id)!;
      let score = 0;
      let matched = 0;
      for (const t of qs) {
        const inTitle = count(l.title, t);
        const inText = count(l.text, t);
        if (!inTitle && !inText) continue;
        matched++;
        const idf = Math.log(1 + total / (1 + df.get(t)!));
        score += (inTitle * 5 + Math.min(inText, 8)) * idf;
      }
      if (!matched) continue;
      score *= 1 + (matched - 1) * 0.6; // reward covering several query words
      hits.push({ id: s.id, title: s.title, trail: s.trail, snippet: this.snippet(s, qs), score: Math.round(score * 10) / 10 });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private snippet(s: Section, qs: string[]): string {
    const l = this.lowered.get(s.id)!.text;
    let at = -1;
    for (const t of qs) {
      const i = l.indexOf(t);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
    if (at < 0) return s.text.slice(0, 200).replace(/\s+/g, ' ');
    const from = Math.max(0, at - 70);
    return `${from > 0 ? '…' : ''}${s.text.slice(from, from + 260).replace(/\s+/g, ' ')}…`;
  }

}

/** A folder of markdown books: rulebooks/ or worldbooks/. Each book may carry a compact summary. */
export class FileBooks extends BookSet {
  private summaries: Record<string, string> = {};

  constructor(readonly dir: string) {
    super();
    fs.mkdirSync(dir, { recursive: true });
    this.reload();
  }

  private get metaFile() {
    return path.join(this.dir, '_summaries.json');
  }

  reload() {
    this.clear();
    try {
      this.summaries = JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
    } catch {
      this.summaries = {};
    }
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      this.index(parseBook(f.slice(0, -3), fs.readFileSync(path.join(this.dir, f), 'utf8')));
    }
  }

  private file(name: string) {
    return path.join(this.dir, `${path.basename(name)}.md`);
  }

  /**
   * Create or replace a book. The previous version is kept under .bak/ (newest 30).
   * `backup: 'throttled'` (autosave) only backs up if the last backup is older than 10 minutes.
   */
  add(name: string, md: string, opts: { backup?: 'always' | 'throttled' } = {}) {
    const clean = slugify(name).replace(/-/g, '_') || 'book';
    const f = this.file(clean);
    if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') !== md) this.backup(clean, opts.backup ?? 'always');
    fs.writeFileSync(f, md);
    this.reload();
    return this.books.get(clean)!;
  }

  private backup(clean: string, mode: 'always' | 'throttled') {
    const dir = path.join(this.dir, '.bak');
    fs.mkdirSync(dir, { recursive: true });
    const mine = fs.readdirSync(dir).filter((x) => x.startsWith(`${clean}-`)).sort();
    if (mode === 'throttled' && mine.length) {
      const age = Date.now() - fs.statSync(path.join(dir, mine[mine.length - 1])).mtimeMs;
      if (age < 10 * 60_000) return;
    }
    fs.copyFileSync(this.file(clean), path.join(dir, `${clean}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`));
    for (const old of [...mine].slice(0, Math.max(0, mine.length + 1 - 30))) fs.rmSync(path.join(dir, old), { force: true });
  }

  append(name: string, md: string) {
    const cur = this.text(name);
    return this.add(name, `${cur.trimEnd()}\n\n${md.trim()}\n`);
  }

  text(name: string): string {
    try {
      return fs.readFileSync(this.file(name), 'utf8');
    } catch {
      throw new Error(`No such book "${name}". Known: ${[...this.books.keys()].join(', ') || '(none)'}`);
    }
  }

  remove(name: string) {
    delete this.summaries[name];
    this.saveSummaries();
    fs.rmSync(this.file(name), { force: true });
    this.reload();
  }

  summary(name: string): string {
    return this.summaries[name] ?? '';
  }

  setSummary(name: string, text: string) {
    if (!this.books.has(name)) throw new Error(`No such book "${name}"`);
    this.summaries[name] = text.trim();
    this.saveSummaries();
  }

  private saveSummaries() {
    fs.writeFileSync(this.metaFile, JSON.stringify(this.summaries, null, 2));
  }

  /** Compact heading tree with a short gist per section; size-bounded. */
  outline(name: string, opts: { depth?: number; maxChars?: number } = {}): string {
    const b = this.books.get(name);
    return b ? outlineOf(b, opts) : '';
  }

  // --- always-in-context digest (rulebooks)
  get digest(): string {
    try {
      return fs.readFileSync(path.join(this.dir, DIGEST_FILE), 'utf8').trim();
    } catch {
      return '';
    }
  }
  setDigest(text: string) {
    fs.writeFileSync(path.join(this.dir, DIGEST_FILE), text.trim() + '\n');
  }
}

export { FileBooks as Rulebooks };

const gist = (text: string, max = 70): string => {
  const flat = text.replace(/[#>*_`|-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const first = flat.split(/(?<=[.!?])\s/)[0];
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
};

export function outlineOf(b: Book, { depth = 2, maxChars = 1400 }: { depth?: number; maxChars?: number } = {}): string {
  const shown = b.sections.filter((s: Section) => s.level > 0 && s.level <= depth);

  // Pass 1: full tree, one gist per heading. Used when it fits.
  const full = shown.map((s) => {
    const g = gist(s.text);
    return `${'  '.repeat(s.level - 1)}- ${s.title}${g ? ` — ${g}` : ''} [${s.id.split('#')[1]}]`;
  });
  if (full.join('\n').length <= maxChars) return full.join('\n') || gist(b.sections[0]?.text ?? '', 160) || '(empty)';

  // Pass 2: too big -> titles only, siblings joined inline under their parent, so every
  // part of the book stays visible (the end of the book is not silently cut off).
  const byParent = new Map<string, Section[]>();
  for (const s of shown) byParent.set(s.parent ?? '', [...(byParent.get(s.parent ?? '') ?? []), s]);
  const roots = byParent.get('') ?? [];
  const budget = Math.floor(maxChars / Math.max(roots.length, 1));
  const lines = roots.map((r) => {
    const kids = collectKids(r, byParent);
    const head = `- ${r.title} [${r.id.split('#')[1]}]`;
    if (!kids.length) return head;
    let list = '';
    let i = 0;
    const room = Math.max(budget - head.length - 24, 80);
    for (; i < kids.length - 1; i++) {
      const next = `${list}${list ? ' · ' : ''}${kids[i]}`;
      if (next.length > room) break;
      list = next;
    }
    const rest = kids.length - 1 - i;
    return `${head}: ${list}${rest > 0 ? ` · …(+${rest} more)` : ''}${i < kids.length ? ` · ${kids[kids.length - 1]}` : ''}`;
  });
  return lines.join('\n').slice(0, maxChars + 200);
}

function collectKids(s: Section, byParent: Map<string, Section[]>): string[] {
  return (byParent.get(s.id) ?? []).flatMap((c) => [c.title, ...collectKids(c, byParent)]);
}
