// Messages the app (and the welcome tour) sends to the AI, in one place: the Story tab builds the "bridge back" request
// from here, and the tour's scripted stand-in recognises the requests by the same words.

/** What the "Bridge back with the AI" button asks. `guidance` is the GM's railguard: how the bridge should go. Empty = the AI chooses. */
export function bridgePrompt(guidance = ''): string {
  const g = guidance.replace(/\s+/g, ' ').trim();
  return [
    'The players went off-script. Call story_status, then help me get back on track: (1) tell me in 3-4 lines what they have effectively bypassed or not learned and what that costs the story; (2) propose the best 1-2 places to merge back (prefer frontier nodes marked converges:true) and ONE short bridge for each — create it as a node with create_node (place on the canvas next to where the players are) and link it with a "bridge" edge; (3) if an important clue was missed, add a second, different way for the players to learn it; (4) do not delete anything and do not change what already happened. Keep the new nodes brief.',
    ...(g ? [`The GM's guidance for the bridge (the railguard — follow it, it overrides your own preferences about how the bridge should go, but never what already happened): “${g}”`] : []),
  ].join(' ');
}

/** The railguard text inside a bridge request ('' when there is none). */
export function guidanceOf(text: string): string {
  return /The GM's guidance for the bridge[^“"]*[“"]([\s\S]+?)[”"]\s*$/.exec(text)?.[1].trim() ?? '';
}

/** The requests the tour asks the GM to send (typed into the chat for them). */
export const TOUR_MESSAGES = {
  brenn: 'Flesh out the Rusty Anchor: give it a barkeep and a rumour that points at the cult, and link them in.',
  patrol: 'The harbour should feel less safe at night. Add a complication for after dark and connect it to the story.',
} as const;

export type DemoScript = 'brenn' | 'patrol' | 'bridge' | 'recap' | 'fill-table' | 'image-prompt' | 'map-prompt' | 'default';

/** Which scripted answer a request gets in a practice campaign. */
export function pickDemoScript(text: string): DemoScript {
  const t = text.trim();
  if (t === TOUR_MESSAGES.brenn) return 'brenn';
  if (t === TOUR_MESSAGES.patrol) return 'patrol';
  if (t.startsWith('The players went off-script')) return 'bridge';
  if (t.startsWith('Write a short, vivid recap')) return 'recap';
  if (t.startsWith('Fill the random table')) return 'fill-table';
  if (t.startsWith('Write a vivid image prompt for this node')) return 'image-prompt';
  if (t.startsWith('Write a vivid description of the place for the map') || t.startsWith('Write a vivid render prompt for the map')) return 'map-prompt';
  return 'default';
}
