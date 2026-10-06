// The GM binder: the whole campaign as one printable PDF — story map, the story beat by beat (read-aloud in a box,
// GM notes, where it leads), places with their maps, people, things, handouts, random tables, the party.
// HTML is built here (pure, testable) and turned into a PDF by WeasyPrint.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  EDGE_KIND_INFO, FLOW_TYPES, NODE_TYPE_INFO, dieLabel, sheetToText, tableEntries, tableFaces, tableRanges,
  type CampaignState, type StoryEdge, type StoryNode,
} from '@pnp/shared';
import { illustrationsOf, imageDimensions, sheetOf } from './vtt.js';
import { imageSize, renderSvg, toPng } from './maps.js';
import type { Store } from './store.js';

export const BINDER_SECTIONS = ['map', 'story', 'pool', 'places', 'people', 'things', 'handouts', 'tables', 'party'] as const;
export type BinderSection = (typeof BINDER_SECTIONS)[number];

export interface BinderOptions {
  sections?: BinderSection[];
  /** GM notes (the node body) are included unless false */
  notes?: boolean;
  /** pictures are included unless false (smaller file) */
  images?: boolean;
  /**
   * 'binder' (default): the binder only · 'both': the binder, and the table prints at the end · 'prints': only the table prints
   * (the pages to hand out and lay on the table: every handout, map and place picture on a page of its own).
   */
  mode?: 'binder' | 'both' | 'prints';
  /** how many copies of every handout / map / place picture the table prints hold (0 or missing = none of that kind) */
  copies?: { handouts?: number; maps?: number; places?: number };
}

export const MAX_COPIES = 30;
export interface PrintSummary { handouts: number; maps: number; places: number; pages: number }

const copiesOf = (n: unknown) => Math.max(0, Math.min(MAX_COPIES, Math.floor(Number(n) || 0)));

