// Map data model: floors, props, terrains and the MapDoc document (pure data, no imports).

// --- maps ---------------------------------------------------------------------------

/** One character per grid cell in MapDoc.rows. '.' = solid rock / outside (not walkable). */
export const FLOORS = {
  s: { name: 'stone', color: '#9a9aa6' },
  w: { name: 'wood', color: '#b07a45' },
  d: { name: 'dirt', color: '#8a6a4a' },
  g: { name: 'grass', color: '#5f9a4a' },
  c: { name: 'carpet', color: '#9a3a4a' },
  a: { name: 'water', color: '#3a78c8' },
  l: { name: 'lava', color: '#e0561a' },
  r: { name: 'rubble', color: '#7a7468' },
  m: { name: 'marble', color: '#d8d4cc' },
  n: { name: 'sand', color: '#d8c080' },
  i: { name: 'ice', color: '#a8d8e8' },
} as const;
export type FloorChar = keyof typeof FLOORS;

export const EDGE_SIDES = ['n', 'e', 's', 'w'] as const;
export type EdgeSide = (typeof EDGE_SIDES)[number];
export const DOOR_KINDS = ['door', 'secret', 'window', 'arch', 'portcullis'] as const;
export type DoorKind = (typeof DOOR_KINDS)[number];

export const PROP_KINDS = [
  'table', 'chair', 'bed', 'chest', 'barrel', 'crate', 'pillar', 'statue', 'altar', 'fireplace',
  'stairs_up', 'stairs_down', 'well', 'tree', 'rock', 'bookshelf', 'throne', 'cauldron', 'trap', 'fountain', 'campfire', 'boat',
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export const TERRAINS = {
  sea: '#2f6fb5', lake: '#4a8fd0', land: '#9bb86a', forest: '#2f6a3a', hills: '#9a8a52', mountain: '#7a7a82',
  desert: '#d8c080', swamp: '#5a6a3a', snow: '#e8eef2', road: '#6a4a2a', river: '#5aa0e0', wall: '#2a2a30',
  city: '#d04a4a', village: '#d08a4a', castle: '#a04ad0', ruins: '#6a6a50', cave: '#3a2a20', port: '#e0d04a',
} as const;
export type TerrainKind = keyof typeof TERRAINS;

export interface MapDoc {
  id: string;
  name: string;
  /** battle = grid-based floor plan (rows); region = free vector shapes (world / regional / scene sketch). */
  kind: 'battle' | 'region';
  grid: { type: 'square' | 'hex'; cols: number; rows: number; /** feet (or other unit) per cell */ unit: number };
  /** battle: one string per row, one FLOORS char per cell, '.' = rock. */
  rows: string[];
  doors: { x: number; y: number; side: EdgeSide; kind: DoorKind }[];
  /** extra inner walls between two walkable cells */
  walls: { x: number; y: number; side: EdgeSide }[];
  /** wall gaps between two walkable cells that should stay open (wide passage) */
  open: { x: number; y: number; side: EdgeSide }[];
  props: { id: string; kind: PropKind; x: number; y: number; w?: number; h?: number; rot?: number; label?: string }[];
  labels: { x: number; y: number; text: string }[];
  tokens: { x: number; y: number; kind: 'pc' | 'npc' | 'enemy'; label?: string }[];
  /** region: canvas size in px + vector shapes in that space */
  size: { w: number; h: number };
  /** region maps: base colour of the canvas */
  background?: TerrainKind;
  shapes: { id: string; type: 'polygon' | 'path' | 'ellipse' | 'pin'; kind: TerrainKind; points: [number, number][]; r?: number; width?: number; label?: string }[];
  /** finished painted renders (files in images/), cover first */
  renders: string[];
  /** two-step paint: finished images of the EMPTY terrain (candidates the GM chooses from) and the one picked for step 2 */
  terrains?: string[];
  terrainPick?: string;
  /** what the place looks like, as given to the terrain step (reused for step 2) */
  paintPrompt?: string;
  updatedAt: string;
}

