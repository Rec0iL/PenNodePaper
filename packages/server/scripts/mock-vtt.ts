// A minimal VTT for testing the bridge (and a reference for VTT authors; see docs/vtt-bridge-spec.md).
//   npx tsx scripts/mock-vtt.ts [ws://127.0.0.1:4317/bridge?token=...]
import fs from 'node:fs';
import { WebSocket } from 'ws';
import { BRIDGE_PROTOCOL, type BridgeFromVtt, type BridgeToVtt, type UpfCharacter, type VttProfile } from '@pnp/shared';

const move = [{ key: 'name', label: 'Move', type: 'text', required: true }, { key: 'text', label: 'Effect', type: 'longtext' }] as const;

/** What the real KINETIK VTT declares (generated from its rules): one enemy role per tier ladder, plus neutral NPCs. */
export const KINETIK_LIKE_PROFILE: VttProfile = {
  id: 'kinetik-vtt', name: 'KINETIK VTT', version: '0.0-mock', protocol: BRIDGE_PROTOCOL,
  push: {
    handout: { text: true, image: true, toPlayer: true },
    scene: { grids: ['square'], tokens: true },
    character: {},
  },
  characters: {
      roles: [
        {
          id: 'enemy', for: ['enemy'], label: 'Enemy', description: 'A combat opponent in the Kampf tab (with a token on request).', portrait: true,
          fields: [
            { key: 'tier', label: 'Tier', type: 'select', required: true, default: 'schlaeger', group: 'Basics', options: ['goon', 'schlaeger', 'elite', 'boss', 'nemesis'].map((value) => ({ value })) },
            { key: 'level', label: 'Level', type: 'number', min: 0, max: 10, step: 1, group: 'Basics' },
            { key: 'bonus', label: 'Bonus', type: 'number', min: -3, max: 20, step: 1, group: 'Basics' },
            { key: 'count', label: 'Group size', type: 'number', min: 1, max: 12, default: 3, group: 'Basics', showIf: { key: 'tier', equals: 'goon' } },
            { key: 'schutz', label: 'Protection', type: 'number', min: 0, max: 9, group: 'Resources', showIf: { key: 'tier', notEquals: 'goon' } },
            { key: 'wk', label: 'Willpower', type: 'number', min: 0, max: 30, group: 'Resources', showIf: { key: 'tier', notEquals: 'goon' } },
            { key: 'energie', label: 'Energy', type: 'number', min: 0, max: 30, default: 6, group: 'Resources' },
            { key: 'tags', label: 'Tags', type: 'tags', group: 'Status' },
            { key: 'moves', label: 'Moves', type: 'list', item: [...move] as never, group: 'Abilities' },
            { key: 'note', label: 'Behaviour / weakness', type: 'longtext', group: 'Notes' },
          ],
          presets: [
            { id: 'goon', label: 'Goon', values: { tier: 'goon', level: 0, bonus: 0, count: 3 }, ranges: { level: [0, 0], bonus: [0, 0] } },
            { id: 'schlaeger', label: 'Schläger', values: { tier: 'schlaeger', level: 2, bonus: 2, schutz: 0, wk: 4 }, ranges: { level: [1, 2], bonus: [2, 2] } },
          ],
        },
        {
          id: 'npc', for: ['npc'], label: 'NPC', description: 'A neutral figure: becomes a token with a note on the active scene.', portrait: true,
          fields: [{ key: 'note', label: 'Note under the token', type: 'text' }, { key: 'size', label: 'Size (cells)', type: 'number', min: 1, max: 4, default: 1 }],
        },
      ],
    },
  requests: ['tracks'],
  images: { maxBytes: 8_000_000, formats: ['png', 'jpg', 'webp'] },
  file: { kind: 'kinetik-session', version: 1 },
};

