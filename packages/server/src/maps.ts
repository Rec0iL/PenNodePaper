import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { FLOORS, REGION_KINDS, ensureLabelIds, migratePins, regionKind, sanitizeMap, slugify, type MapDoc } from '@pnp/shared';
import { installLabelContext, labelFontFiles } from './labels.js';
import { newMap } from '@pnp/shared';

export * from '@pnp/shared';

export function toPng(svg: string, width?: number): Buffer {
  // No system-font scan (it costs ~15 s per render here): the control image has no text; the plan picture has names,
  // set in the bundled label fonts.
  installLabelContext();
  const r = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: labelFontFiles(), defaultFontFamily: 'PNP barlow' }, ...(width ? { fitTo: { mode: 'width' as const, value: width } } : {}) });
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
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => {
      const m = sanitizeMap(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as MapDoc);
      if (m.kind === 'region') migratePins(m);
      ensureLabelIds(m);
      return m;
    });
  }
  get(id: string): MapDoc {
    try {
      const m = sanitizeMap(JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as MapDoc);
      m.background ??= 'land';
      if (m.kind === 'region') migratePins(m); // places are areas now, not dots
      ensureLabelIds(m); // names have handles (l1, l2…) the AI can address
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
    if (m.kind === 'region') {
      const shape = (s: MapDoc['shapes'][number]) => {
        const k = regionKind(s.kind, m.kinds);
        const where = s.type === 'ellipse' ? `ellipse c=${s.points[0]?.join(',')} rx,ry=${s.points[1]?.join(',')}` : `${s.type} ${s.points.map((p) => p.join(',')).join(' ')}${s.type === 'path' ? ` width=${s.width ?? k.width ?? 14}` : ''}`;
        return `${s.id} [${k.layer}] ${s.kind}${s.label ? ` "${s.label}"${s.labelPlace ? ` ${s.labelPlace}` : ''}${s.labelStyle ? ` style=${s.labelStyle}` : ''}${s.labelShow === false ? ' (not printed)' : ''}` : ''}${s.prompt ? ` prompt="${s.prompt}"` : ''}: ${where}`;
      };
      const ids = (layer: 'terrain' | 'structure') => [...REGION_KINDS.filter((k) => k.layer === layer).map((k) => k.id), ...(m.kinds ?? []).filter((k) => k.layer === layer).map((k) => `${k.id}*`)].join(' ');
      return [
        `Region map "${m.name}" ${m.size.w}x${m.size.h}px, background ${m.background}. Origin top-left, x right, y down, canvas pixels.`,
        `Terrain kinds (painted first): ${ids('terrain')}`,
        `Structure kinds (inpainted into the shape afterwards): ${ids('structure')}   (* = custom kind of this map)`,
        ...(m.shapes.length ? m.shapes.map(shape) : ['no shapes']),
        ...(m.labels.length ? [`free labels: ${m.labels.map((l) => `${l.id ?? '?'} "${l.text}"@${Math.round(l.x)},${Math.round(l.y)}${l.area ? ` area ${Math.round(l.area.x)},${Math.round(l.area.y)} ${Math.round(l.area.w)}x${Math.round(l.area.h)}` : ''}${l.place ? ` ${l.place}` : ''}${l.style ? ` style=${l.style}` : ''}${l.show === false ? ' (not printed)' : ''}`).join(' ')}`] : []),
        `lettering style of the map: ${m.lettering?.style ?? 'plain-light'}`,
      ].join('\n');
    }
    const legend = Object.entries(FLOORS).map(([c, f]) => `${c}=${f.name}`).join(' ');
    return [
      `Battle map "${m.name}" ${m.grid.cols}x${m.grid.rows} cells, ${m.grid.unit} ft per cell. Row y=0 is the top. '.' = rock. Floors: ${legend}`,
      ...m.rows.map((r, y) => `${String(y).padStart(2)} ${r}`),
      `doors: ${m.doors.map((d) => `${d.x},${d.y}/${d.side}:${d.kind}`).join(' ') || 'none'}`,
      `props: ${m.props.map((p) => `${p.id}@${p.x},${p.y}`).join(' ') || 'none'}`,
      `labels: ${m.labels.map((l) => `${l.id ?? '?'} "${l.text}"@${l.x},${l.y}${l.area ? ` area ${l.area.x},${l.area.y} ${l.area.w}x${l.area.h}` : ''}${l.place ? ` ${l.place}` : ''}${l.style ? ` style=${l.style}` : ''}${l.show === false ? ' (not printed)' : ''}`).join(' ') || 'none'}`,
      `tokens: ${m.tokens.map((t) => `${t.kind}${t.label ? `:${t.label}` : ''}${t.node ? `→node ${t.node}` : ''}@${t.x},${t.y}`).join(' ') || 'none'}`,
    ].join('\n');
  }
}

