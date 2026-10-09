import type { CampaignState, StoryNode } from './index.js';

// ---------------------------------------------------------------------------
// Story analysis: pure functions over the campaign state, used by the UI (live)
// and by the AI's tools (lint_story, story_status), so both always agree.
//   * played path per group / "you are here" (parties can split up)
//   * linter: dead ends, unreachable nodes, unfindable clues, decisions without branches…
//   * reconverge report: where the story can rejoin, what was skipped, what the players don't know
// ---------------------------------------------------------------------------

/** Nodes that take part in the story's flow (the rest are reference material). */
export const FLOW_TYPES = new Set(['scene', 'encounter', 'event', 'clue', 'decision']);
const FLOW_EDGES = new Set(['leads-to', 'conditional', 'bridge']);
const SECRET_TYPES = new Set(['clue']);

/** What the players can be "at" — the story beats plus the places and people they walk up to. */
export const VISITABLE_TYPES = new Set([...FLOW_TYPES, 'location', 'npc', 'enemy', 'faction']);

/** How the GM can mark a node at the table (the same list in the inspector and the right-click menu). */
export const STATUS_CHOICES: { id: 'untouched' | 'active' | 'done' | 'skipped'; label: string; icon: string; help: string }[] = [
  { id: 'untouched', label: 'Untouched', icon: '○', help: 'Not played — also forgets that the players were here' },
  { id: 'active', label: 'Active', icon: '◉', help: 'In play right now (a running event, a place they might return to). Does not move the players' },
  { id: 'done', label: 'Done', icon: '✓', help: 'Played' },
  { id: 'skipped', label: 'Skipped', icon: '⤼', help: 'Deliberately bypassed' },
];

export const DEFAULT_GROUP = 'party';

/** Display name of a fragment of the party: everyone = "party", otherwise the first names, e.g. "Jin & Mia". */
export function fragmentName(memberTitles: string[], totalPlayers: number): string {
  if (!memberTitles.length || memberTitles.length >= totalPlayers) return DEFAULT_GROUP;
  const first = memberTitles.map((t) => t.trim().split(/\s+/)[0] || t).sort((a, b) => a.localeCompare(b));
  const named = first.length > 3 ? `${first.slice(0, 2).join(', ')} +${first.length - 2}` : first.join(' & ');
  return named.slice(0, 40);
}

const GROUP_COLORS = ['#ffd166', '#7aa2ff', '#7fe0a0', '#f2a1c8', '#b89cff', '#5fd4c4', '#ff9966', '#e0c36a'];
/** A stable colour per group name, so a group keeps its colour on the canvas, in the Story tab and in chat. */
export function groupColor(group: string): string {
  if (group === DEFAULT_GROUP) return GROUP_COLORS[0];
  let h = 0;
  for (const c of group) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return GROUP_COLORS[1 + (h % (GROUP_COLORS.length - 1))];
}

export type IssueLevel = 'warn' | 'info';
export interface Issue {
  level: IssueLevel;
  code: string;
  nodeId?: string;
  message: string;
}

const alive = (s: CampaignState) => Object.values(s.nodes).filter((n) => !n.trashed);
const placed = (s: CampaignState, id: string) => !!s.graph.placements[id];

// ------------------------------------------------------------------ visits ---

/** One group's visit to a node. `seq` is global, so the groups' trails interleave in real order. */
export interface Visit {
  group: string;
  seq: number;
  here: boolean;
}

/** Visits stored on a node. Nodes tracked before groups existed carry just `playedSeq`: that is the one party. */
export function visitsOf(n: StoryNode): Visit[] {
  const v = n.fields.visits;
  if (Array.isArray(v)) {
    return v.flatMap((x): Visit[] => {
      const o = x as Partial<Visit>;
      return o && typeof o.group === 'string' && typeof o.seq === 'number' ? [{ group: o.group, seq: o.seq, here: o.here === true }] : [];
    });
  }
  return typeof n.fields.playedSeq === 'number' ? [{ group: DEFAULT_GROUP, seq: n.fields.playedSeq, here: n.status === 'active' }] : [];
}