/** The table prints: each handout, map and place picture on a page of its own (portrait or landscape by its shape), the copies one after the other. */
function tablePrints(store: Store, copies: NonNullable<BinderOptions['copies']>): { html: string; summary: PrintSummary } {
  const s = store.state;
  const sum: PrintSummary = { handouts: 0, maps: 0, places: 0, pages: 0 };
  const out: string[] = [];
  const add = (n: number, page: string) => { out.push(page.repeat(n)); sum.pages += n; };
  const file = (f: string) => `images/${encodeURIComponent(path.basename(f))}`;
  const dims = (f: string) => { try { return imageDimensions(fs.readFileSync(path.join(store.imagesDir, path.basename(f)))); } catch { return null; } };
  const page = (src: string, d: { w: number; h: number } | null, caption?: string) =>
    `<section class="print${d && d.w > d.h ? ' land' : ''}"><img src="${src}" alt="">${caption ? `<div class="cap">${esc(caption)}</div>` : ''}</section>`;
  const live = Object.values(s.nodes).filter((n) => !n.trashed);

  const nh = copiesOf(copies.handouts);
  if (nh) {
    for (const n of live.filter((x) => x.type === 'handout')) {
      const pic = illustrationsOf(store, n)[0] ?? n.images[0];
      const text = n.readAloud.trim() || n.summary.trim();
      if (pic) add(nh, page(file(pic), dims(pic)));
      else if (text) add(nh, `<section class="print text"><h3>${esc(n.title)}</h3><div class="htext">${mdToHtml(text)}</div></section>`);
      else continue;
      sum.handouts++;
    }
  }
  const nm = copiesOf(copies.maps);
  if (nm) {
    for (const info of store.maps.list()) {
      try {
        const m = store.maps.get(info.id);
        const render = m.renders.at(-1);
        const d = render ? dims(render) : imageSize(m);
        const src = render ? file(render) : `data:image/png;base64,${toPng(renderSvg(m, 'preview'), 1700).toString('base64')}`;
        add(nm, page(src, d && 'w' in d ? { w: d.w, h: d.h } : null, m.kind === 'battle' ? `${m.name} · 1 square = ${m.grid.unit} ft` : m.name));
        sum.maps++;
      } catch { /* map file missing */ }
    }
  }
  const np = copiesOf(copies.places);
  if (np) {
    for (const n of live.filter((x) => x.type === 'location').sort((a, b) => a.title.localeCompare(b.title))) {
      for (const pic of illustrationsOf(store, n)) { add(np, page(file(pic), dims(pic))); sum.places++; }
    }
  }
  return { html: out.join('\n'), summary: sum };
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Small markdown subset: headings, lists, quotes, rules, **bold**, *italic*, `code`. */
export function mdToHtml(src: string): string {
  const inline = (t: string) =>
    esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<i>$2</i>');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flush = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const closeList = () => { if (list) out.push(`</${list}>`); list = null; };
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) { flush(); closeList(); continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); closeList(); const lv = Math.min(6, m[1].length + 3); out.push(`<h${lv}>${inline(m[2])}</h${lv}>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flush(); closeList(); out.push('<hr>'); continue; }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { flush(); if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flush(); if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { flush(); closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    closeList();
    para.push(line.trim());
  }
  flush();
  closeList();
  return out.join('\n');
}

const NODE_W = 280;
const NODE_H = 92;

/** The story map as an SVG (placed nodes of one canvas, edges in their kind's colour and dash). */
export function storyMapSvg(s: CampaignState, canvas: string): string {
  const placed = Object.entries(s.graph.placements)
    .filter(([id, p]) => p.canvas === canvas && s.nodes[id] && !s.nodes[id].trashed && !['pc', 'annotation'].includes(s.nodes[id].type));
  if (!placed.length) return '';
  const frames = (s.graph.frames ?? []).filter((f) => f.canvas === canvas);
  const xs = [...placed.map(([, p]) => p.x), ...frames.map((f) => f.x)];
  const ys = [...placed.map(([, p]) => p.y), ...frames.map((f) => f.y)];
  const xe = [...placed.map(([, p]) => p.x + NODE_W), ...frames.map((f) => f.x + f.w)];
  const ye = [...placed.map(([, p]) => p.y + NODE_H), ...frames.map((f) => f.y + f.h)];
  const x0 = Math.min(...xs) - 30, y0 = Math.min(...ys) - 40;
  const w = Math.max(...xe) + 30 - x0, h = Math.max(...ye) + 30 - y0;
  const frameSvg = frames.map((f) => `<g><rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="22" fill="${f.color}" fill-opacity="0.09" stroke="${f.color}" stroke-width="3" stroke-dasharray="14 8"/><text x="${f.x + 20}" y="${f.y + 30}" font-size="26" font-weight="700" fill="${f.color}">${esc(f.title)}</text></g>`).join('');
  const at = new Map(placed.map(([id, p]) => [id, p]));
  const wrap = (t: string) => {
    const words = t.split(/\s+/);
    const lines: string[] = [];
    for (const word of words) {
      const cur = lines[lines.length - 1];
      if (cur !== undefined && (cur + ' ' + word).length <= 22) lines[lines.length - 1] = cur + ' ' + word; else lines.push(word);
    }
    return lines.length > 2 ? [lines[0], `${lines[1]}…`] : lines;
  };
  const edges = s.graph.edges.filter((e) => at.has(e.from) && at.has(e.to)).map((e: StoryEdge) => {
    const a = at.get(e.from)!, b = at.get(e.to)!;
    const ax = a.x + NODE_W, ay = a.y + NODE_H / 2, bx = b.x, by = b.y + NODE_H / 2;
    const k = EDGE_KIND_INFO[e.kind] ?? EDGE_KIND_INFO['leads-to'];
    const dx = Math.max(60, Math.abs(bx - ax) / 2);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const label = e.label ? { x: mx, y: my - 6, t: esc(e.label.slice(0, 34)) } : null;
    return { path: `<path d="M${ax} ${ay} C${ax + dx} ${ay} ${bx - dx} ${by} ${bx} ${by}" fill="none" stroke="${k.color}" stroke-width="3" ${k.dash ? `stroke-dasharray="${k.dash.split(' ').map((n) => Number(n) * 2).join(' ')}"` : ''}/>`, label };
  });
  const labels = edges.flatMap((e) => (e.label ? [`<text x="${e.label.x}" y="${e.label.y}" text-anchor="middle" font-size="21" fill="#fff" stroke="#fff" stroke-width="7" stroke-linejoin="round">${e.label.t}</text><text x="${e.label.x}" y="${e.label.y}" text-anchor="middle" font-size="21" font-weight="600" fill="#333">${e.label.t}</text>`] : []));
  const boxes = placed.map(([id, p]) => {
    const n = s.nodes[id];
    const info = NODE_TYPE_INFO[n.type];
    return `<g><rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="#fff" stroke="#bbb" stroke-width="2"/><rect x="${p.x}" y="${p.y}" width="7" height="${NODE_H}" rx="3" fill="${info.color}"/><text x="${p.x + 18}" y="${p.y + 24}" font-size="17" fill="${info.color}" font-weight="700">${esc(info.label.toUpperCase())}</text>${wrap(n.title).map((l, i) => `<text x="${p.x + 18}" y="${p.y + 54 + i * 28}" font-size="25" font-weight="700" fill="#111">${esc(l)}</text>`).join('')}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" class="storymap" preserveAspectRatio="xMidYMid meet">${frameSvg}${edges.map((e) => e.path).join('')}${boxes.join('')}${labels.join('')}</svg>`;
}

const FLOW_EDGE_KINDS = new Set(['leads-to', 'conditional', 'bridge']);

/** Story nodes in reading order: follow the flow from the starts, left to right. */
export function storyOrder(s: CampaignState): StoryNode[] {
  const placed = Object.entries(s.graph.placements).filter(([id]) => s.nodes[id] && !s.nodes[id].trashed && FLOW_TYPES.has(s.nodes[id].type));
  const pos = new Map(placed.map(([id, p]) => [id, p]));
  const out = new Map<string, string[]>();
  const hasIn = new Set<string>();
  for (const e of s.graph.edges) {
    if (!FLOW_EDGE_KINDS.has(e.kind) || !pos.has(e.from) || !pos.has(e.to)) continue;
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    hasIn.add(e.to);
  }
  const byPos = (a: string, b: string) => pos.get(a)!.x - pos.get(b)!.x || pos.get(a)!.y - pos.get(b)!.y;
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const t of [...(out.get(id) ?? [])].sort(byPos)) visit(t);
  };
  for (const id of [...pos.keys()].filter((i) => !hasIn.has(i)).sort(byPos)) visit(id);
  for (const id of [...pos.keys()].sort(byPos)) visit(id); // anything in a loop / unreachable
  return order.map((id) => s.nodes[id]);
}

