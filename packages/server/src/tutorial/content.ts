import type { EdgeKind, NodeType } from '@pnp/shared';

// ---------------------------------------------------------------------------
// The practice campaign of the welcome tour ("Greywater"). Everything the tour points at lives here, with fixed ids,
// so the tour can find it again and heal it when someone deletes a node (see ensure.ts).
// ---------------------------------------------------------------------------

export interface SeedNode {
  id: string;
  type: NodeType;
  title: string;
  summary: string;
  body?: string;
  readAloud?: string;
  tags?: string[];
  poolHint?: string;
  fields?: Record<string, unknown>;
  /** canvas position; no position = the node waits in the pool */
  at?: { x: number; y: number };
}

export const CAMPAIGN_NAME = 'Greywater (practice campaign)';

export const SEED_NODES: SeedNode[] = [
  {
    id: 'arrival', type: 'scene', title: 'Arrival at Greywater', at: { x: 0, y: 0 }, tags: ['act-1'],
    summary: 'The party reaches a fog-bound harbour town at dusk.',
    body: 'The ferry docks late. Lanterns are lit but few people are out.\n\n- The harbour master asks for a toll.\n- Someone is watching from the clock tower.\n- If the players linger: a bell strikes once, and nobody on the pier reacts to it.',
    readAloud: 'The ferry bumps against the dock. Fog swallows the far end of the pier, and somewhere above you a bell strikes once.',
  },
  {
    id: 'harbour-master', type: 'npc', title: 'Harbour Master Orla', at: { x: 0, y: 260 }, fields: { tier: 'goon' },
    summary: 'Gruff, underpaid, knows everyone’s secrets.',
    body: '**Wants:** a quiet harbour and her pension.\n\n**Knows:** ledger pages go missing on nights the bell is silent.\n\n**Will not say:** who pays her to look away.',
    readAloud: '“Toll’s two silver a head. Three if you’re carrying anything that clinks.”',
  },
  {
    id: 'missing-ledger', type: 'clue', title: 'The missing ledger', at: { x: 360, y: 0 },
    summary: 'Shipping ledger torn out — someone hid a cargo.',
    body: 'Found in: the harbour office, or in Orla’s coat.\n\nThe missing page lists a ship, the *Corvane*, and a crest: a small bell. The fourth page still carries its ghost, pressed through the paper.',
    readAloud: 'Three pages have been cut from the ledger with a knife, neatly. The fourth still carries the faint ghost of a crest: a bell.',
  },
  {
    id: 'smugglers-cove', type: 'encounter', title: 'Smugglers’ cove', at: { x: 720, y: 0 }, fields: { tier: 'elite' },
    summary: 'Night fight under the cliffs.',
    body: 'Three smugglers guard the crates. The tide cuts the beach off in ten minutes.\n\nThe crates hold lamp oil, a bell clapper and a sack of black pennies.',
    readAloud: 'Below the cliffs a lantern swings. Someone is unloading a boat in near silence, and they have not seen you yet.',
  },
  {
    id: 'cult-reveal', type: 'event', title: 'The bell tolls thirteen', at: { x: 1080, y: 0 },
    summary: 'Twist: the clock tower belongs to a cult.',
    body: 'The cult rings the thirteenth bell to open the flood chambers under the cliffs. Every lantern in the harbour turns green for the length of the toll.',
    readAloud: 'Thirteen. In all of Greywater’s history the bell has never struck thirteen — and all along the harbour the lanterns turn green.',
  },
  // ---- the players (a VTT would send these; here they are made up so the table tools have a party to move) ----
  { id: 'pc-mira', type: 'pc', title: 'Mira', summary: 'Rogue. Lies fluently and picks every lock.', fields: { playerName: 'Anna', present: true } },
  { id: 'pc-dorn', type: 'pc', title: 'Dorn', summary: 'Warden. Goes in first and asks questions later.', fields: { playerName: 'Ben', present: true } },
  { id: 'pc-ash', type: 'pc', title: 'Ash', summary: 'Scholar. Reads everything twice.', fields: { playerName: 'Chris', present: true } },
  // ---- the pool: prepared, no fixed place yet ----
  {
    id: 'rusty-anchor', type: 'location', title: 'The Rusty Anchor (tavern)', tags: ['tavern'],
    summary: 'Smoky dockside tavern. Rumours for the price of a drink.',
    body: 'Barkeep: Brenn. A fireplace, sticky tables, a dice game in the corner.\n\nThe cellar stairs behind the bar lead down to the smugglers’ tunnel.',
    readAloud: 'Warmth, pipe smoke and the smell of fried herring meet you at the door. A dozen heads turn — and politely turn back.',
    poolHint: 'Whenever the players want a drink, rumours, or a place to rest.',
  },
  {
    id: 'tavern-brawl', type: 'encounter', title: 'Tavern brawl', tags: ['tavern'],
    summary: 'Sailors start a fight over a spilled drink.',
    body: 'Two drunk sailors, one broken chair, and the whole room takes sides within a round. Orla arrives after three rounds, never sooner.',
    poolHint: 'If the players linger in the Rusty Anchor.',
  },
  {
    id: 'old-fisherman', type: 'npc', title: 'Old fisherman Tamm',
    summary: 'Saw lights at the cove three nights running.',
    body: 'Tamm talks for a drink. He saw a boat with no lantern and heard a bell that was not the tower’s.',
    poolHint: 'A rumour source, can appear anywhere along the harbour.',
  },
  {
    id: 'dockside-hand', type: 'handout', title: 'Torn ledger page',
    summary: 'Half a page: dates and a crest.',
    readAloud: 'A half page, torn at an angle: three dates, the word “Corvane”, and half of a seal — a small bell.',
    poolHint: 'Hand over when the ledger clue is found.',
  },
  {
    id: 'harbour-rumours', type: 'table', title: 'Harbour rumours',
    summary: 'What the dockers whisper. Roll when the players ask around.',
    poolHint: 'Whenever the players ask around the harbour.',
    fields: {
      entries: [
        'The bell never rings on the night of a new moon.',
        'Orla’s pension is paid in black coins.',
        '2× Somebody is paying for lamp oil nobody burns.',
        'A boat with no lantern came in at low tide.',
        'The clock tower has a tenant, and he never goes out.',
      ],
    },
  },
  {
    id: 'bell-clock', type: 'clock', title: 'The thirteenth bell',
    summary: 'Every wasted night brings the ritual closer.',
    poolHint: 'Tick it when the players dawdle or fail to stop the cult.',
    fields: { segments: 6, filled: 1, consequence: 'The bell strikes thirteen: the flood chambers open and the harbour drowns.' },
  },
  {
    id: 'greywater-coast', type: 'location', title: 'Greywater and the coast', tags: ['map'],
    summary: 'A day’s ride along the coast: the harbour, a ruined lighthouse, the smugglers’ cove.',
    body: 'A region map: roads, forests and the places that matter. Pins are towns, ruins and caves.',
    poolHint: 'Show it when the players ask what is around.',
  },
];

