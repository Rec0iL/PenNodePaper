import { TERRAINS, type MapDoc } from './mapdata.js';

// ---------------------------------------------------------------------------
// Region maps: the kinds of things you can draw (terrain such as water, desert,
// roads; structures such as a hospital, a tent camp, a city) and the custom
// kinds a GM adds. A kind carries what the painting needs: a colour for the
// sketch, a short wording of what it looks like (the campaign style decides the
// look), and which painting step handles it.
//   terrain   -> step 1, part of the flat sketch the model paints the land from
//   structure -> step 2, inpainted into exactly the drawn shape
// ---------------------------------------------------------------------------

export type RegionLayer = 'terrain' | 'structure';

export interface RegionKind {
  id: string;
  name: string;
  layer: RegionLayer;
  /** how it is usually drawn: a filled area, a line with a width, or a spot (a small, usually round area) */
  geometry: 'area' | 'line' | 'spot';
  /** colour in the flat sketch */
  color: string;
  /** what it looks like from above, in plain words (no art style: that comes from the campaign) */
  prompt: string;
  /** default stroke width of a line (px) */
  width?: number;
  /** default radius of a spot (px) when it is stamped as a round area */
  size?: number;
  /** lines: painted in the water pass (rivers, canals…) or in the land pass (roads, rails, paths, bridges); default derived from the name */
  lineGroup?: LineGroup;
  /** made by the GM (not part of the built-in catalogue) */
  custom?: boolean;
}

const t = (id: string, name: string, color: string, prompt: string, geometry: RegionKind['geometry'] = 'area', extra: Partial<RegionKind> = {}): RegionKind =>
  ({ id, name, layer: 'terrain', geometry, color, prompt, ...extra });
const s = (id: string, name: string, color: string, prompt: string, geometry: RegionKind['geometry'] = 'spot', extra: Partial<RegionKind> = {}): RegionKind =>
  ({ id, name, layer: 'structure', geometry, color, prompt, ...extra });

/**
 * The built-in kinds. The ids of the old fixed palette are kept (so every older map still reads the same);
 * colours of those come from TERRAINS.
 */
export const REGION_KINDS: RegionKind[] = [
  t('sea', 'Sea', TERRAINS.sea, 'open sea with gentle waves'),
  t('lake', 'Lake', TERRAINS.lake, 'a calm lake with a reedy shore'),
  t('land', 'Grassland', TERRAINS.land, 'open grassland and meadows with scattered bushes'),
  t('forest', 'Forest', TERRAINS.forest, 'dense forest seen from above, a closed canopy of treetops'),
  t('hills', 'Hills', TERRAINS.hills, 'rolling hills with scrub and heath'),
  t('mountain', 'Mountains', TERRAINS.mountain, 'rugged mountains with rocky ridges and peaks'),
  t('desert', 'Desert', TERRAINS.desert, 'sand dunes and bare desert'),
  t('swamp', 'Swamp', TERRAINS.swamp, 'murky swamp with dark pools, reeds and dead trees'),
  t('snow', 'Snow', TERRAINS.snow, 'snow-covered ground with drifts'),
  t('tundra', 'Tundra', '#b9c6bf', 'frozen tundra with lichen, patches of snow and bare rock'),
  t('jungle', 'Jungle', '#1d8f55', 'dense tropical jungle with a lush, uneven canopy'),
  t('farmland', 'Farmland', '#c9c35a', 'a patchwork of farm fields, hedgerows and meadows'),
  t('wasteland', 'Wasteland', '#8a5a45', 'barren, cracked wasteland with dust and bare earth'),
  t('river', 'River', TERRAINS.river, 'a winding river with clear banks', 'line', { width: 14 }),
  t('road', 'Gravel road', TERRAINS.road, 'a dirt and gravel road', 'line', { width: 10 }),
  t('road_paved', 'Asphalt road', '#3c3c44', 'a paved asphalt road with a lane marking', 'line', { width: 12 }),
  t('path', 'Footpath', '#b49a72', 'a narrow footpath worn into the ground', 'line', { width: 5 }),
  t('railway', 'Railway', '#555563', 'a railway line with a gravel bed and parallel steel rails', 'line', { width: 6 }),

  s('city', 'City', TERRAINS.city, 'a large dense city seen from high above: crowded streets, many roofs, a central square', 'spot', { size: 28 }),
  s('town', 'Town', '#dc6a3c', 'a medium town seen from above: a few dozen houses along streets around a market square', 'spot', { size: 22 }),
  s('village', 'Village', TERRAINS.village, 'a small village seen from above: a handful of houses with gardens around a green', 'spot', { size: 16 }),
  s('house', 'House', '#e8a0a0', 'a single family house with a roof, a small yard and a driveway', 'spot', { size: 8 }),
  s('farm', 'Farmstead', '#c8a050', 'a farmstead with a farmhouse, a barn and fenced yards', 'spot', { size: 14 }),
  s('camp', 'Camp', '#e86aa8', 'a camp of tents around a fire pit', 'spot', { size: 16 }),
  s('hospital', 'Hospital', '#f4f4f4', 'a large hospital complex with several wings, a courtyard and a parking area', 'spot', { size: 18 }),
  s('castle', 'Castle', TERRAINS.castle, 'a stone castle with towers, walls and a keep', 'spot', { size: 20 }),
  s('fort', 'Fort', '#6a4ab0', 'a compact fortress with strong walls and corner towers', 'spot', { size: 18 }),
  s('tower', 'Tower', '#8a5ad0', 'a lone tower with a small walled yard', 'spot', { size: 10 }),
  s('temple', 'Temple', '#e8d8f0', 'a temple with a large roof and a paved courtyard', 'spot', { size: 14 }),
  s('ruins', 'Ruins', TERRAINS.ruins, 'crumbling overgrown ruins of walls and fallen columns', 'spot', { size: 16 }),
  s('cave', 'Cave', TERRAINS.cave, 'a dark cave mouth in a rock face', 'spot', { size: 12 }),
  s('mine', 'Mine', '#4a3a30', 'a mine entrance with a timber frame, spoil heaps and rails', 'spot', { size: 12 }),
  s('port', 'Port', TERRAINS.port, 'a harbour with piers, moored boats and warehouses', 'spot', { size: 22 }),
  s('bridge', 'Bridge', '#9a7a50', 'a bridge, seen from above', 'line', { width: 12 }),
  s('wall', 'Wall', TERRAINS.wall, 'a tall fortification wall with battlements', 'line', { width: 6 }),
];

