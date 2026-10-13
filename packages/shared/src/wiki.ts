// The players' view of the campaign: only what they have actually experienced or learned, only text written for the players (the read-aloud block).
// Pure, so the Story tab, the export and the AI's tools all produce the same thing.
// Sessions: the GM's "End session" press leaves a mark (see SessionMark). A session's wiki is just what happened between two marks.
import type { CampaignState, SessionMark, StoryNode } from './index.js';
import { DEFAULT_GROUP, FLOW_TYPES, hereNodes, isKnown, nextPlayedSeq, visitSeqs, visitsOf, type Visit } from './story.js';

export interface WikiEntry {
  id: string;
  title: string;
  text: string;
  /** story entries: which part of the party it happened to (only when the party split up) */
  group?: string;
  /** session wikis: the players had already been here / knew this before — they came back to it */
  again?: boolean;
}

export interface PlayerWiki {
  campaign: string;
  /** set when this is the wiki of one session (otherwise: the whole campaign so far) */
  session?: { number: number; name: string; open: boolean; at?: string };
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

// ---------------------------------------------------------------- sessions ---

/** "all" = the whole campaign, "open" = the session in progress, "last" = the session that was ended most recently (the one to recap before the next), or a session's number. */
export type WikiScope = 'all' | 'open' | 'last' | number;

export const sessionsOf = (s: CampaignState): SessionMark[] => s.meta.sessions ?? [];
export const sessionLabel = (marks: SessionMark[], n: number) => marks[n - 1]?.name?.trim() || `Session ${n}`;

/** Parse what an AI tool or a URL passes ("last", "3", 3). */
export function parseScope(v: unknown): WikiScope {
  if (v === undefined || v === null || v === '') return 'all';
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1) return v;
  const t = String(v).trim().toLowerCase();
  if (t === 'all' || t === 'open' || t === 'last') return t;
  if (/^\d+$/.test(t) && Number(t) >= 1) return Number(t);
  throw new Error(`Unknown session "${v}" — use "last", "open", "all" or a session number`);
}

interface SessionWindow {
  number: number;
  open: boolean;
  /** exclusive lower bound / inclusive upper bound of the visit numbers */
  after: SessionMark | null;
  upTo: SessionMark | null;
}

/** The part of the campaign a scope covers; null = all of it. Throws on a session that does not exist. */
export function sessionWindow(s: CampaignState, scope: WikiScope): SessionWindow | null {
  const marks = sessionsOf(s);
  if (scope === 'all') return null;
  const n = scope === 'open' ? marks.length + 1 : scope === 'last' ? Math.max(1, marks.length) : scope;
  if (n > marks.length + 1) throw new Error(marks.length ? `There is no session ${n} — ${marks.length} session${marks.length > 1 ? 's' : ''} ended so far (the one in progress is ${marks.length + 1})` : 'No session has been ended yet — the whole story so far is the session in progress');
  return { number: n, open: n === marks.length + 1, after: marks[n - 2] ?? null, upTo: marks[n - 1] ?? null };
}

/** The ids the non-story lists hold: what a session mark remembers as "known by now". */
export function knownIds(w: PlayerWiki): string[] {
  return [...w.people, ...w.places, ...w.things, ...w.learned].map((e) => e.id);
}

