// The players' view of the campaign: only what they have actually experienced or learned, only text written for the players (the read-aloud block).
// Pure, so the Story tab, the export and the AI's tools all produce the same thing.
import type { CampaignState, StoryNode } from './index.js';
import { DEFAULT_GROUP, FLOW_TYPES, isKnown, visitsOf } from './story.js';

export interface WikiEntry {
  id: string;
  title: string;
  text: string;
  /** story entries: which part of the party it happened to (only when the party split up) */
  group?: string;
}

export interface PlayerWiki {
  campaign: string;
  story: WikiEntry[];
  people: WikiEntry[];
  places: WikiEntry[];
  things: WikiEntry[];
  learned: WikiEntry[];
}

const PEOPLE = new Set(['npc', 'enemy', 'faction']);
const SKIP = new Set(['pc', 'annotation', 'table', 'clock', 'handout']);

/** What the players may see of a node: only what is read aloud to them. Summaries are the GM's card text and often give secrets away, so they are not used; GM notes (body) never. */
const playerText = (n: StoryNode) => n.readAloud.trim().replace(/\s*\n+\s*/g, ' ');

/** The players have been here, met this, or were told about it. */
export function playerKnows(n: StoryNode): boolean {
  if (n.trashed || SKIP.has(n.type) || n.status === 'skipped') return false;
  return visitsOf(n).length > 0 || n.fields.known === true || n.status === 'done' || n.status === 'active';
}

export function playerWiki(s: CampaignState): PlayerWiki {
  const nodes = Object.values(s.nodes).filter(playerKnows);
  const entry = (n: StoryNode, group?: string): WikiEntry => ({ id: n.id, title: n.title, text: playerText(n), ...(group && group !== DEFAULT_GROUP ? { group } : {}) });
  const firstSeq = (n: StoryNode) => Math.min(...visitsOf(n).map((v) => v.seq), Infinity);
  const split = new Set(Object.values(s.nodes).flatMap((n) => visitsOf(n).map((v) => v.group))).size > 1;

  const story = nodes
    .filter((n) => FLOW_TYPES.has(n.type) && n.type !== 'clue' && n.type !== 'portal' && visitsOf(n).length)
    .sort((a, b) => firstSeq(a) - firstSeq(b))
    .map((n) => entry(n, split ? visitsOf(n).sort((x, y) => x.seq - y.seq)[0].group : undefined));
  const byTitle = (a: WikiEntry, b: WikiEntry) => a.title.localeCompare(b.title);
  return {
    campaign: s.meta.name,
    story,
    people: nodes.filter((n) => PEOPLE.has(n.type)).map((n) => entry(n)).sort(byTitle),
    places: nodes.filter((n) => n.type === 'location').map((n) => entry(n)).sort(byTitle),
    things: nodes.filter((n) => n.type === 'item').map((n) => entry(n)).sort(byTitle),
    learned: nodes.filter((n) => (n.type === 'clue' || n.type === 'lore') && isKnown(n)).map((n) => entry(n)).sort(byTitle),
  };
}

export const wikiCount = (w: PlayerWiki) => w.story.length + w.people.length + w.places.length + w.things.length + w.learned.length;

export function wikiMarkdown(w: PlayerWiki): string {
  const out = [`# ${w.campaign || 'Campaign'} — what we know`, ''];
  const list = (title: string, items: WikiEntry[], numbered = false) => {
    if (!items.length) return;
    out.push(`## ${title}`, '');
    items.forEach((e, i) => out.push(`${numbered ? `${i + 1}.` : '-'} **${e.title}**${e.group ? ` _(${e.group})_` : ''}${e.text ? ` — ${e.text}` : ''}`));
    out.push('');
  };
  list('The story so far', w.story, true);
  list('People', w.people);
  list('Places', w.places);
  list('Things', w.things);
  list('What we have learned', w.learned);
  if (out.length === 2) out.push('_Nothing yet — the adventure has just begun._', '');
  return out.join('\n').trimEnd() + '\n';
}
