// Map data model: floors, props, terrains and the MapDoc document (pure data, no imports).
import type { RegionKind } from './regionkinds.js';

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

/** Where the name of an area is printed relative to it. */
export const LABEL_PLACES = ['above', 'middle', 'below'] as const;
export type LabelPlace = (typeof LABEL_PLACES)[number];
export const LABEL_SIZES = ['sm', 'md', 'lg'] as const;
export type LabelSize = (typeof LABEL_SIZES)[number];

/**
 * A name on the map. Battle maps count in grid cells, region maps in canvas pixels.
 * Without `area` it sits at the point x,y; with `area` (a rectangle: a room, a courtyard…) x,y is its centre and the name
 * stands above, in the middle of, or below it (`place`, default middle). `show: false` keeps it in the editor but off
 * the printed picture. `style` is a lettering style id (labelstyles.ts); without one the map's own style is used.
 */
export interface MapLabel {
  /** stable handle (l1, l2…): how the AI and the editor address a name without coordinates */
  id?: string;
  x: number; y: number; text: string;
  place?: LabelPlace; style?: string; show?: boolean; size?: LabelSize;
  area?: { x: number; y: number; w: number; h: number };
}

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
  labels: MapLabel[];
  /** `node`: the NPC / enemy node this token stands for (its sheet goes to the VTT with the map, so the token is the character, not just a marker) */
  tokens: { x: number; y: number; kind: 'pc' | 'npc' | 'enemy'; label?: string; node?: string }[];
  /** region: canvas size in px + vector shapes in that space */
  size: { w: number; h: number };
  /** region maps: base terrain of the canvas (a terrain kind id) */
  background?: string;
  /**
   * region maps. `kind` is a built-in id (TERRAINS / REGION_KINDS) or the id of a custom kind in `kinds`.
   * `width` = stroke width of a path (px), `r` = radius of a pin, `prompt` = what to paint here, in the GM's own words
   * (a structure's step-2 prompt; overrides the kind's wording).
   */
  shapes: {
    id: string; type: 'polygon' | 'path' | 'ellipse' | 'pin'; kind: string; points: [number, number][]; r?: number; width?: number; label?: string; prompt?: string;
    /** how the name (`label`) is printed: where it stands relative to the shape, in which style, how big, and whether it is printed at all */
    labelPlace?: LabelPlace; labelStyle?: string; labelSize?: LabelSize; labelShow?: boolean;
  }[];
  /** region maps: the custom kinds (terrain / structure types the GM defined) this map uses — a copy of the campaign library, so the map stays self-contained */
  kinds?: RegionKind[];
  /** finished painted renders (files in images/), cover first */
  renders: string[];
  /** two-step paint: finished images of the EMPTY terrain (candidates the GM chooses from) and the one picked for step 2 */
  terrains?: string[];
  terrainPick?: string;
  /** what the place looks like, as given to the terrain step (reused for step 2) */
  paintPrompt?: string;
  /**
   * What each prop group is painted as in step 2 (key = group id g1, g2…; `kind` guards against groups that changed).
   * The GM's own wording (`ai` absent) is used as it is; `ai: true` is only what the AI wrote last time, shown for editing.
   */
  propPrompts?: Record<string, { kind: string; text: string; ai?: boolean }>;
  /** region maps: how strictly the terrain is painted as a flat plan view (default = natural painted-map look) */
  view?: 'default' | 'strict' | 'plan';
  /** names printed on top of the picture: the lettering style used when a label names none of its own */
  lettering?: { style: string };
  /** finished pictures that have the names printed on them -> the painted render they were made from */
  lettered?: Record<string, string>;
  /** the last, optional painting step: the surroundings of every painted object are blended into the picture (default on) */
  consolidate?: boolean;
  updatedAt: string;
}

