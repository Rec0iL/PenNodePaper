// The NPCs and enemies of a place and the tokens that stand for them on its battle map (pure, so the editor, the push
// and the AI's tools all read the same thing).
import type { CampaignState, StoryNode } from './index.js';

/** The location node a map is attached to. */
export function placeOfMap(s: Pick<CampaignState, 'nodes'>, mapId: string): StoryNode | undefined {
  return Object.values(s.nodes).find((n) => !n.trashed && n.fields.mapId === mapId);
}

/** Nodes that can stand on a map as a character. */
export const isCharacterNode = (n: StoryNode | undefined): n is StoryNode => !!n && !n.trashed && (n.type === 'npc' || n.type === 'enemy');

/** The token kind a character's node gets. */
export const tokenKindOf = (n: StoryNode): 'npc' | 'enemy' => (n.type === 'enemy' ? 'enemy' : 'npc');

/** NPCs and enemies that belong to the place of this map (a belongs-to connection between them and the location, drawn either way), in the order they were made. */
export function charactersOfPlace(s: Pick<CampaignState, 'nodes' | 'graph'>, mapId: string): StoryNode[] {
  const place = placeOfMap(s, mapId);
  if (!place) return [];
  const ids = new Set<string>();
  for (const e of s.graph.edges) {
    if (e.kind !== 'belongs-to') continue;
    if (e.to === place.id) ids.add(e.from);
    else if (e.from === place.id) ids.add(e.to);
  }
  return [...ids].map((id) => s.nodes[id]).filter(isCharacterNode).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
