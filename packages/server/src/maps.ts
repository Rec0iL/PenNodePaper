import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { FLOORS, slugify, type MapDoc } from '@pnp/shared';
import { newMap } from '@pnp/shared';

export * from '@pnp/shared';

export function toPng(svg: string, width?: number): Buffer {
  // No system-font scan (it costs ~15 s per render here): the control image has no text,
  // and the UI shows the preview SVG directly in the browser.
  const r = new Resvg(svg, { font: { loadSystemFonts: false }, ...(width ? { fitTo: { mode: 'width' as const, value: width } } : {}) });
  return Buffer.from(r.render().asPng());
}

// ------------------------------------ storage -----------------------------------------

export class Maps {
  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  private file(id: string) {
    return path.join(this.dir, `${path.basename(id)}.json`);
  }
  list(): MapDoc[] {
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as MapDoc);
  }
  get(id: string): MapDoc {
    try {
      const m = JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as MapDoc;
      m.background ??= 'land';
      return m;
    } catch {
      throw new Error(`No such map "${id}". Known maps: ${this.list().map((m) => m.id).join(', ') || '(none)'}`);
    }
  }
  has(id: string) {
    return fs.existsSync(this.file(id));
  }
  save(m: MapDoc, opts: { backup?: 'always' | 'throttled' | 'none' } = {}) {
    const f = this.file(m.id);
    const mode = opts.backup ?? 'always';
    if (mode !== 'none' && fs.existsSync(f)) {
      const hist = path.join(this.dir, '.history');
      fs.mkdirSync(hist, { recursive: true });
      const mine = fs.readdirSync(hist).filter((x) => x.startsWith(`${m.id}-`)).sort();
      const fresh = mine.length && Date.now() - fs.statSync(path.join(hist, mine[mine.length - 1])).mtimeMs < 5 * 60_000;
      if (mode === 'always' || !fresh) {
        fs.copyFileSync(f, path.join(hist, `${m.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
        for (const old of mine.slice(0, Math.max(0, mine.length + 1 - 25))) fs.rmSync(path.join(hist, old), { force: true });
      }
    }
    fs.writeFileSync(f, JSON.stringify(m, null, 1));
  }
  create(name: string, kind: MapDoc['kind'], cols?: number, rows?: number, unit?: number, wantedId?: string): MapDoc {
    let id = slugify(wantedId ?? name);
    for (let i = 2; this.has(id); i++) id = `${slugify(wantedId ?? name)}-${i}`;
    const m = newMap(id, name, kind, cols, rows, unit);
    this.save(m, { backup: 'none' });
    return m;
  }
  remove(id: string) {
    fs.rmSync(this.file(id), { force: true });
  }
  /** Compact text view for the AI: rows + feature lists. */
  describe(m: MapDoc): string {
    if (m.kind === 'region') return `Region map "${m.name}" ${m.size.w}x${m.size.h}px, background ${m.background}. Shapes: ${m.shapes.map((s) => `${s.id}(${s.kind}${s.label ? `:${s.label}` : ''})`).join(', ') || 'none'}`;
    const legend = Object.entries(FLOORS).map(([c, f]) => `${c}=${f.name}`).join(' ');
    return [
      `Battle map "${m.name}" ${m.grid.cols}x${m.grid.rows} cells, ${m.grid.unit} ft per cell. Row y=0 is the top. '.' = rock. Floors: ${legend}`,
      ...m.rows.map((r, y) => `${String(y).padStart(2)} ${r}`),
      `doors: ${m.doors.map((d) => `${d.x},${d.y}/${d.side}:${d.kind}`).join(' ') || 'none'}`,
      `props: ${m.props.map((p) => `${p.id}@${p.x},${p.y}`).join(' ') || 'none'}`,
      `labels: ${m.labels.map((l) => `"${l.text}"@${l.x},${l.y}`).join(' ') || 'none'}`,
      `tokens: ${m.tokens.map((t) => `${t.kind}${t.label ? `:${t.label}` : ''}${t.node ? `→node ${t.node}` : ''}@${t.x},${t.y}`).join(' ') || 'none'}`,
    ].join('\n');
  }
}

