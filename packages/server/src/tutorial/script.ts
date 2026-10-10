import { guidanceOf, pickDemoScript, storyStatus, type CampaignState, type DemoScript } from '@pnp/shared';
import { PICTURES } from './assets.js';
import type { Store } from '../store.js';

// ---------------------------------------------------------------------------
// The scripted stand-in for the AI in a practice campaign. It answers the requests the tour (and the app's own AI buttons)
// send with a fixed session: it talks, calls the same commands a real AI calls — so everything animates, logs and undoes
// like the real thing — and says so when it is asked something it was not written for.
// ---------------------------------------------------------------------------

export type Beat =
  | { say: string | (() => string) }
  | { tool: string; args: Record<string, unknown> | (() => Record<string, unknown>); summary?: string; when?: () => boolean }
  | { pause: number };

export interface DemoCtx {
  store: Store;
  text: string;
  nodeId?: string;
}

const exists = (store: Store, id: string) => !!store.state.nodes[id] && !store.state.nodes[id].trashed;
const state = (store: Store) => store.state as CampaignState;
const q = (s: string) => `“${s}”`;

const PLACE_PROMPT = 'The Rusty Anchor, a rough medieval harbour tavern: a big taproom with worn planks, a stone-floored kitchen and a plank-floored store room. Warm lantern light, salt-stained dark wood, thick stone walls.';

function brenn(c: DemoCtx): Beat[] {
  const s = c.store;
  return [
    { say: 'Happy to. Let me look at the story around the Rusty Anchor first, then I will give it people and a lead.' },
    { tool: 'get_graph', args: {}, summary: 'the whole campaign' },
    { tool: 'place_on_canvas', args: { id: 'rusty-anchor', nearNodeId: 'arrival' }, when: () => !state(s).graph.placements['rusty-anchor'] && exists(s, 'rusty-anchor') },
    {
      tool: 'create_node', when: () => !exists(s, 'brenn'),
      args: {
        id: 'brenn', type: 'npc', title: 'Brenn the barkeep', place: 'canvas', nearNodeId: 'rusty-anchor', linkTo: 'rusty-anchor', linkKind: 'belongs-to', fields: { tier: 'elite' },
        summary: 'Knows the cult by their coin: black pennies.',
        body: '**Wants:** to keep his tavern out of the cult’s business.\n\n**Knows:** who pays with black pennies — and where they go afterwards.\n\n**Tell:** polishes the same tankard whenever he lies.',
        readAloud: '“Black pennies? Aye, I know the coin. Heavy as sin, cold as the deep. Buy a round and I might remember who spends them.”',
      },
    },
    {
      tool: 'create_node', when: () => !exists(s, 'penny-rumour'),
      args: {
        id: 'penny-rumour', type: 'clue', title: 'Rumour: the black pennies', place: 'canvas', nearNodeId: 'brenn', linkFrom: 'brenn', linkKind: 'reveals', linkLabel: 'for a drink',
        summary: 'Whoever pays with black pennies rings the thirteenth bell.',
        body: 'Brenn shares it only after the players buy a round, or if Orla vouches for them.\n\nPoints at the clock tower and the ritual.',
      },
    },
    { tool: 'link', args: { from: 'penny-rumour', to: 'cult-reveal', kind: 'foreshadows', label: 'the bell' }, when: () => exists(s, 'penny-rumour') && !state(s).graph.edges.some((e) => e.from === 'penny-rumour' && e.to === 'cult-reveal') },
    {
      tool: 'create_node', when: () => !exists(s, 'black-penny'),
      args: { id: 'black-penny', type: 'item', title: 'The black penny', summary: 'A tarnished, strangely heavy coin stamped with a tiny bell.', poolHint: 'When a player pockets one, or when Brenn shows it.' },
    },
    {
      tool: 'update_node', when: () => exists(s, 'rusty-anchor') && !state(s).nodes['rusty-anchor'].body.includes('Brenn knows the cult'),
      args: () => ({ id: 'rusty-anchor', body: `${state(s).nodes['rusty-anchor'].body.trim()}\n\nBrenn knows the cult by their coin. Buy him a round and he talks.` }),
    },
    {
      say: 'Done. Brenn now tends the Rusty Anchor, a rumour about the black pennies hangs off him (and foreshadows the bell), and the penny itself waits in the pool in case a player pockets one. All of it is in the activity log below, one undo step each.\n\n💡 Idea: Brenn owes the cult a debt, so he sells out the players at the worst moment. Say “yes” and I will add it.',
    },
  ];
}