export const PARTY = ['pc-mira', 'pc-dorn', 'pc-ash'];

export const SEED_EDGES: { from: string; to: string; kind: EdgeKind; label?: string }[] = [
  { from: 'arrival', to: 'missing-ledger', kind: 'leads-to' },
  { from: 'missing-ledger', to: 'smugglers-cove', kind: 'leads-to' },
  { from: 'smugglers-cove', to: 'cult-reveal', kind: 'leads-to' },
  { from: 'harbour-master', to: 'arrival', kind: 'belongs-to' },
  { from: 'arrival', to: 'cult-reveal', kind: 'foreshadows', label: 'the bell' },
];

/** A short world book, so the Library tab has something in it and the AI has lore to look things up in. */
export const WORLD_BOOK = {
  name: 'greywater_lore',
  summary: 'Greywater: a rough, fog-bound harbour town on the Pale Coast, founded by smugglers. A tolling guild and the Tide Cult, who pay in black pennies and ring a thirteenth bell to open flood chambers under the cliffs. Key places: the Rusty Anchor tavern with its smugglers’ cellar, the clock tower, the cove and the ruined lighthouse.',
  text: `# Greywater

Greywater is a rough, fog-bound harbour town on the Pale Coast, built of weathered timber and salt-eaten granite. Wedged between black basalt cliffs and an unpredictable sea, its people live by the tides while a clock tower looms over the docks like a silent guard.

## History

- **The smuggler years.** Founded two centuries ago by smugglers and outcasts. The cliffs and sea caves hid them from the mainland patrols.
- **The Great Drowning.** Sixty years ago a spring tide swallowed the lower town. The clock tower was raised on the foundations of an older, silted-up shrine.
- **The thirteenth hour.** Ever since, a thirteenth toll means trouble: not a fault in the clockwork, but a signal that opens the flood chambers under the cliffs.

## Powers

### The Harbour Guild
The official power on the quays: piers, registers and warehouses. It collects harsh tolls and uses its Dockside Brutes. Some of its masters look away for a price.

### The Tide Cult
A secret cult of fishermen, innkeepers and patricians alike. Members recognise each other by **black pennies**, heavy tarnished coins stamped with a tiny bell. When the thirteenth bell sounds they gather in the flooded caves.

### The smugglers
Loose crews who know every cliff path and cellar tunnel. They trade in forbidden cargo and relics from sunken wrecks.

## Daily life

### Life in the fog
Sunlight is rare. People wear waxed canvas coats and light oil lamps whose glow turns the alleys yellow.

### Sailors’ customs
- **Salt on the threshold.** Before the doors are barred at night, coarse sea salt goes over the sill to keep out "the wet guests".
- **Copper for the deep.** Every helmsman throws a copper coin into the wake when leaving harbour.

## Places

### The Rusty Anchor
A smoky dockside tavern. A cellar stair behind the bar leads into the smugglers’ tunnel. Barkeep: Brenn.

### The clock tower
Seat of the cult. Its bell is rung by hand.

### Smugglers’ cove
A hidden shingle beach under the cliffs, reachable by a goat path or by boat. Cut off by the tide.
`,
};