/** A totally different game: ability scores, hit points, armour class and attacks. Proves the sheet form is data-driven. */
export const D20_LIKE_PROFILE: VttProfile = {
  id: 'dungeon-table', name: 'Dungeon Table', version: '2.1', protocol: BRIDGE_PROTOCOL,
  push: {
    character: {},
  },
  characters: {
      roles: [
        {
          id: 'monster', label: 'Monster', portrait: true,
          fields: [
            { key: 'cr', label: 'Challenge rating', type: 'select', required: true, options: ['0', '1/8', '1/4', '1/2', '1', '2', '3', '5', '10'].map((value) => ({ value })) },
            { key: 'hp', label: 'Hit points', type: 'number', min: 1, max: 999, required: true },
            { key: 'ac', label: 'Armour class', type: 'number', min: 5, max: 30, required: true },
            { key: 'flying', label: 'Can fly', type: 'boolean' },
            { key: 'str', label: 'STR', type: 'number', min: 1, max: 30, default: 10, group: 'Abilities' },
            { key: 'dex', label: 'DEX', type: 'number', min: 1, max: 30, default: 10, group: 'Abilities' },
            { key: 'attacks', label: 'Attacks', type: 'list', item: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'toHit', label: 'To hit', type: 'number', min: -5, max: 20 }, { key: 'damage', label: 'Damage', type: 'text' }] },
          ],
          presets: [{ id: 'brute', label: 'Brute', values: { cr: '2', hp: 45, ac: 13, str: 18 }, ranges: { hp: [30, 70] } }],
        },
      ],
    },
  images: { formats: ['png'] },
};

/** KINETIK-like VTT that also reports its players' characters. */
export const PARTY_PROFILE: VttProfile = {
  ...KINETIK_LIKE_PROFILE,
  provides: { party: true },
  requests: ['tracks', 'party'],
  characters: {
    roles: [
      ...KINETIK_LIKE_PROFILE.characters!.roles,
      {
        id: 'pc', for: ['pc'], label: 'Player character', portrait: true,
        fields: [
          { key: 'concept', label: 'Concept', type: 'text', group: 'Identity' },
          { key: 'fokus', label: 'Fokus', type: 'number', min: 0, max: 10, group: 'Attributes' },
          { key: 'gewalt', label: 'Gewalt', type: 'number', min: 0, max: 10, group: 'Attributes' },
          { key: 'wk', label: 'Willpower', type: 'number', group: 'Resources' },
          { key: 'tags', label: 'Tags', type: 'tags' },
          { key: 'moves', label: 'Moves', type: 'list', item: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'text', label: 'Effect', type: 'longtext' }] },
        ],
      },
    ],
  },
};

export function connectMockVtt(url: string, profile: VttProfile = KINETIK_LIKE_PROFILE, log: (m: string) => void = () => {}, initialParty: UpfCharacter[] = []) {
  const received: BridgeToVtt[] = [];
  let party = initialParty;
  const ws = new WebSocket(url);
  const send = (m: BridgeFromVtt) => ws.send(JSON.stringify(m));
  ws.on('open', () => send({ t: 'hello', protocol: BRIDGE_PROTOCOL, profile }));
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as BridgeToVtt;
    received.push(m);
    if (m.t === 'push') {
      log(`push ${m.kind}: ${JSON.stringify({ ...m.payload, image: undefined, portrait: undefined }).slice(0, 160)}`);
      send({ t: 'result', id: m.id, ok: true });
    } else if (m.t === 'request' && m.what === 'party') {
      send({ t: 'result', id: m.id, ok: true, data: party });
    } else if (m.t === 'request') {
      send({ t: 'result', id: m.id, ok: true, data: [{ id: 'harbour-night', title: 'Harbour at night', category: 'ambient' }, { id: 'my-upload', title: 'My battle theme', uploaded: true }] });
    } else if (m.t === 'welcome') log(`connected to PenNodePaper campaign "${m.campaign}"`);
  });
  return {
    ws, received, close: () => ws.close(),
    /** the VTT reports a changed party on its own */
    setParty: (list: UpfCharacter[]) => { party = list; send({ t: 'party', characters: list }); },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] ?? 'ws://127.0.0.1:4317/bridge';
  connectMockVtt(url, KINETIK_LIKE_PROFILE, (m) => console.log(m));
  console.log('mock VTT connecting to', url.replace(/token=.*/, 'token=…'));
}

const readProfile = (file: string): VttProfile => JSON.parse(fs.readFileSync(new URL(`../../../docs/profiles/${file}`, import.meta.url), 'utf8'));
/** The profiles the two How to be a Hero VTTs really announce (generated from their pnpbridge.js), exactly as shipped in docs/profiles/. */
export const ELDARAHQ_PROFILE: VttProfile = readProfile('eldarahq.vtt-profile.json');
export const HEROHQ_PROFILE: VttProfile = readProfile('herohq.vtt-profile.json');
/** A VTT that DESCRIBES its characters but cannot import them (yet): HeroHQ's structure without push.character. */
export const STRUCTURE_ONLY_PROFILE: VttProfile = { ...HEROHQ_PROFILE, push: { handout: HEROHQ_PROFILE.push.handout } };