function patrol(c: DemoCtx): Beat[] {
  const s = c.store;
  return [
    { say: 'A night patrol should do it: the Guild takes the curfew seriously, and it pressures the players without a fight they cannot avoid.' },
    {
      tool: 'create_node', when: () => !exists(s, 'night-patrol'),
      args: {
        id: 'night-patrol', type: 'encounter', title: 'Night patrol of the Guild', place: 'canvas', nearNodeId: 'missing-ledger', linkFrom: 'missing-ledger', linkKind: 'conditional', linkLabel: 'if they snoop after dark',
        summary: 'Two Guild brutes enforce the curfew with lanterns and clubs.',
        body: 'They want a bribe or a name. A clever answer sends them away; a fight draws the whole quay.',
        readAloud: 'Boots on wet stone, then two lanterns swing out of the fog. “Curfew,” says the taller one. “Names, and what’s in the bag.”',
      },
    },
    { tool: 'update_node', args: { id: 'smugglers-cove', summary: 'Night fight under the cliffs — if the Guild patrol has not driven the smugglers off first.' } },
    { say: 'That is a new encounter hanging off the ledger clue, plus a small change to the cove. I applied them right away; in review mode you would now decide to keep or reject them.' },
  ];
}

function bridge(c: DemoCtx): Beat[] {
  const s = c.store;
  const guidance = guidanceOf(c.text);
  const st = () => storyStatus(state(s));
  const here = () => st().groups.flatMap((g) => g.here)[0]?.id ?? st().played.at(-1)?.id;
  const target = () => st().frontier.find((f) => f.converges && f.id !== 'bridge-lead') ?? st().frontier.find((f) => f.id !== 'bridge-lead');
  /** where the bridge rejoins: chosen before the bridge exists (afterwards the bridge itself is the nearest unplayed node) */
  let rejoin: string | undefined;
  const title = (id?: string) => (id && state(s).nodes[id]?.title) || 'the story';
  return [
    { say: 'On it. First where the party is and what they have bypassed.' },
    { tool: 'story_status', args: {}, summary: 'where the players are' },
    {
      say: () => {
        const x = st();
        if (!x.played.length) return 'Nobody has been marked as played yet. Press “Players are here” on a node first, then ask me again.';
        const skipped = x.skippedPast.map((k) => q(k.title));
        const unknown = x.unrevealed.map((u) => q(u.title));
        const t = target();
        return [
          `The party is at ${q(title(here()))}.`,
          skipped.length ? `They bypassed ${skipped.join(', ')}.` : 'They have not bypassed anything yet.',
          unknown.length ? `They do not know ${unknown.slice(0, 2).join(' and ')} yet, which costs the story its trail to the cult.` : '',
          t ? `The best place to merge back is ${q(t.title)}${t.converges ? ' (several paths meet there)' : ''}.` : '',
          guidance ? `You gave me a railguard — ${q(guidance)} — so the bridge follows that.` : 'You gave me no railguard, so I choose how the bridge goes: one short beat that points at where the story continues.',
        ].filter(Boolean).join(' ');
      },
    },
    {
      tool: 'create_node', when: () => !!here() && !exists(s, 'bridge-lead'),
      args: () => {
        const short = /short|brief|quick|one line/i.test(guidance);
        rejoin = target()?.id;
        return {
          id: 'bridge-lead', type: 'scene', title: guidance ? 'A lead on the quay (as you asked)' : 'A lead on the quay', place: 'canvas', nearNodeId: here(),
          linkFrom: here(), linkKind: 'bridge', linkLabel: 'back on track',
          summary: short ? 'A dockhand presses a clue into their hands.' : 'A dockhand follows them, nervous, and offers a lead that points at where the story goes on.',
          body: `${guidance ? `**Railguard from the GM:** ${guidance}\n\n` : ''}A bridge, not a railroad: it works whatever the players did before.\n\nThe dockhand knows where the ledger pages went and why the bell rings thirteen.`,
          readAloud: '“Psst. You looked like people who ask questions. Meet me where the cove meets the tide, and I’ll show you what the harbour master hides.”',
        };
      },
    },
    { tool: 'link', args: () => ({ from: 'bridge-lead', to: rejoin!, kind: 'bridge', label: 'rejoins here' }), when: () => exists(s, 'bridge-lead') && !!rejoin && !state(s).graph.edges.some((e) => e.from === 'bridge-lead') },
    {
      tool: 'update_node', when: () => !!st().unrevealed[0] && !state(s).nodes[st().unrevealed[0].id]?.body.includes('Second way in'),
      args: () => {
        const u = st().unrevealed[0];
        return { id: u.id, body: `${state(s).nodes[u.id].body.trim()}\n\n**Second way in:** the dockhand from the bridge can tell the players the same thing, if they never found it themselves.`.trim() };
      },
    },
    { say: 'The bridge is in place and linked with green “bridge” edges, and the clue they missed has a second way in. I did not delete or rewrite anything that already happened.' },
  ];
}