export function binderHtml(store: Store, opts: BinderOptions = {}): string {
  return binderParts(store, opts).html;
}

/** The binder HTML plus what the table prints hold. */
export function binderParts(store: Store, opts: BinderOptions = {}): { html: string; prints: PrintSummary | null } {
  const s = store.state;
  const mode = opts.mode ?? 'binder';
  const prints = mode === 'binder' ? null : tablePrints(store, opts.copies ?? {});
  if (mode === 'prints') {
    const body = prints!.html || '<section class="chapter"><p>Nothing to print: set at least one copy and make sure there are handouts, maps or place pictures.</p></section>';
    return { prints: prints!.summary, html: `<!doctype html><html lang="${esc(s.meta.language || 'en')}"><head><meta charset="utf-8"><title>${esc(s.meta.name)} — table prints</title><style>${CSS}</style></head><body>${body}</body></html>` };
  }
  const want = new Set<BinderSection>(opts.sections?.length ? opts.sections : BINDER_SECTIONS);
  const notes = opts.notes !== false;
  const pics = opts.images !== false;
  const profile = store.vtt.status().profile;
  const title = (id: string) => s.nodes[id]?.title ?? id;
  const live = (n: StoryNode) => !n.trashed;
  const nodes = Object.values(s.nodes).filter(live);
  const placed = (n: StoryNode) => !!s.graph.placements[n.id];
  const toc: { id: string; label: string; level: 1 | 2 }[] = [];
  const parts: string[] = [];
  const img = (file: string, cls = 'pic') => (pics ? `<img class="${cls}" src="images/${encodeURIComponent(path.basename(file))}" alt="">` : '');

  // what goes into which chapter (decided first, so every connection can say where its target is printed)
  const byName = (a: StoryNode, b: StoryNode) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title);
  const pick: Record<Exclude<BinderSection, 'map'>, { label: string; list: StoryNode[] }> = {
    story: { label: 'The story', list: storyOrder(s) },
    pool: { label: 'Prepared material (not in the story yet)', list: nodes.filter((n) => !placed(n) && FLOW_TYPES.has(n.type) && n.type !== 'clue') },
    places: { label: 'Places', list: nodes.filter((n) => n.type === 'location').sort((a, b) => a.title.localeCompare(b.title)) },
    people: { label: 'People & opponents', list: nodes.filter((n) => ['npc', 'enemy', 'faction'].includes(n.type)).sort(byName) },
    things: { label: 'Things, lore & secrets', list: nodes.filter((n) => n.type === 'item' || n.type === 'lore' || (n.type === 'clue' && !placed(n))).sort(byName) },
    handouts: { label: 'Handouts', list: nodes.filter((n) => n.type === 'handout') },
    tables: { label: 'Random tables', list: nodes.filter((n) => n.type === 'table' && tableEntries(n).length) },
    party: { label: 'The party', list: nodes.filter((n) => n.type === 'pc' && n.fields.present !== false) },
  };
  const where = new Map<string, string>();
  for (const [sec, p] of Object.entries(pick)) if (want.has(sec as BinderSection)) for (const n of p.list) if (!where.has(n.id)) where.set(n.id, p.label);

  const links = (n: StoryNode) => {
    const rows = s.graph.edges.filter((e) => (e.from === n.id || e.to === n.id) && s.nodes[e.from] && s.nodes[e.to] && !s.nodes[e.from].trashed && !s.nodes[e.to].trashed);
    if (!rows.length) return '';
    return `<ul class="links">${rows.map((e) => {
      const out = e.from === n.id;
      const other = out ? e.to : e.from;
      const k = EDGE_KIND_INFO[e.kind];
      const ch = where.get(other);
      const ref = ch ? ` <span class="where">· ${esc(ch)}, <a class="pg" href="#n-${esc(other)}"></a></span>` : ' <span class="where">· not in this binder</span>';
      return `<li><span class="k" style="color:${k.color}">${out ? '→' : '←'} ${esc(k.label)}</span> ${ch ? `<a href="#n-${esc(other)}">${esc(title(other))}</a>` : esc(title(other))}${e.label ? ` <i>${esc(e.label)}</i>` : ''}${ref}</li>`;
    }).join('')}</ul>`;
  };

  const card = (n: StoryNode, extra = '') => {
    const info = NODE_TYPE_INFO[n.type];
    const pic = illustrationsOf(store, n)[0] ?? n.images[0];
    return `<section class="node" id="n-${esc(n.id)}" style="--c:${info.color}">
      <div class="head"><span class="type">${esc(info.label)}</span><h3>${esc(n.title)}</h3>${n.status !== 'untouched' ? `<span class="st">${esc(n.status)}</span>` : ''}</div>
      ${pic ? img(pic) : ''}
      ${n.summary ? `<p class="sum">${esc(n.summary)}</p>` : ''}
      ${n.readAloud.trim() ? `<div class="aloud"><div class="lbl">Read aloud</div>${mdToHtml(n.readAloud)}</div>` : ''}
      ${notes && n.body.trim() ? `<div class="body">${mdToHtml(n.body)}</div>` : ''}
      ${extra}
      ${n.poolHint ? `<p class="when">When: ${esc(n.poolHint)}</p>` : ''}
      ${links(n)}
    </section>`;
  };

  const section = (id: string, label: string, body: string) => {
    if (!body.trim()) return;
    toc.push({ id, label, level: 1 });
    parts.push(`<section class="chapter" id="${id}"><h2>${esc(label)}</h2>${body}</section>`);
  };

  // ---- story map
  if (want.has('map')) {
    const maps = s.graph.canvases.map((c) => ({ c, svg: storyMapSvg(s, c.id) })).filter((x) => x.svg);
    if (maps.length) {
      toc.push({ id: 'storymap', label: 'Story map', level: 1 });
      parts.push(`<section class="chapter landscape" id="storymap"><h2>Story map</h2>${maps.map((x) => `${maps.length > 1 ? `<h4 class="mapname">${esc(x.c.name)}</h4>` : ''}${x.svg}`).join('')}<div class="legend">${Object.entries(EDGE_KIND_INFO).map(([, k]) => `<span><i style="border-color:${k.color}"></i>${esc(k.label)}</span>`).join('')}</div></section>`);
    }
  }

  // ---- story, beat by beat
  if (want.has('story')) {
    section('story', pick.story.label, pick.story.list.map((n) => card(n)).join(''));
  }

  // ---- prepared but not placed
  if (want.has('pool')) {
    section('pool', pick.pool.label, pick.pool.list.map((n) => card(n)).join(''));
  }

  // ---- places (with their maps)
  if (want.has('places')) {
    section('places', pick.places.label, pick.places.list.map((n) => {
      let mapHtml = '';
      const mid = typeof n.fields.mapId === 'string' ? n.fields.mapId : '';
      if (mid && pics) {
        try {
          const m = store.maps.get(mid);
          const render = m.renders.at(-1);
          mapHtml = `<div class="map">${render ? `<img class="mapimg" src="images/${encodeURIComponent(render)}" alt="">` : `<img class="mapimg" src="data:image/png;base64,${toPng(renderSvg(m, 'preview'), 1100).toString('base64')}" alt="">`}<p class="cap">${esc(m.name)} · ${m.kind === 'battle' ? `${m.grid.cols}×${m.grid.rows} cells, ${m.grid.unit} ft each` : 'region map'}</p></div>`;
        } catch { /* map file missing */ }
      }
      return card(n, mapHtml);
    }).join(''));
  }

  // ---- people (NPCs, enemies, factions) with their sheets
  const sheetText = (n: StoryNode) => {
    const sheet = sheetOf(n);
    if (!Object.keys(sheet).length) return '';
    const roles = profile?.characters?.roles ?? [];
    const role = roles.find((r) => r.id === n.fields.role) ?? roles.find((r) => r.for?.includes(n.type as 'npc') || r.id === n.type);
    const text = role ? sheetToText(role, n.title, sheet) : Object.entries(sheet).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n');
    return `<pre class="sheet">${esc(text)}</pre>`;
  };
  if (want.has('people')) {
    section('people', pick.people.label, pick.people.list.map((n) => card(n, n.type === 'faction' ? '' : sheetText(n))).join(''));
  }

  if (want.has('things')) {
    section('things', pick.things.label, pick.things.list.map((n) => card(n)).join(''));
  }

  if (want.has('handouts')) {
    section('handouts', pick.handouts.label, pick.handouts.list.map((n) => {
      const pic = illustrationsOf(store, n)[0] ?? n.images[0];
      return `<section class="handout" id="n-${esc(n.id)}"><h3>${esc(n.title)}</h3>${pic ? img(pic, 'handoutimg') : ''}${n.readAloud.trim() || n.summary ? `<div class="htext">${mdToHtml(n.readAloud.trim() || n.summary)}</div>` : ''}</section>`;
    }).join(''));
  }

  if (want.has('tables')) {
    section('tables', pick.tables.label, pick.tables.list.map((n) => {
      const es = tableEntries(n);
      return `<section class="table" id="n-${esc(n.id)}"><h3>${esc(n.title)} <span class="die">${dieLabel(tableFaces(es))}</span></h3>${n.summary ? `<p class="sum">${esc(n.summary)}</p>` : ''}<table>${tableRanges(es).map((r) => `<tr><td class="r">${r.from === r.to ? r.from : `${r.from}–${r.to}`}</td><td>${esc(r.text)}</td></tr>`).join('')}</table></section>`;
    }).join(''));
  }

  if (want.has('party')) {
    section('party', pick.party.label, pick.party.list.map((n) => card(n, `${n.fields.playerName ? `<p class="when">Player: ${esc(n.fields.playerName)}</p>` : ''}${sheetText(n)}`)).join(''));
  }

  if (prints?.html) toc.push({ id: 'tableprints', label: 'Table prints (to hand out)', level: 1 });
  const date = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const tocHtml = `<section class="toc"><h2>Contents</h2><ol>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.label)}</a></li>`).join('')}</ol></section>`;
  const printHtml = prints?.html ? prints.html.replace('<section class="print', '<section id="tableprints" class="print') : '';
  const html = `<!doctype html><html lang="${esc(s.meta.language || 'en')}"><head><meta charset="utf-8"><title>${esc(s.meta.name)} — GM binder</title><style>${CSS}</style></head><body>
    <section class="cover"><div class="kicker">GM binder</div><h1>${esc(s.meta.name)}</h1><div class="date">${esc(date)}</div></section>
    ${tocHtml}${parts.join('\n') || (printHtml ? '' : '<section class="chapter"><p>Nothing to print yet.</p></section>')}${printHtml}
  </body></html>`;
  return { html, prints: prints?.summary ?? null };
}

const CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; @bottom-center { content: counter(page); font: 9pt sans-serif; color: #888; } @bottom-left { content: string(campaign); font: 8pt sans-serif; color: #aaa; } }
@page cover { margin: 0; @bottom-center { content: none; } @bottom-left { content: none; } }
@page landscape { size: A4 landscape; margin: 12mm; }
html { font: 10.5pt/1.45 'DejaVu Serif', Georgia, serif; color: #1c1c22; }
body { string-set: campaign "GM binder"; }
h1, h2, h3, h4, h5, h6, .type, .lbl, .st, .kicker, .date, .cap, .links, .legend, .toc li, th { font-family: 'DejaVu Sans', Helvetica, Arial, sans-serif; }
.cover { page: cover; height: 297mm; display: flex; flex-direction: column; justify-content: center; padding: 0 28mm; background: #12151c; color: #f2f3f7; break-after: page; }
.cover h1 { font-size: 40pt; line-height: 1.1; margin: 8mm 0; font-weight: 700; }
.cover .kicker { letter-spacing: .3em; text-transform: uppercase; color: #8aa7ff; font-size: 11pt; }
.cover .date { color: #98a0b3; font-size: 11pt; }
.toc { break-after: page; } .toc h2 { margin-top: 0; }
.toc ol { list-style: none; padding: 0; font-size: 12pt; } .toc li { margin: 3mm 0; }
.toc a { color: inherit; text-decoration: none; } .toc a::after { content: leader('.') target-counter(attr(href), page); color: #777; }
.chapter { break-before: page; } .chapter.landscape { page: landscape; }
h2 { font-size: 22pt; border-bottom: 2px solid #8aa7ff; padding-bottom: 2mm; margin: 0 0 6mm; }
.node { break-inside: avoid-page; margin: 0 0 7mm; padding: 0 0 4mm 5mm; border-left: 3px solid var(--c); }
.node .head { display: flex; align-items: baseline; gap: 3mm; flex-wrap: wrap; }
.node h3, .handout h3, .table h3 { font-size: 14pt; margin: 0; } .type { font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase; color: var(--c); font-weight: 700; }
.st { font-size: 7.5pt; color: #777; border: 1px solid #ccc; border-radius: 8px; padding: 0 2mm; }
.pic { float: right; width: 48mm; max-height: 60mm; object-fit: cover; margin: 0 0 3mm 5mm; border-radius: 3mm; }
.sum { margin: 2mm 0; color: #44485a; font-style: italic; }
.aloud { background: #eef2ff; border-left: 3px solid #8aa7ff; padding: 2mm 4mm; margin: 3mm 0; border-radius: 0 2mm 2mm 0; } .aloud .lbl { font-size: 7pt; text-transform: uppercase; letter-spacing: .1em; color: #5870c8; margin-bottom: 1mm; } .aloud p { margin: 1mm 0; }
.body h4, .body h5, .body h6 { margin: 3mm 0 1mm; font-size: 10.5pt; } .body p { margin: 1.5mm 0; } .body ul, .body ol { margin: 1mm 0; padding-left: 6mm; } blockquote { margin: 2mm 0; padding-left: 4mm; border-left: 2px solid #ccc; color: #555; }
code { font-family: 'DejaVu Sans Mono', monospace; font-size: 9pt; background: #f1f1f4; padding: 0 1mm; border-radius: 1mm; }
.when { font-size: 9pt; color: #8a6d1f; } .links { list-style: none; padding: 0; margin: 2mm 0 0; font-size: 8.5pt; color: #555; } .links .k { font-weight: 700; margin-right: 1mm; } .links .where { color: #777; } a.pg::before { content: 'p. ' target-counter(attr(href), page); } .links a.pg { border: 0; color: #777; }
.links a { color: #1c1c22; text-decoration: none; border-bottom: 1px dotted #999; }
.sheet { font: 8.5pt/1.4 'DejaVu Sans Mono', monospace; background: #f6f6f8; border: 1px solid #e0e0e6; border-radius: 2mm; padding: 2mm 3mm; white-space: pre-wrap; break-inside: avoid; }
.map { margin: 3mm 0; break-inside: avoid; } .mapimg { width: 100%; max-height: 160mm; object-fit: contain; border: 1px solid #ccc; border-radius: 2mm; } .cap { font-size: 8pt; color: #777; margin: 1mm 0; }
.storymap { width: 100%; height: auto; max-height: 168mm; } .mapname { font-size: 11pt; margin: 4mm 0 1mm; }
.legend { display: flex; gap: 5mm; font-size: 8pt; color: #555; margin-top: 3mm; } .legend i { display: inline-block; width: 8mm; border-top: 3px solid; vertical-align: middle; margin-right: 1.5mm; }
.handout { break-before: page; text-align: center; } h2 + .handout { break-before: auto; } .handoutimg { max-width: 100%; max-height: 190mm; border: 1px solid #ccc; } .htext { text-align: left; max-width: 140mm; margin: 6mm auto; font-size: 12pt; }
.table { break-inside: avoid; margin-bottom: 7mm; } .die { font: 700 9pt 'DejaVu Sans', sans-serif; color: #5870c8; border: 1px solid #aab8ee; border-radius: 3mm; padding: 0 2mm; margin-left: 2mm; }
@page tp { size: A4; margin: 10mm; @bottom-center { content: none; } @bottom-left { content: none; } }
@page tpl { size: A4 landscape; margin: 10mm; @bottom-center { content: none; } @bottom-left { content: none; } }
.print { page: tp; break-before: page; height: 268mm; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.print.land { page: tpl; height: 181mm; }
.print img { max-width: 100%; max-height: 258mm; object-fit: contain; } .print.land img { max-height: 171mm; }
.print .cap { font: 7pt 'DejaVu Sans', sans-serif; color: #999; margin-top: 2mm; }
.print.text { justify-content: flex-start; } .print.text h3 { font: 700 20pt 'DejaVu Sans', sans-serif; margin: 12mm 0 6mm; } .print.text .htext { max-width: 150mm; font-size: 13pt; line-height: 1.6; }
.table table { border-collapse: collapse; width: 100%; font-size: 10pt; } .table td { border-bottom: 1px solid #e4e4ea; padding: 1mm 2mm; } .table td.r { width: 16mm; color: #888; font-family: 'DejaVu Sans', sans-serif; }
`;

/** WeasyPrint renders the HTML to a PDF (images are read from the campaign folder). */
export function renderPdf(html: string, baseDir: string, out: string): void {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync('weasyprint', ['--base-url', baseDir.endsWith('/') ? baseDir : baseDir + '/', '--dpi', '150', '--optimize-images', '--jpeg-quality', '82', '-', out], { input: html, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180_000 });
  if (r.error || r.status !== 0) {
    fs.rmSync(out, { force: true });
    const hint = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' ? 'WeasyPrint is not installed (pip install weasyprint).' : (r.stderr || '').split('\n').filter((l) => /error|exception/i.test(l)).slice(-2).join(' ') || 'rendering failed';
    throw new Error(`Could not make the PDF: ${hint}`);
  }
}