const BUILT_IN = new Map(REGION_KINDS.map((k) => [k.id, k]));

/** The built-ins plus the custom kinds of a map (a custom kind with a built-in id replaces it). */
export function kindTable(custom?: RegionKind[]): Map<string, RegionKind> {
  const m = new Map(BUILT_IN);
  for (const k of custom ?? []) m.set(k.id, { ...k, custom: true });
  return m;
}

/** A kind by id; ids nobody knows (an old or foreign map) read as plain terrain. */
export function regionKind(id: string, custom?: RegionKind[]): RegionKind {
  const c = custom?.find((x) => x.id === id);
  if (c) return { ...c, custom: true };
  return BUILT_IN.get(id) ?? { id, name: id.replace(/[_-]+/g, ' '), layer: 'terrain', geometry: 'area', color: '#9a9a9a', prompt: id.replace(/[_-]+/g, ' ') };
}

export const isKnownKind = (id: string, custom?: RegionKind[]) => BUILT_IN.has(id) || !!custom?.some((k) => k.id === id);

/** A line kind (river, road, railway, bridge, wall…): painted after the terrain, in its own corridor pass, never in a window. */
export const isLineKind = (k: RegionKind): boolean => k.geometry === 'line';

/** Does this kind get inpainted into its shape in step 2 (a structure that is an area or a spot)? */
export const inStep2 = (k: RegionKind): boolean => k.layer === 'structure' && k.geometry !== 'line';

/** The line passes, in the order they are painted: water, then land lines (roads, rails, paths, bridges), then walls (so they cross the roads). */
export const LINE_GROUPS = ['water', 'land', 'wall'] as const;
export type LineGroup = (typeof LINE_GROUPS)[number];

const WATER_WORDS = /\b(river|stream|creek|brook|canal|channel|water|tributary)\b/i;
const WALL_WORDS = /\b(wall|walls|palisade|fence|rampart|fortification|barricade|dyke|dike)\b/i;
/** Which line pass a kind belongs to (the GM's choice for their own kinds, else derived from the name). */
export function lineGroupOf(k: RegionKind): LineGroup {
  if (k.lineGroup) return k.lineGroup;
  const id = k.id.replace(/_/g, ' ');
  if (k.id === 'river' || WATER_WORDS.test(id) || WATER_WORDS.test(k.name)) return 'water';
  return k.id === 'wall' || WALL_WORDS.test(id) || WALL_WORDS.test(k.name) ? 'wall' : 'land';
}

