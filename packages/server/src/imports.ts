// Notes the GM brings in (markdown, text, Word, PDF): kept as plain text in the campaign's imports/ folder so the AI
// can read them in chunks and turn them into typed nodes. Nothing is created automatically.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { slugify } from '@pnp/shared';

export interface ImportInfo { name: string; chars: number; importedAt: string }

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/** Plain text of an uploaded notes file. Markdown/text as is; .docx and .pdf through unzip / pdftotext (installed on most systems). */
export function extractText(buf: Buffer, filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (['.md', '.markdown', '.txt', '.text', ''].includes(ext)) return buf.toString('utf8');
  if (ext !== '.docx' && ext !== '.pdf') throw new Error(`Cannot read ${ext} files — use .md, .txt, .docx or .pdf (or paste the text).`);
  const tmp = path.join(os.tmpdir(), `pnp-import-${process.pid}-${Date.now()}${ext}`);
  fs.writeFileSync(tmp, buf);
  try {
    if (ext === '.docx') {
      const r = spawnSync('unzip', ['-p', tmp, 'word/document.xml'], { maxBuffer: 64 * 1024 * 1024 });
      if (r.error || r.status !== 0) throw new Error('Could not open the .docx (is `unzip` installed, and is it a real Word file?).');
      return decodeXml(
        r.stdout.toString('utf8')
          .replace(/<w:tab\/>/g, '\t')
          .replace(/<w:br\/>/g, '\n')
          .replace(/<\/w:p>/g, '\n')
          .replace(/<w:pStyle w:val="Heading(\d)"\/>/g, (_, n) => `\u0001${'#'.repeat(Math.min(6, Number(n)))} `)
          .replace(/<[^>]+>/g, ''),
      ).replace(/\u0001/g, '\n').replace(/\n{3,}/g, '\n\n');
    }
    const r = spawnSync('pdftotext', ['-layout', tmp, '-'], { maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) throw new Error('Could not read the PDF (is `pdftotext` installed? scanned PDFs have no text).');
    return r.stdout.toString('utf8').replace(/\f/g, '\n\n');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export class Imports {
  constructor(private dir: string) {}

  private file(name: string) {
    return path.join(this.dir, `${slugify(name.replace(/\.[a-z0-9]+$/i, '')) || 'notes'}.txt`);
  }

  list(): ImportInfo[] {
    let files: string[] = [];
    try { files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.txt')); } catch { return []; }
    return files
      .map((f) => {
        const st = fs.statSync(path.join(this.dir, f));
        return { name: f.slice(0, -4), chars: fs.readFileSync(path.join(this.dir, f), 'utf8').length, importedAt: st.mtime.toISOString() };
      })
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  save(name: string, text: string): ImportInfo {
    const body = text.replace(/\r\n?/g, '\n').trim();
    if (!body) throw new Error('The file has no text in it.');
    fs.mkdirSync(this.dir, { recursive: true });
    const f = this.file(name);
    fs.writeFileSync(f, body + '\n');
    return { name: path.basename(f, '.txt'), chars: body.length, importedAt: new Date().toISOString() };
  }

  /** A chunk of an import, cut at a line break so no sentence is split mid-way. */
  read(name: string, offset = 0, limit = 6000): { name: string; offset: number; next: number | null; total: number; text: string } {
    const f = this.file(name);
    if (!fs.existsSync(f)) throw new Error(`No import "${name}". Imports: ${this.list().map((i) => i.name).join(', ') || '(none)'}`);
    const all = fs.readFileSync(f, 'utf8');
    const start = Math.max(0, Math.min(offset, all.length));
    let end = Math.min(all.length, start + Math.max(500, Math.min(limit, 20000)));
    if (end < all.length) {
      const cut = all.lastIndexOf('\n', end);
      if (cut > start + 200) end = cut + 1;
    }
    return { name: path.basename(f, '.txt'), offset: start, next: end < all.length ? end : null, total: all.length, text: all.slice(start, end) };
  }

  remove(name: string) {
    fs.rmSync(this.file(name), { force: true });
  }
}