function recap(c: DemoCtx): Beat[] {
  const s = c.store;
  return [
    { say: 'A recap needs to stay spoiler-free, so I will only use what the players have actually experienced.' },
    { tool: 'player_wiki', args: {}, summary: 'what the players know' },
    {
      tool: 'create_node', when: () => !exists(s, 'recap-previously'),
      args: () => {
        const played = storyStatus(state(s)).played.map((p) => state(s).nodes[p.id]).filter(Boolean);
        const beats = played.map((n) => n.readAloud.split(/(?<=[.!?”])\s/)[0] || n.title).slice(0, 4);
        return {
          id: 'recap-previously', type: 'handout', title: 'Previously…', place: 'pool', poolHint: 'Read it at the start of the next session or send it to the VTT.',
          summary: 'Narrator recap of the story so far, built from what the players experienced.',
          readAloud: `Previously, in Greywater… ${beats.length ? beats.join(' ') : 'The fog had only just rolled in.'} And somewhere above the harbour, a bell was still counting.`,
        };
      },
    },
    { say: 'It is in the pool as a handout called “Previously…”, written only from the players’ read-aloud text. From the Inspector you could send it to a VTT.' },
  ];
}

function fillTable(c: DemoCtx): Beat[] {
  const id = /\(node ([\w-]+)\)/.exec(c.text)?.[1] ?? c.nodeId ?? 'harbour-rumours';
  return [
    { say: 'Let me check the lore first so the entries fit the harbour.' },
    { tool: 'search_world', args: { query: 'harbour cult bell black pennies' }, summary: 'greywater_lore' },
    {
      tool: 'set_table',
      args: {
        nodeId: id, append: true,
        entries: [
          'Salt on the threshold of the clock tower, though nobody has used it in years.',
          'A child sings a counting rhyme that ends on thirteen.',
          '2× The tide came in an hour early last night.',
          'Someone left a black penny on the harbour master’s desk.',
          'The lamplighter refuses to light the east quay.',
        ],
      },
    },
    { say: 'Five new entries added, one of them twice as likely. The die grows with the table; roll it with the 🎲 on the card.' },
  ];
}

function imagePrompt(c: DemoCtx): Beat[] {
  const id = c.nodeId ?? '';
  const n = c.store.state.nodes[id];
  const mine = PICTURES.find((p) => p.nodeId === id);
  const kind = /kind "(\w+)"/.exec(c.text)?.[1] ?? mine?.kind ?? 'scene';
  const variants = Number(/(\d) variants?/.exec(c.text)?.[1] ?? 1);
  return [
    { say: 'Let me read the node and the campaign’s image style, then I will write a prompt for it.' },
    { tool: 'get_node', args: { id }, summary: n?.title },
    { tool: 'get_image_style', args: {} },
    {
      tool: 'generate_image', summary: 'queued',
      args: { nodeId: id, kind, variants, prompt: mine?.prompt ?? `${n?.title ?? 'A scene'}. ${n?.summary ?? ''} Moody, atmospheric, fog-bound harbour town at dusk.` },
    },
    { say: 'Queued. Watch the card and the Inspector: the picture attaches itself when it is ready.' },
  ];
}

function mapPrompt(c: DemoCtx): Beat[] {
  const node = c.nodeId ? c.store.state.nodes[c.nodeId] : undefined;
  const mapId = typeof node?.fields.mapId === 'string' ? node.fields.mapId : '';
  return [
    { say: 'I will describe the place without furniture (that comes in step 2) and start the terrain.' },
    { tool: 'get_map', args: { mapId }, summary: mapId },
    { tool: 'render_map', args: { mapId, prompt: PLACE_PROMPT, fidelity: 'balanced', variants: 2 }, summary: 'terrain, 2 variants' },
    { say: 'The empty terrain is being painted. This takes a while on a real computer, so pick one in the Paint tab when they are ready; I will not paint the props before you have chosen.' },
  ];
}

const FALLBACK: Beat[] = [
  {
    say: 'I am the tutorial’s stand-in for the AI: I only know the requests this tour prepares, so I cannot answer that one. Use the message the tour typed for you, or one of the AI buttons.\n\nTo get a real co-GM install Claude or agy (see ⚙ and docs/INSTALL.md) and open a normal campaign — it can do everything you see here, and much more.',
  },
];

export function beatsFor(id: DemoScript, c: DemoCtx): Beat[] {
  switch (id) {
    case 'brenn': return brenn(c);
    case 'patrol': return patrol(c);
    case 'bridge': return bridge(c);
    case 'recap': return recap(c);
    case 'fill-table': return fillTable(c);
    case 'image-prompt': return imagePrompt(c);
    case 'map-prompt': return mapPrompt(c);
    default: return FALLBACK;
  }
}

export const scriptFor = (text: string): DemoScript => pickDemoScript(text);