/** Validate and normalise a kind the GM or the AI defines. Throws a message fit for the AI. */
export function cleanKind(raw: Partial<RegionKind> & { id?: string }): RegionKind {
  const name = (raw.name ?? '').toString().trim().slice(0, 40);
  if (!name) throw new Error('A kind needs a name.');
  const id = (raw.id ?? name).toString().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  if (!id) throw new Error(`"${name}" cannot be turned into an id; use letters and digits.`);
  const color = (raw.color ?? '').toString().trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`Kind "${name}": colour must be a hex colour like #c04a2a.`);
  const layer: RegionLayer = raw.layer === 'structure' ? 'structure' : 'terrain';
  const geometry = raw.geometry === 'line' || raw.geometry === 'spot' ? raw.geometry : 'area';
  const prompt = (raw.prompt ?? '').toString().replace(/\s+/g, ' ').trim().slice(0, 300);
  if (prompt.split(/\s+/).length < 2) throw new Error(`Kind "${name}": describe what it looks like from above (a few words).`);
  const num = (n: unknown, lo: number, hi: number) => (typeof n === 'number' && isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : undefined);
  const width = num(raw.width, 1, 120);
  const size = num(raw.size, 3, 200);
  return {
    id, name, layer, geometry, color: color.toLowerCase(), prompt,
    ...(geometry === 'line' ? { width: width ?? 10 } : {}),
    ...(geometry === 'spot' ? { size: size ?? 16 } : {}),
    ...(geometry === 'line' && (raw.lineGroup === 'water' || raw.lineGroup === 'land' || raw.lineGroup === 'wall') ? { lineGroup: raw.lineGroup } : {}),
    custom: true,
  };
}

// ------------------------------- words for colours -------------------------------------

const NAMED: [string, [number, number, number]][] = [
  ['red', [200, 50, 50]], ['crimson', [160, 30, 60]], ['orange', [225, 120, 40]], ['burnt orange', [200, 90, 50]], ['brown', [110, 75, 45]], ['dark brown', [70, 45, 30]],
  ['reddish brown', [140, 90, 70]], ['tan', [200, 170, 120]], ['sand', [216, 192, 128]], ['beige', [225, 215, 190]], ['yellow', [225, 205, 70]], ['mustard', [190, 160, 50]],
  ['khaki', [155, 138, 82]], ['olive', [100, 110, 60]], ['olive green', [155, 184, 106]], ['lime green', [124, 255, 58]], ['green', [60, 160, 70]], ['dark green', [40, 100, 55]],
  ['emerald', [30, 145, 85]], ['teal', [40, 150, 150]], ['sea blue', [47, 111, 181]], ['sky blue', [90, 160, 224]], ['azure', [70, 140, 220]], ['cornflower blue', [100, 150, 230]], ['bright blue', [40, 100, 200]], ['steel blue', [80, 120, 160]], ['cyan', [60, 200, 220]], ['light blue', [175, 215, 235]], ['navy', [30, 50, 110]],
  ['purple', [130, 70, 190]], ['violet', [160, 110, 220]], ['magenta', [220, 70, 170]], ['pink', [235, 140, 190]], ['pale pink', [235, 190, 190]], ['white', [245, 245, 245]],
  ['pale grey-green', [185, 198, 191]], ['light grey', [200, 200, 205]], ['grey', [125, 125, 132]], ['dark grey', [60, 60, 68]], ['slate grey', [85, 85, 99]], ['black', [20, 20, 22]],
];

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/**
 * Plain colour words for hex colours, so the model's prompt can say "dark green = forest". Each word is used once:
 * two similar colours get different names (the nearest one that is still free), so the legend is never ambiguous.
 */
export function colorWords(hexes: string[]): string[] {
  const taken = new Set<string>();
  return hexes.map((h) => {
    const c = rgb(h);
    if (!c) return 'coloured';
    const ranked = NAMED.map(([n, v]) => [n, (v[0] - c[0]) ** 2 + (v[1] - c[1]) ** 2 + (v[2] - c[2]) ** 2] as const).sort((a, b) => a[1] - b[1]);
    const pick = ranked.find(([n]) => !taken.has(n))?.[0] ?? ranked[0][0];
    taken.add(pick);
    return pick;
  });
}

/** One colour word on its own (the nearest named colour). */
export const colorWord = (hex: string): string => colorWords([hex])[0];

type Shape = MapDoc['shapes'][number];

/** The kinds a map actually uses, background first, in order of appearance. */
export function usedKinds(m: Pick<MapDoc, 'shapes' | 'background' | 'kinds'>): RegionKind[] {
  const ids = [m.background ?? 'land', ...m.shapes.map((x: Shape) => x.kind)];
  return [...new Set(ids)].map((id) => regionKind(id, m.kinds));
}

/**
 * Legend for the sketch the model receives, naming only the kinds that really occur (a legend for absent
 * things makes the model invent them). `terrainOnly` = the terrain pass: no structures and no lines (those come later).
 */
export function regionLegend(m: Pick<MapDoc, 'shapes' | 'background' | 'kinds'>, terrainOnly = false): string {
  const kinds = usedKinds(m).filter((k) => !terrainOnly || (k.layer === 'terrain' && !isLineKind(k)));
  const words = colorWords(kinds.map((k) => k.color));
  const items = kinds.map((k, i) => (k.geometry === 'line' ? `${words[i]} lines = ${k.name.toLowerCase()}` : `${words[i]} = ${k.name.toLowerCase()}`));
  const head = terrainOnly
    ? 'The input is a flat colour-coded sketch of an EMPTY landscape seen from above, without any buildings or settlements'
    : 'The input is a flat colour-coded map sketch seen from above';
  return `${head}: ${items.join(', ')}.`;
}
