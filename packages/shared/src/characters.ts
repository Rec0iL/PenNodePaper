// The NPCs and enemies of a place and the tokens that stand for them on its battle map (pure, so the editor, the push
// and the AI's tools all read the same thing).
import type { CampaignState, StoryNode } from './index.js';

/**
 * The maps of a node, in order (the first is its main map: the one a double click opens and a push sends by default).
 * Stored as `fields.maps`; older campaigns have a single `fields.mapId`, read the same way.
 */
export function mapIdsOf(n: Pick<StoryNode, 'fields'> | undefined): string[] {
  if (!n) return [];
  const list = Array.isArray(n.fields.maps) ? n.fields.maps.filter((x): x is string => typeof x === 'string' && !!x) : [];
  const old = typeof n.fields.mapId === 'string' && n.fields.mapId ? [n.fields.mapId] : [];
  return [...new Set([...list, ...old])];
}
/** The fields of a node with this list of maps (the old single `mapId` is folded in and dropped). */
export function withMaps(fields: Record<string, unknown>, maps: string[]): Record<string, unknown> {
  const { mapId: _old, maps: _list, ...rest } = fields;
  return maps.length ? { ...rest, maps: [...new Set(maps)] } : rest;
}

/** The node a map is attached to. */
export function placeOfMap(s: Pick<CampaignState, 'nodes'>, mapId: string): StoryNode | undefined {
  return Object.values(s.nodes).find((n) => !n.trashed && mapIdsOf(n).includes(mapId));
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