/** Played = some group has been there (or the GM marked it done/active by hand). */
export const isPlayed = (n: StoryNode) => visitsOf(n).length > 0 || n.status === 'done' || n.status === 'active';
export const isKnown = (n: StoryNode) => n.fields.known === true || n.status === 'done';

export const nextPlayedSeq = (s: CampaignState): number => Math.max(0, ...alive(s).flatMap((n) => visitsOf(n).map((v) => v.seq))) + 1;

/** All groups that have been tracked, in order of first appearance. */
export function groupsOf(s: CampaignState): string[] {
  const first = new Map<string, number>();
  for (const n of alive(s)) for (const v of visitsOf(n)) first.set(v.group, Math.min(first.get(v.group) ?? Infinity, v.seq));
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([g]) => g);
}

export interface PathStep {
  id: string;
  title: string;
  seq: number;
  group: string;
  here: boolean;
  status: string;
}

/** The trail of one group (or of everybody, interleaved in real order). */
export function playedPath(s: CampaignState, group?: string): PathStep[] {
  return alive(s)
    .flatMap((n) => visitsOf(n).filter((v) => !group || v.group === group).map((v) => ({ id: n.id, title: n.title, seq: v.seq, group: v.group, here: v.here, status: n.status })))
    .sort((a, b) => a.seq - b.seq);
}

/** Where each group stands right now. */
export function hereByGroup(s: CampaignState): { group: string; nodes: { id: string; title: string }[] }[] {
  return groupsOf(s)
    .map((group) => ({ group, nodes: alive(s).filter((n) => visitsOf(n).some((v) => v.group === group && v.here)).map((n) => ({ id: n.id, title: n.title })) }))
    .filter((g) => g.nodes.length);
}

/** Everyone's current nodes: a node somebody is at, else (hand-set statuses) the active ones, else the latest played. */
export function hereNodes(s: CampaignState): StoryNode[] {
  const at = alive(s).filter((n) => visitsOf(n).some((v) => v.here));
  if (at.length) return at;
  const active = alive(s).filter((n) => n.status === 'active');
  if (active.length) return active;
  const last = playedPath(s).at(-1);
  return last ? [s.nodes[last.id]] : [];
}

/**
 * Trail edges (edgeId → group): the group went from one end to the other. A group that has just split off the
 * main party starts its trail from where it branched, so its first step continues from the node the party left.
 */
