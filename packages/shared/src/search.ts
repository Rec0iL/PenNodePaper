// Quick search over the campaign's nodes (the Ctrl+K palette). Pure, so it can be tested and reused.
// Words must ALL match somewhere; filters: type:npc  #tag  is:pool|canvas|played|unplayed|known|active
import type { CampaignState, NodeType, StoryNode } from './index.js';
import { NODE_TYPES, NODE_TYPE_INFO } from './index.js';
import { isKnown, isPlayed, visitsOf } from './story.js';

export interface SearchHit {
  id: string;
  score: number;
  /** a short piece of text around the match (summary, read-aloud, notes, fields) */
  snippet: string;
}

export interface ParsedQuery {
  terms: string[];
  types: NodeType[];
  tags: string[];
  is: string[];
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { terms: [], types: [], tags: [], is: [] };
  for (const raw of q.trim().split(/\s+/).filter(Boolean)) {
    const w = norm(raw);
    if (w.startsWith('type:') && w.length > 5) {
      const t = w.slice(5);
      const hit = NODE_TYPES.filter((x) => x.startsWith(t) || norm(NODE_TYPE_INFO[x].label).startsWith(t));
      if (hit.length) out.types.push(...hit);
      else out.terms.push(w); // not a type: search for the text
    } else if (w.startsWith('#') && w.length > 1) out.tags.push(w.slice(1));
    else if (w.startsWith('is:') && w.length > 3) out.is.push(w.slice(3));
    else out.terms.push(w);
  }
  return out;
}

const fieldText = (n: StoryNode) =>
  Object.entries(n.fields)
    .filter(([k]) => !['sheet', 'visits', 'history', 'entries', 'syncedAt', 'portraitHash'].includes(k))
    .map(([, v]) => (typeof v === 'string' ? v : ''))
    .join(' ');

function snippetAround(text: string, term: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const i = norm(flat).indexOf(term);
  if (i < 0) return flat.slice(0, 110);
  const a = Math.max(0, i - 40);
  return `${a > 0 ? '…' : ''}${flat.slice(a, i + term.length + 70)}${i + term.length + 70 < flat.length ? '…' : ''}`;
}

export function searchNodes(s: CampaignState, query: string, limit = 30): SearchHit[] {
  const q = parseQuery(query);
  const nodes = Object.values(s.nodes).filter((n) => !n.trashed);
  const placed = (n: StoryNode) => !!s.graph.placements[n.id];
  const passes = (n: StoryNode) =>
    (!q.types.length || q.types.includes(n.type)) &&
    q.tags.every((t) => n.tags.some((x) => norm(x).includes(t))) &&
    q.is.every((f) =>
      f === 'pool' ? !placed(n) : f === 'canvas' ? placed(n) : f === 'played' ? isPlayed(n) : f === 'unplayed' ? !isPlayed(n) : f === 'known' ? isKnown(n) : f === 'active' ? n.status === 'active' || visitsOf(n).some((v) => v.here) : true,
    );
  const pool = nodes.filter(passes);

  if (!q.terms.length) {
    // no words: the filtered nodes, most recently changed first
    return pool.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit).map((n) => ({ id: n.id, score: 1, snippet: n.summary.slice(0, 110) }));
  }

  const hits: SearchHit[] = [];
  for (const n of pool) {
    const title = norm(n.title), tags = n.tags.map(norm), sum = norm(n.summary), hint = norm(n.poolHint);
    const body = norm(n.body), aloud = norm(n.readAloud), fields = norm(fieldText(n));
    let score = 0;
    let snippet = '';
    let all = true;
    for (const t of q.terms) {
      let s1 = 0;
      if (title === t) s1 = 30;
      else if (title.startsWith(t)) s1 = 16;
      else if (title.split(/[^a-z0-9]+/).some((w) => w.startsWith(t))) s1 = 12;
      else if (title.includes(t)) s1 = 8;
      if (tags.some((x) => x === t)) s1 = Math.max(s1, 9);
      else if (tags.some((x) => x.includes(t))) s1 = Math.max(s1, 5);
      if (!s1) {
        if (sum.includes(t)) { s1 = 4; snippet ||= snippetAround(n.summary, t); }
        else if (hint.includes(t)) { s1 = 3; snippet ||= snippetAround(n.poolHint, t); }
        else if (aloud.includes(t)) { s1 = 2; snippet ||= snippetAround(n.readAloud, t); }
        else if (body.includes(t)) { s1 = 2; snippet ||= snippetAround(n.body, t); }
        else if (fields.includes(t)) { s1 = 1; snippet ||= snippetAround(fieldText(n), t); }
      }
      if (!s1) { all = false; break; }
      score += s1;
    }
    if (!all) continue;
    if (placed(n)) score += 0.5; // story beats before loose prep, all else equal
    hits.push({ id: n.id, score, snippet: snippet || n.summary.slice(0, 110) });
  }
  return hits.sort((a, b) => b.score - a.score || s.nodes[a.id].title.localeCompare(s.nodes[b.id].title)).slice(0, limit);
}