export function playerWiki(s: CampaignState, scope: WikiScope = 'all'): PlayerWiki {
  const win = sessionWindow(s, scope);
  const nodes = Object.values(s.nodes).filter(playerKnows);
  const marks = sessionsOf(s);
  const lo = win?.after?.seq ?? 0;
  const hi = win?.upTo?.seq ?? Infinity;
  const inWindow = (seq: number) => seq > lo && seq <= hi;
  const wasKnown = new Set(win?.after?.known ?? []);
  const knownThen = win?.upTo ? new Set(win.upTo.known) : null;

  const split = new Set(Object.values(s.nodes).flatMap((n) => visitsOf(n).map((v) => v.group))).size > 1;
  const entry = (n: StoryNode, group?: string, again?: boolean): WikiEntry => ({
    id: n.id, title: n.title, text: playerText(n),
    ...(group && group !== DEFAULT_GROUP ? { group } : {}),
    ...(again ? { again: true } : {}),
  });
  // a visit counts for a session when its arrival or one of its later returns falls inside it
  const inside = (v: Visit) => visitSeqs(v).filter(inWindow);
  const visited = (n: StoryNode) => visitsOf(n).some((v) => inside(v).length);
  const firstSeq = (n: StoryNode) => Math.min(...visitsOf(n).flatMap(inside), Infinity);
  const before = (n: StoryNode) => (win ? visitsOf(n).some((v) => v.seq <= lo) : false);
  const firstGroup = (n: StoryNode) => visitsOf(n).filter((v) => inside(v).length).sort((x, y) => Math.min(...inside(x)) - Math.min(...inside(y)))[0].group;

  const story = nodes
    .filter((n) => FLOW_TYPES.has(n.type) && n.type !== 'clue' && visited(n))
    .sort((a, b) => firstSeq(a) - firstSeq(b))
    .map((n) => entry(n, split ? firstGroup(n) : undefined, before(n)));

  // people, places, things, clues: listed in a session when they are new then, or the players went back to them
  const inSession = (n: StoryNode) => {
    if (!win) return true;
    if (visited(n)) return true;
    return !wasKnown.has(n.id) && (!knownThen || knownThen.has(n.id));
  };
  const pick = (f: (n: StoryNode) => boolean) => nodes.filter((n) => f(n) && inSession(n)).map((n) => entry(n, undefined, win ? wasKnown.has(n.id) : false));
  const byTitle = (a: WikiEntry, b: WikiEntry) => a.title.localeCompare(b.title);
  return {
    campaign: s.meta.name,
    ...(win ? { session: { number: win.number, name: sessionLabel(marks, win.number), open: win.open, ...(win.upTo ? { at: win.upTo.at } : {}) } } : {}),
    story,
    people: pick((n) => PEOPLE.has(n.type)).sort(byTitle),
    places: pick((n) => n.type === 'location').sort(byTitle),
    things: pick((n) => n.type === 'item').sort(byTitle),
    learned: pick((n) => (n.type === 'clue' || n.type === 'lore') && isKnown(n)).sort(byTitle),
  };
}

export const wikiCount = (w: PlayerWiki) => w.story.length + w.people.length + w.places.length + w.things.length + w.learned.length;

export interface SessionInfo {
  number: number;
  name: string;
  open: boolean;
  at?: string;
  /** where the party stood when it ended (open session: where they are now) */
  endedAt: { id: string; title: string }[];
  counts: { story: number; people: number; places: number; things: number; learned: number };
  total: number;
}

/** Every session, oldest first, the one in progress last. */
export function sessionOverview(s: CampaignState): SessionInfo[] {
  const marks = sessionsOf(s);
  const title = (id: string) => (s.nodes[id] && !s.nodes[id].trashed ? [{ id, title: s.nodes[id].title }] : []);
  return Array.from({ length: marks.length + 1 }, (_, i) => {
    const w = playerWiki(s, i + 1);
    const open = i === marks.length;
    return {
      number: i + 1,
      name: sessionLabel(marks, i + 1),
      open,
      ...(open ? {} : { at: marks[i].at }),
      endedAt: open ? hereNodes(s).map((n) => ({ id: n.id, title: n.title })) : marks[i].here.flatMap(title),
      counts: { story: w.story.length, people: w.people.length, places: w.places.length, things: w.things.length, learned: w.learned.length },
      total: wikiCount(w),
    };
  });
}

/** A new session mark for "now" (the caller stores it); null when nothing happened since the last one. */
export function newSessionMark(s: CampaignState, name?: string, at = new Date().toISOString()): SessionMark | null {
  if (!wikiCount(playerWiki(s, 'open'))) return null;
  const clean = name?.trim().slice(0, 80);
  return {
    ...(clean ? { name: clean } : {}),
    at,
    seq: nextPlayedSeq(s) - 1,
    known: knownIds(playerWiki(s)),
    here: hereNodes(s).map((n) => n.id),
  };
}

// ---------------------------------------------------------------- markdown ---

export function wikiMarkdown(w: PlayerWiki): string {
  const sess = w.session;
  const out = [sess ? `# ${w.campaign || 'Campaign'} — ${sess.name}` : `# ${w.campaign || 'Campaign'} — what we know`, ''];
  const list = (title: string, items: WikiEntry[], numbered = false) => {
    if (!items.length) return;
    out.push(`## ${title}`, '');
    items.forEach((e, i) => {
      const tags = [e.group, e.again ? 'again' : ''].filter(Boolean).join(', ');
      out.push(`${numbered ? `${i + 1}.` : '-'} **${e.title}**${tags ? ` _(${tags})_` : ''}${e.text ? ` — ${e.text}` : ''}`);
    });
    out.push('');
  };
  list(sess ? 'What happened' : 'The story so far', w.story, true);
  list(sess ? 'People met' : 'People', w.people);
  list(sess ? 'Places' : 'Places', w.places);
  list('Things', w.things);
  list(sess ? 'What we learned' : 'What we have learned', w.learned);
  if (out.length === 2) out.push(sess ? '_Nothing happened in this session yet._' : '_Nothing yet — the adventure has just begun._', '');
  return out.join('\n').trimEnd() + '\n';
}