export function trailEdges(s: CampaignState): Map<string, string> {
  const firstSeq = new Map<string, number>();
  for (const n of alive(s)) for (const v of visitsOf(n)) firstSeq.set(v.group, Math.min(firstSeq.get(v.group) ?? Infinity, v.seq));
  const out = new Map<string, string>();
  for (const e of s.graph.edges) {
    const a = s.nodes[e.from];
    const b = s.nodes[e.to];
    if (!a || !b || a.trashed || b.trashed || e.noTrail) continue;
    const va = visitsOf(a);
    for (const vb of visitsOf(b)) {
      const sameGroup = va.some((x) => x.group === vb.group && vb.seq > x.seq);
      const splitOff = vb.seq === firstSeq.get(vb.group) && va.some((x) => x.seq < vb.seq);
      if (sameGroup || splitOff) {
        out.set(e.id, vb.group);
        break;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ clocks ---

export interface ClockState {
  segments: number;
  filled: number;
  consequence: string;
  full: boolean;
}
export function clockOf(n: StoryNode): ClockState {
  const segments = Math.max(2, Math.min(24, Math.round(Number(n.fields.segments) || 6)));
  const filled = Math.max(0, Math.min(segments, Math.round(Number(n.fields.filled) || 0)));
  return { segments, filled, consequence: String(n.fields.consequence ?? ''), full: filled >= segments };
}

// --------------------------------------------------------------- adjacency ---

interface Adj {
  out: Map<string, { to: string; label: string; kind: string }[]>;
  in: Map<string, { from: string; label: string; kind: string }[]>;
}

/** Adjacency over live nodes. `flowOnly` restricts to leads-to / conditional / bridge. */
export function adjacency(s: CampaignState, flowOnly = false): Adj {
  const ids = new Set(alive(s).map((n) => n.id));
  const out: Adj['out'] = new Map();
  const inn: Adj['in'] = new Map();
  for (const e of s.graph.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    if (flowOnly && !FLOW_EDGES.has(e.kind)) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push({ to: e.to, label: e.label, kind: e.kind });
    (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)!).push({ from: e.from, label: e.label, kind: e.kind });
  }
  return { out, in: inn };
}

// ------------------------------------------------------------------ linter ---

export function lintStory(s: CampaignState): Issue[] {
  const issues: Issue[] = [];
  const nodes = alive(s);
  const flow = nodes.filter((n) => FLOW_TYPES.has(n.type) && placed(s, n.id));
  const all = adjacency(s);
  const f = adjacency(s, true);
  const add = (level: IssueLevel, code: string, n: StoryNode | undefined, message: string) => issues.push({ level, code, nodeId: n?.id, message });

  for (const n of flow) {
    const outs = f.out.get(n.id) ?? [];
    const ins = all.in.get(n.id) ?? [];
    const flowIns = f.in.get(n.id) ?? [];
    const reveals = (all.out.get(n.id) ?? []).filter((e) => e.kind === 'reveals');

    if (n.type === 'decision' && outs.length < 2) add('warn', 'decision-branches', n, `Decision “${n.title}” has ${outs.length} way(s) forward — a decision needs at least two.`);
    else if (!outs.length && !reveals.length && n.status !== 'done' && flow.length > 1) add('info', 'dead-end', n, `“${n.title}” leads nowhere (end of this branch).`);

    if (n.type === 'clue') {
      const finders = ins.filter((e) => e.kind !== 'foreshadows');
      if (!finders.length) add('warn', 'clue-unreachable', n, `Nothing leads to the clue “${n.title}” — the players cannot find it.`);
    } else if (!flowIns.length && !ins.some((e) => e.kind === 'reveals')) {
      // roots: fine once (the start), noteworthy when there are several separate chains
      const roots = flow.filter((x) => !(f.in.get(x.id) ?? []).length && !(all.in.get(x.id) ?? []).some((e) => e.kind === 'reveals'));
      if (roots.length > 1 && n.type !== 'event') add('info', 'separate-chain', n, `“${n.title}” has no way in — it starts a separate chain (${roots.length} chains in total).`);
    }

    if (n.tags.includes('key')) {
      const ways = new Set(ins.filter((e) => e.kind !== 'foreshadows').map((e) => e.from));
      if (ways.size < 3) add('warn', 'three-clues', n, `“${n.title}” is marked key but only ${ways.size} path(s) lead to it — aim for three so a missed clue doesn't stall the story.`);
    }
    if (flowIns.length && flowIns.every((e) => e.kind === 'conditional') && n.type !== 'decision') add('info', 'only-conditional', n, `“${n.title}” can only be reached conditionally — add an unconditional way in or an alternative.`);
  }

  for (const n of nodes) {
    if (n.type === 'clock') {
      const c = clockOf(n);
      if (c.full && n.status !== 'done') add('warn', 'clock-full', n, `Clock “${n.title}” is full — its consequence is due${c.consequence ? `: ${c.consequence}` : ''}.`);
      else if (!c.consequence) add('info', 'clock-consequence', n, `Clock “${n.title}” has no consequence written down.`);
    }
    if (!n.summary.trim() && n.type !== 'annotation') add('info', 'empty-summary', n, `“${n.title}” has no summary (its card is empty).`);
    if (!placed(s, n.id) && n.type !== 'annotation' && n.type !== 'pc' && !n.poolHint.trim() && !n.tags.length) add('info', 'pool-hint', n, `Pool node “${n.title}” has no hint about when it might come up.`);
    if (placed(s, n.id) && !FLOW_TYPES.has(n.type) && !['annotation', 'handout', 'table', 'clock'].includes(n.type) && !(all.out.get(n.id)?.length || all.in.get(n.id)?.length)) {
      add('info', 'isolated', n, `${n.type} “${n.title}” is on the canvas but not connected to anything.`);
    }
  }

  // titles mentioned in text but not linked (catches NPCs/places named in passing)
  const linked = (a: string, b: string) => s.graph.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  let mentions = 0;
  for (const n of nodes) {
    const hay = `${n.summary} ${n.body} ${n.readAloud}`.toLowerCase();
    if (!hay.trim()) continue;
    for (const m of nodes) {
      if (m.id === n.id || m.type === 'annotation' || m.type === 'pc' || m.title.trim().length < 4 || mentions >= 20) continue;
      if (hay.includes(m.title.trim().toLowerCase()) && !linked(n.id, m.id)) {
        add('info', 'unlinked-mention', n, `“${n.title}” mentions “${m.title}” but they are not connected.`);
        mentions++;
      }
    }
  }
  return issues.sort((a, b) => Number(b.level === 'warn') - Number(a.level === 'warn'));
}

// ---------------------------------------------------------------- reconverge ---

export interface FrontierNode {
  id: string;
  title: string;
  type: string;
  hops: number;
  downstream: number;
  /** several planned paths meet here */
  converges: boolean;
  viaLabel?: string;
  /** reachable from where the players are now (else: a way back into the main line from something played earlier) */
  fromHere: boolean;
  /** which groups can get here (when the party has split) */
  groups: string[];
}

export interface StoryStatus {
  /** everybody's trail, in real order; each step says which group it was */
  played: PathStep[];
  groups: { group: string; members: string[]; here: { id: string; title: string }[]; path: PathStep[] }[];
  here: { id: string; title: string }[];
  /** Unplayed nodes the story can pick up next, best merge points first. */
  frontier: FrontierNode[];
  /** Split parties: unplayed nodes that more than one group can reach — where they can come together again. */
  meetingPoints: { id: string; title: string; groups: string[] }[];
  /** Planned nodes that lie BEFORE something already played — the players bypassed them. */
  skippedPast: { id: string; title: string; type: string; explicit: boolean }[];
  /** A fork where the players took one way: the roads not taken. */
  untaken: { from: string; fromTitle: string; to: string; toTitle: string; label: string }[];
  /** Clues/secrets the players do not know yet, and what each would have opened up. */
  unrevealed: { id: string; title: string; placed: boolean; opens: string[] }[];
  clocks: { id: string; title: string; filled: number; segments: number; full: boolean; consequence: string }[];
}

function reach(adj: Map<string, { to: string }[]>, start: string, cap = 60): Set<string> {
  const seen = new Set<string>();
  const q = [start];
  while (q.length && seen.size < cap) {
    for (const e of adj.get(q.shift()!) ?? []) if (!seen.has(e.to) && e.to !== start) (seen.add(e.to), q.push(e.to));
  }
  return seen;
}

export function storyStatus(s: CampaignState): StoryStatus {
  const nodes = alive(s);
  const f = adjacency(s, true);
  const all = adjacency(s);
  const played = nodes.filter(isPlayed);
  const playedIds = new Set(played.map((n) => n.id));
  const unplayedFlow = (id: string) => !playedIds.has(id) && FLOW_TYPES.has(s.nodes[id]?.type ?? '');
  const groupNames = groupsOf(s);

  // skipped past: unplayed nodes that can still reach something already played
  const skipped = new Map<string, boolean>();
  for (const p of played) {
    const back = new Set<string>();
    const q = [p.id];
    while (q.length && back.size < 200) for (const e of f.in.get(q.shift()!) ?? []) if (!back.has(e.from)) (back.add(e.from), q.push(e.from));
    for (const id of back) if (unplayedFlow(id) && placed(s, id)) skipped.set(id, s.nodes[id].status === 'skipped');
  }
  for (const n of nodes) if (n.status === 'skipped' && FLOW_TYPES.has(n.type)) skipped.set(n.id, true);
  const skippedPast = [...skipped.entries()].map(([id, explicit]) => ({ id, title: s.nodes[id].title, type: s.nodes[id].type, explicit }));

  // frontier: BFS forward from where the players are, through unplayed nodes. When that branch dead-ends
  // (a detour), also look from everything already played: that is where the main line can be re-entered.
  // Bypassed content is listed under "skipped", not offered as a way forward.
  type Hit = { hops: number; label?: string; fromHere: boolean; groups: Set<string> };
  const dist = new Map<string, Hit>();
  const bfs = (starts: string[], fromHere: boolean, group: string | null) => {
    let layer = starts;
    const seenHere = new Set<string>(starts);
    for (let hops = 1; hops <= 5 && layer.length; hops++) {
      const next: string[] = [];
      for (const id of layer) {
        for (const e of f.out.get(id) ?? []) {
          if (playedIds.has(e.to) || skipped.has(e.to) || seenHere.has(e.to)) continue;
          seenHere.add(e.to);
          const cur = dist.get(e.to);
          if (cur) {
            if (group) cur.groups.add(group);
            cur.hops = Math.min(cur.hops, hops);
          } else dist.set(e.to, { hops, label: e.label || undefined, fromHere, groups: new Set(group ? [group] : []) });
          next.push(e.to);
        }
      }
      layer = next;
    }
  };
  const byGroup = hereByGroup(s);
  if (byGroup.length) for (const g of byGroup) bfs(g.nodes.map((x) => x.id), true, g.group);
  else bfs(hereNodes(s).map((n) => n.id), true, null);
  if (dist.size < 3) bfs(played.map((n) => n.id), false, null);

  const frontier: FrontierNode[] = [...dist.entries()]
    .map(([id, d]) => ({
      id, title: s.nodes[id].title, type: s.nodes[id].type, hops: d.hops, downstream: reach(f.out, id).size,
      converges: (f.in.get(id) ?? []).length >= 2, viaLabel: d.label, fromHere: d.fromHere, groups: [...d.groups],
    }))
    .sort((a, b) => Number(b.fromHere) - Number(a.fromHere) || b.groups.length - a.groups.length || Number(b.converges) - Number(a.converges) || a.hops - b.hops || b.downstream - a.downstream)
    .slice(0, 10);
  // nearest meeting points only: drop those that every group can reach solely through an earlier meeting point
  const shared = new Set(frontier.filter((x) => x.groups.length > 1).map((x) => x.id));
  const meetingPoints = frontier
    .filter((x) => shared.has(x.id) && !((f.in.get(x.id) ?? []).length > 0 && (f.in.get(x.id) ?? []).every((e) => shared.has(e.from))))
    .map((x) => ({ id: x.id, title: x.title, groups: x.groups }));

  // roads not taken
  const untaken: StoryStatus['untaken'] = [];
  for (const p of played) {
    const outs = f.out.get(p.id) ?? [];
    if (outs.length < 2 || !outs.some((e) => playedIds.has(e.to))) continue;
    for (const e of outs) if (!playedIds.has(e.to)) untaken.push({ from: p.id, fromTitle: p.title, to: e.to, toTitle: s.nodes[e.to].title, label: e.label });
  }

  const unrevealed = nodes
    .filter((n) => (SECRET_TYPES.has(n.type) || n.tags.includes('secret')) && !isKnown(n))
    .map((n) => ({
      id: n.id, title: n.title, placed: placed(s, n.id),
      opens: (all.out.get(n.id) ?? []).filter((e) => e.kind === 'reveals').map((e) => s.nodes[e.to].title),
    }));

  const clocks = nodes.filter((n) => n.type === 'clock').map((n) => ({ id: n.id, title: n.title, ...clockOf(n) }));

  return {
    played: playedPath(s),
    groups: groupNames.map((group) => ({
      group,
      members: nodes.filter((n) => n.type === 'pc' && n.fields.present !== false && ((n.fields.group as string) || DEFAULT_GROUP) === group).map((n) => n.title),
      here: byGroup.find((g) => g.group === group)?.nodes ?? [], path: playedPath(s, group),
    })),
    here: hereNodes(s).map((n) => ({ id: n.id, title: n.title })),
    frontier, meetingPoints, skippedPast, untaken, unrevealed, clocks,
  };
}