/** The region map of the coast (canvas pixels, 1344×768). */
export const COAST_OPS: Record<string, unknown>[] = [
  { op: 'shape', type: 'polygon', kind: 'land', points: [[330, 0], [1344, 0], [1344, 768], [200, 768], [250, 600], [380, 470], [340, 330], [420, 200]], id: 'land' },
  { op: 'shape', type: 'polygon', kind: 'forest', points: [[760, 40], [1120, 30], [1180, 220], [940, 300], [770, 220]], id: 'forest-n' },
  { op: 'shape', type: 'polygon', kind: 'forest', points: [[520, 520], [760, 480], [820, 640], [600, 720], [470, 640]], id: 'forest-s' },
  { op: 'shape', type: 'polygon', kind: 'hills', points: [[960, 420], [1240, 400], [1300, 600], [1040, 650], [930, 540]], id: 'hills' },
  { op: 'shape', type: 'polygon', kind: 'mountain', points: [[1180, 60], [1330, 40], [1336, 300], [1210, 260]], id: 'mountains' },
  { op: 'shape', type: 'path', kind: 'river', points: [[1180, 250], [1010, 330], [880, 360], [700, 340], [520, 300], [430, 290]], width: 10, id: 'river' },
  { op: 'shape', type: 'path', kind: 'road', points: [[420, 330], [560, 400], [700, 420], [860, 400], [980, 470], [1100, 520]], width: 8, id: 'road-east' },
  { op: 'shape', type: 'path', kind: 'road', points: [[420, 330], [470, 470], [560, 600]], width: 8, id: 'road-south' },
  { op: 'shape', type: 'pin', kind: 'port', points: [[420, 330]], r: 18, label: 'Greywater', id: 'pin-greywater' },
  { op: 'shape', type: 'pin', kind: 'ruins', points: [[330, 560]], r: 14, label: 'Old lighthouse', id: 'pin-lighthouse' },
  { op: 'shape', type: 'pin', kind: 'cave', points: [[300, 210]], r: 14, label: 'Smugglers’ cove', id: 'pin-cove' },
  { op: 'shape', type: 'pin', kind: 'village', points: [[1100, 520]], r: 14, label: 'Millbrook', id: 'pin-millbrook' },
  { op: 'shape', type: 'pin', kind: 'castle', points: [[1250, 160]], r: 16, label: 'Hollow Keep', id: 'pin-keep' },
];

/** Where the practice campaign's frames and extra canvases appear once the tour creates them. */
export const ACT2_CANVAS = { id: 'act-2', name: 'Act II · The cult' };
