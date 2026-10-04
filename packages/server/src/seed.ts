import { runCommand } from './commands.js';
import type { Store } from './store.js';

/** A tiny example adventure so the first launch isn't an empty canvas. */
export function seedDemo(store: Store) {
  if (Object.keys(store.state.nodes).length) return;
  store.state.meta = { ...store.state.meta, name: 'Greywater (demo)', language: 'en' };
  store.persistence.writeMeta(store.state.meta);
  const run = (name: string, args: unknown) => runCommand(store, name, args, 'system');
  run('batch', {
    label: 'Demo campaign',
    ops: [
      { command: 'create_node', args: { id: 'arrival', type: 'scene', title: 'Arrival at Greywater', summary: 'The party reaches a fog-bound harbour town at dusk.', body: 'The ferry docks late. Lanterns are lit but few people are out.\n\n- The harbour master asks for a toll.\n- Someone is watching from the clock tower.', readAloud: 'The ferry bumps against the dock. Fog swallows the far end of the pier, and somewhere above you a bell strikes once.', place: 'canvas', x: 0, y: 0, status: 'active', tags: ['act-1'] } },
      { command: 'create_node', args: { id: 'harbour-master', type: 'npc', title: 'Harbour Master Orla', summary: 'Gruff, underpaid, knows everyone’s secrets.', fields: { tier: 'goon' }, place: 'canvas', x: 0, y: 260 } },
      { command: 'create_node', args: { id: 'missing-ledger', type: 'clue', title: 'The missing ledger', summary: 'Shipping ledger torn out — someone hid a cargo.', body: 'Found in: harbour office, or Orla’s coat.', place: 'canvas', x: 360, y: 0 } },
      { command: 'create_node', args: { id: 'smugglers-cove', type: 'encounter', title: 'Smugglers’ cove', summary: 'Night fight under the cliffs.', fields: { tier: 'elite' }, place: 'canvas', x: 720, y: 0 } },
      { command: 'create_node', args: { id: 'cult-reveal', type: 'event', title: 'The bell tolls thirteen', summary: 'Twist: the clock tower belongs to a cult.', place: 'canvas', x: 1080, y: 0 } },
      { command: 'create_node', args: { id: 'rusty-anchor', type: 'location', title: 'The Rusty Anchor (tavern)', summary: 'Smoky dockside tavern. Rumours for the price of a drink.', body: 'Barkeep: Brenn. Fireplace, sticky tables, a dice game in the corner.', poolHint: 'Whenever the players want a drink, rumours, or a place to rest.', tags: ['tavern'] } },
      { command: 'create_node', args: { id: 'tavern-brawl', type: 'encounter', title: 'Tavern brawl', summary: 'Sailors start a fight over a spilled drink.', poolHint: 'If the players linger in the Rusty Anchor.', tags: ['tavern'] } },
      { command: 'create_node', args: { id: 'old-fisherman', type: 'npc', title: 'Old fisherman Tamm', summary: 'Saw lights at the cove three nights running.', poolHint: 'A rumour source, can appear anywhere along the harbour.' } },
      { command: 'create_node', args: { id: 'dockside-hand', type: 'handout', title: 'Torn ledger page', summary: 'Half a page: dates and a crest.', poolHint: 'Hand over when the ledger clue is found.' } },
      { command: 'link', args: { from: 'arrival', to: 'missing-ledger', kind: 'leads-to' } },
      { command: 'link', args: { from: 'missing-ledger', to: 'smugglers-cove', kind: 'leads-to' } },
      { command: 'link', args: { from: 'smugglers-cove', to: 'cult-reveal', kind: 'leads-to' } },
      { command: 'link', args: { from: 'harbour-master', to: 'arrival', kind: 'belongs-to' } },
      { command: 'link', args: { from: 'arrival', to: 'cult-reveal', kind: 'foreshadows', label: 'the bell' } },
    ],
  });
  // seeding is not history the user should step back through
  store.resetHistory();
}
